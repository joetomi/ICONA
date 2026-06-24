import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import https from "https";
import crypto from "crypto";

const app = express();
const PORT = 3000;

app.use(express.json());

// Absolute URL of the portal ISP login
const LOGIN_URL = "https://my.icona.ly:9443/index.cgi";

// In-Memory Session storage mapped to secure tokens
interface UserSession {
  username: string;
  password?: string;
  cookies: string[];
  lastActive: number;
}
const sessions = new Map<string, UserSession>();

// SSL Agent to ignore self-signed certificates, similar to verify=False in Python
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Perform login and scrape info
 */
async function performLoginAndScrape(username: string,password: string) {
  try {
    // Step 1: Initial GET to acquire any base cookies
    const initialRes = await axios.get(LOGIN_URL, {
      httpsAgent,
      headers: { "User-Agent": USER_AGENT },
      timeout: 15000,
      validateStatus: () => true
    });

    // Parse cookies from step 1
    let cookies: string[] = [];
    if (initialRes.headers["set-cookie"]) {
      cookies = initialRes.headers["set-cookie"].map(c => c.split(";")[0]);
    }

    // Step 2: POST credentials
    const payload = new URLSearchParams();
    payload.append("user", username);
    payload.append("passwd", password);
    payload.append("header_train", "1");
    payload.append("log_in", "Log In");

    const postRes = await axios.post(LOGIN_URL, payload.toString(), {
      httpsAgent,
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookies.join("; ")
      },
      timeout: 15000,
      validateStatus: () => true
    });

    // Merge any new cookies established from login
    if (postRes.headers["set-cookie"]) {
      const newCookies = postRes.headers["set-cookie"].map(c => c.split(";")[0]);
      const cookieMap = new Map<string, string>();
      cookies.forEach(c => {
        const [k, v] = c.split("=");
        if (k) cookieMap.set(k.trim(), v ? v.trim() : "");
      });
      newCookies.forEach(c => {
        const [k, v] = c.split("=");
        if (k) cookieMap.set(k.trim(), v ? v.trim() : "");
      });
      cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`);
    }

    // Step 3: Fetch profile page (index=10)
    const profileRes = await axios.get(`${LOGIN_URL}?index=10`, {
      httpsAgent,
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookies.join("; ")
      },
      timeout: 15000,
      validateStatus: () => true
    });

    const html = profileRes.data;
    return { html, cookies, success: true };
  } catch (error: any) {
    console.error("Scrape Error during Login:", error.message);
    return { html: "", cookies: [], success: false, error: error.message };
  }
}

/**
 * Fetch profile page using active cookies
 */
async function fetchProfilePage(cookies: string[]) {
  try {
    const profileRes = await axios.get(`${LOGIN_URL}?index=10`, {
      httpsAgent,
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookies.join("; ")
      },
      timeout: 15000,
      validateStatus: () => true
    });
    return profileRes.data;
  } catch (err) {
    console.error("Fetch Profile Error:", err);
    return null;
  }
}

/**
 * Fetch statistics data (qindex=100002&AJAX=1) using active cookies
 */
async function fetchStatsPage(cookies: string[]) {
  try {
    // We fetch the main index=44 page first to initialize state if required by some session tracking on the server
    await axios.get(`${LOGIN_URL}?index=44`, {
      httpsAgent,
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookies.join("; "),
        "Referer": LOGIN_URL
      },
      timeout: 10000,
      validateStatus: () => true
    });

    // Fetch the AJAX statistics graph data
    const statsRes = await axios.get(`${LOGIN_URL}?qindex=100002&AJAX=1`, {
      httpsAgent,
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookies.join("; "),
        "Referer": `${LOGIN_URL}?index=44`,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest"
      },
      timeout: 15000,
      validateStatus: () => true
    });
    return statsRes.data;
  } catch (err) {
    console.warn("Fetch Stats Error:", err);
    return null;
  }
}

/**
 * Helper to check login success
 */
function verifyLoginSuccess(html: string): boolean {
  if (!html) return false;
  if (/id=["']PREAPID_TRAFIC_["']/i.test(html)) {
    return true;
  }
  if (html.includes("index=11") || html.toLowerCase().includes("logout") || html.includes("خروج")) {
    return true;
  }
  return false;
}

/**
 * Parses remaining internet traffic
 */
interface BalanceData {
  remaining_mb: number;
  remaining_gb: number;
  fullName?: string;
  phone?: string;
  address?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  nextPayment?: string;
  deposit?: string;
  creditAmount?: string;
  creditExpiry?: string;
  isUnlimited?: boolean;
  speed?: string;
  monthFee?: string;
  calculatedSpeed?: string;
  speedAnalysis?: any;
}

function parseBalance(html: string): BalanceData | null {
  if (!html) return null;
  
  let finalBalance: BalanceData = {
    remaining_mb: 0,
    remaining_gb: 0,
    isUnlimited: false
  };

  // Tag match for table id="PREAPID_TRAFIC_"
  const tableRegex = /<table[^>]*id=["']PREAPID_TRAFIC_["'][^>]*>([\s\S]*?)<\/table>/i;
  const tableMatch = html.match(tableRegex);
  
  let startDate = "";
  let isUnlimitedPkg = true;

  if (tableMatch) {
    const tableContent = tableMatch[1];

    // Parse table headers to locate "Start Date" index
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    const headers: string[] = [];
    while ((thMatch = thRegex.exec(tableContent)) !== null) {
      headers.push(thMatch[1].replace(/<[^>]*>/g, "").trim().toLowerCase());
    }
    const startDateColIndex = headers.indexOf("start date");

    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    const cells: string[] = [];
    while ((match = tdRegex.exec(tableContent)) !== null) {
      const cleanCell = match[1].replace(/<[^>]*>/g, "").trim();
      cells.push(cleanCell);
    }

    if (cells.length >= 8) {
      const valStr = cells[6].replace(/,/g, ""); 
      const remaining_mb = parseFloat(valStr);
      if (!isNaN(remaining_mb)) {
        isUnlimitedPkg = false;
        finalBalance.remaining_mb = remaining_mb;
        finalBalance.remaining_gb = remaining_mb / 1024;
        finalBalance.isUnlimited = false;

        // Pull correct subscription start date from the traffic table matching <th>Start Date</th>
        if (startDateColIndex !== -1 && cells.length > startDateColIndex) {
          startDate = cells[startDateColIndex];
        } else if (cells.length >= 5) {
          startDate = cells[4];
        }
      }
    }
  }

  if (isUnlimitedPkg) {
    finalBalance.remaining_mb = -1;
    finalBalance.remaining_gb = -1;
    finalBalance.isUnlimited = true;
  }

  try {
    // 1. Zipped align scanning of text-1 (label) and text-2 (value) pairs in the page
    const text1Regex = /class=["'][^"']*text-1[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    const text2Regex = /class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

    const allText1: string[] = [];
    const allText2: string[] = [];

    let m1;
    while ((m1 = text1Regex.exec(html)) !== null) {
      allText1.push(m1[1].replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " "));
    }
    let m2;
    while ((m2 = text2Regex.exec(html)) !== null) {
      allText2.push(m2[1].replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " "));
    }

    let contractDate = "";
    let activationDate = "";

    for (let i = 0; i < Math.min(allText1.length, allText2.length); i++) {
      const label = allText1[i].toLowerCase();
      const value = allText2[i];
      if (!value) continue;

      if (label.includes("firstname") || label.includes("lastname") || label.includes("اسم") || label.includes("фио") || label.includes("fio")) {
        finalBalance.fullName = value;
      } else if (label.includes("phone") || label.includes("هاتف")) {
        finalBalance.phone = value.replace(/,\s*$/, "");
      } else if (label.includes("address") || label.includes("عنوان")) {
        finalBalance.address = value.replace(/\/\s*$/, "");
      } else if (label.includes("status") || label.includes("حالة")) {
        const valLower = value.toLowerCase();
        if (!finalBalance.status || valLower === "active" || valLower.includes("too small") || valLower.includes("suspended") || valLower.includes("inactive") || valLower.includes("deposit") || value.includes("نشط")) {
          finalBalance.status = value;
        }
      } else if (label.includes("activation") || label.includes("تفعيل") || label.includes("بداية الاشتراك")) {
        activationDate = value;
      } else if (label.includes("contract date") || label.includes("تاريخ العقد")) {
        contractDate = value;
      } else if (label.includes("deposit") || label.includes("رصيد")) {
        const m = value.match(/[-\d.]+/);
        if (m) finalBalance.deposit = m[0];
      } else if (label.includes("month fee") || label.includes("monthly fee") || label.includes("سعر الباقة") || label.includes("قيمة الاشتراك") || label.includes("رسوم الاشتراك") || label.includes("tarif plan fee")) {
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.monthFee = m[0];
      } else if (label.includes("credit") || label.includes("كريدت") || label.includes("الرصيد الممنوح") || label.includes("الائتمان")) {
        const amountMatch = value.match(/[-\d.]+/);
        if (amountMatch) {
          finalBalance.creditAmount = amountMatch[0];
        }
        const dateMatch = value.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          finalBalance.creditExpiry = dateMatch[1];
        }
      }
    }

    // 2. Fallback robust regex loop in case zipping elements align shifts
    const rowRegex = /<div[^>]*class=["'][^"']*text-1[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const label = rowMatch[1].replace(/<[^>]*>/g, "").trim().toLowerCase();
      const value = rowMatch[2].replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " ");

      if ((label.includes("firstname") || label.includes("lastname")) && !finalBalance.fullName) {
        finalBalance.fullName = value;
      } else if (label.includes("phone") && !finalBalance.phone) {
        finalBalance.phone = value.replace(/,\s*$/, "");
      } else if (label.includes("address") && !finalBalance.address) {
        finalBalance.address = value.replace(/\/\s*$/, "");
      } else if (label.includes("status") && !finalBalance.status) {
        finalBalance.status = value;
      } else if (label.includes("activation") || label.includes("تفعيل") || label.includes("بداية الاشتراك")) {
        if (!activationDate) activationDate = value;
      } else if (label.includes("contract date") || label.includes("تاريخ العقد")) {
        if (!contractDate) contractDate = value;
      } else if (label.includes("deposit") && !finalBalance.deposit) {
        const m = value.match(/[-\d.]+/);
        if (m) finalBalance.deposit = m[0];
      } else if ((label.includes("month fee") || label.includes("monthly fee") || label.includes("سعر الباقة") || label.includes("قيمة الاشتراك") || label.includes("رسوم الاشتراك")) && !finalBalance.monthFee) {
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.monthFee = m[0];
      } else if ((label.includes("credit") || label.includes("كريدت") || label.includes("الرصيد الممنوح") || label.includes("الائتمان")) && !finalBalance.creditAmount) {
        const amountMatch = value.match(/[-\d.]+/);
        if (amountMatch) {
          finalBalance.creditAmount = amountMatch[0];
        }
        const dateMatch = value.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          finalBalance.creditExpiry = dateMatch[1];
        }
      }
    }

    const finalStart = activationDate || contractDate;
    if (finalStart) {
      startDate = finalStart;
    }

    // 3. Robust input-based CUSTOMER form scraper fallback
    if (!finalBalance.fullName) {
      const customerMatch = html.match(/name=["']CUSTOMER["']\s+value=["']([^"']+)["']/i) || 
                            html.match(/value=["']([^"']+)["']\s+name=["']CUSTOMER["']/i);
      if (customerMatch && customerMatch[1]) {
        finalBalance.fullName = customerMatch[1].trim();
      }
    }

    // 4. Rus/Eng Rules message greeting fallback
    if (!finalBalance.fullName) {
      const uvažajemMatch = html.match(/Уважаемый,\s*<b>\s*([^<]+?)\s*<\/b>/i) || 
                           html.match(/Dear,\s*<b>\s*([^<]+?)\s*<\/b>/i);
      if (uvažajemMatch && uvažajemMatch[1]) {
        finalBalance.fullName = uvažajemMatch[1].trim();
      }
    }

    // 5. Hard regex search for Firstname, Lastname table
    if (!finalBalance.fullName) {
      const hardMatch = html.match(/(?:Firstname|Lastname|الاسم|ФИО)[\s\S]*?<div[^>]*class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (hardMatch) {
        finalBalance.fullName = hardMatch[1].replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " ");
      }
    }

    // If status is still empty, search for Status Specifically
    if (!finalBalance.status) {
      const statusMatch = html.match(/Status<\/div>\s*<div[^>]+class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (statusMatch) {
        finalBalance.status = statusMatch[1].replace(/<[^>]*>/g, "").trim();
      }
    }

    if (startDate) finalBalance.startDate = startDate;

    // Parse end date by scanning active ranges like (2026-06-01-2026-06-30) or next payment date callout
    let parsedEndDate = "";
    const nextPaymentDateMatch = html.match(/(?:after\s+\d+\s+days|الأيام|periodic\s+payment\s+after\s+\d+\s+days)\s*(\d{4}-\d{2}-\d{2})/i);
    if (nextPaymentDateMatch) {
      parsedEndDate = nextPaymentDateMatch[1];
    }

    if (!parsedEndDate) {
      const rangeMatch = html.match(/(\d{4}-\d{2}-\d{2})\s*[-—–]\s*(\d{4}-\d{2}-\d{2})/);
      if (rangeMatch) {
        parsedEndDate = rangeMatch[2];
      } else if (startDate) {
        try {
          const sDate = new Date(startDate);
          if (!isNaN(sDate.getTime())) {
            sDate.setDate(sDate.getDate() + 30);
            const yyyy = sDate.getFullYear();
            const mm = String(sDate.getMonth() + 1).padStart(2, '0');
            const dd = String(sDate.getDate()).padStart(2, '0');
            parsedEndDate = `${yyyy}-${mm}-${dd}`;
          }
        } catch (e) {
          console.error("Error calculating end date:", e);
        }
      }
    }
    if (parsedEndDate) {
      finalBalance.endDate = parsedEndDate;
    }

    // Parse next payment callout
    const specificCalloutRegex = /<div[^>]+class=["'][^"']*callout\s+callout-success[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>|$)/i;
    const calloutMatch = html.match(specificCalloutRegex);
    let rawCalloutText = "";
    if (calloutMatch) {
      let calloutText = calloutMatch[1];
      // Completely discard any <h4>...</h4> elements to avoid displaying package symbols/codes (like HU-100 or others)
      calloutText = calloutText.replace(/<h4[^>]*>[\s\S]*?<\/h4>/gi, "");
      
      const cleanLines = calloutText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);
      
      let cleanText = cleanLines.join("\n");
      cleanText = cleanText.split("\n")
        .map(line => line.replace(/hu[-_ ]?100/gi, "").trim())
        .filter(Boolean)
        .join("\n");

      rawCalloutText = cleanText;
      // Completely strip occurrences of hu-100/hu100
      rawCalloutText = rawCalloutText.split("\n")
        .map(line => line.replace(/hu[-_ ]?100/gi, "").trim())
        .filter(Boolean)
        .join("\n");
      finalBalance.nextPayment = rawCalloutText;
    }

    if (!finalBalance.monthFee && rawCalloutText) {
      const sumMatch = rawCalloutText.match(/(?:Sum|السعر|القيمة|قيمة|رسوم):\s*([\d.]+)/i);
      if (sumMatch) {
        finalBalance.monthFee = sumMatch[1];
      }
    }

    if (!finalBalance.monthFee) {
      const mFeeMatch = html.match(/(?:Month fee|رسوم الاشتراك|قيمة الاشتراك|سعر الاشتراك)[\s\S]*?<div[^>]*class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (mFeeMatch) {
        const m = mFeeMatch[1].replace(/<[^>]*>/g, "").match(/[\d.]+/);
        if (m) finalBalance.monthFee = m[0];
      }
    }

    if (!finalBalance.monthFee) {
      // Default to 100.00 LYD if we absolutely cannot parse it
      finalBalance.monthFee = "100.00";
    }

    // Speed parser
    let speed = "";
    if (rawCalloutText) {
      // Find 10M, 15M, 20M, 10 Mbps etc.
      const sMatch = rawCalloutText.match(/(\d+(?:\s*(?:Mbps|M|Mb\/s|ميجا|ميغابت|ميجابت|Gbps|G)))/gi);
      if (sMatch && sMatch.length > 0) {
        speed = sMatch[0];
      }
    }
    if (!speed) {
      const speedRegex = /(?:speed|السرعة|سرعة|shaping|rate\s+limit|bandwidth)[\s\S]*?<div[^>]*class=["'][^"']*text-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
      const sMatch2 = html.match(speedRegex);
      if (sMatch2) {
        speed = sMatch2[1].replace(/<[^>]*>/g, "").trim();
      }
    }
    if (!speed) {
      const h4Match = html.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
      if (h4Match) {
        const planName = h4Match[1].replace(/<[^>]*>/g, "").trim();
        const planSpeedMatch = planName.match(/(\d+\s*(?:M|Mbps|Kbps|K|Mb\/s|G))/i);
        if (planSpeedMatch) {
          speed = planSpeedMatch[1];
        } else {
          speed = planName;
        }
      }
    }
    
    // If we can't find and it is unlimited, default to showing a nice text
    if (!speed && isUnlimitedPkg) {
      speed = "10 Mbps"; // A standard default speed indicator for Icona unlimited packages
    }
    
    if (speed) {
      speed = speed.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&sect;/gi, "").trim();
      // Remove "hu-100" or variants case-insensitively as requested by user
      speed = speed.replace(/hu[-_ ]?100/gi, "").replace(/h[-_ ]?100/gi, "").trim();
      // Clean up any remaining double spaces, leading/trailing hyphens, underscores or slashes
      speed = speed.replace(/^[-_/\s]+|[-_/\s]+$/g, "").replace(/\s+/g, " ").trim();
      finalBalance.speed = speed || "10 Mbps";
    }

  } catch (err) {
    console.error("Error parsing additional details:", err);
  }

  return finalBalance;
}

/**
 * Extracts all chart data or numeric series from the statistics page,
 * finds the local peaks (apex values), and calculates their integer average.
 */
function analyzeHighchartsSpeed(htmlOrData: any): any {
  const defaultAnalysis = {
    expectedPackage: "10 Mbps",
    confidence: 60,
    peakSpeed: "---",
    avgPeakSpeed: "---",
    p95Speed: "---",
    p98Speed: "---",
    mostFrequentPeak: "---",
    reason: "لا توجد بيانات كافية في الرسم البياني لتحديد السرعة بشكل مطلع لعدم وجود استهلاك نشط كافٍ على الخط.",
    warning: "تحذير: البيانات المسترجعة من الرسم البياني غير كافية أو فارغة للتحليل.",
    chartDataFound: false
  };

  if (!htmlOrData) return defaultAnalysis;

  let content = "";
  let rawObj: any = null;

  if (typeof htmlOrData === "object") {
    rawObj = htmlOrData;
    content = JSON.stringify(htmlOrData);
  } else {
    content = String(htmlOrData);
    try {
      rawObj = JSON.parse(content);
    } catch (_) {
      // Ignored
    }
  }

  // We will collect data points as { timestamp: number | null, value: number }
  const dataPoints: { timestamp: number | null; value: number }[] = [];

  // Helper to determine if a value is a valid timestamp
  const isValidTimestampObj = (num: number): boolean => {
    return typeof num === "number" && !isNaN(num) && num > 1000000;
  };

  // 1. Process JSON Object if available
  if (rawObj) {
    const traverse = (val: any) => {
      if (Array.isArray(val)) {
        if (val.length === 2 && typeof val[0] === "number" && typeof val[1] === "number") {
          if (isValidTimestampObj(val[0])) {
            dataPoints.push({ timestamp: val[0], value: val[1] });
          } else {
            dataPoints.push({ timestamp: null, value: val[1] });
          }
        } else {
          val.forEach(item => traverse(item));
        }
      } else if (val && typeof val === "object") {
        Object.keys(val).forEach(key => traverse(val[key]));
      } else if (typeof val === "number") {
        dataPoints.push({ timestamp: null, value: val });
      }
    };
    traverse(rawObj);
  }

  // 2. Regex search for [[timestamp, value], ...] combinations inside HTML/Javascript string
  const tupleRegex = /\[\s*(\d{9,13})\s*,\s*([\d.]+)\s*\]/g;
  let match;
  while ((match = tupleRegex.exec(content)) !== null) {
    const ts = parseInt(match[1], 10);
    const val = parseFloat(match[2]);
    if (!isNaN(ts) && !isNaN(val)) {
      dataPoints.push({ timestamp: ts, value: val });
    }
  }

  // Also match general arrays if nothing found by tuple regex
  if (dataPoints.length === 0) {
    const arrayMatches = content.match(/\[\s*[\d.]+(?:\s*,\s*[\d.]+)*\s*\]/g);
    if (arrayMatches) {
      for (const arrStr of arrayMatches) {
        try {
          const parsed = JSON.parse(arrStr);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof item === "number") {
                dataPoints.push({ timestamp: null, value: item });
              } else if (Array.isArray(item) && typeof item[0] === "number" && typeof item[1] === "number") {
                dataPoints.push({ timestamp: item[0] > 1000000 ? item[0] : null, value: item[1] });
              } else if (Array.isArray(item) && typeof item[1] === "number") {
                dataPoints.push({ timestamp: null, value: item[1] });
              }
            }
          }
        } catch (_) {
          // Regex fallback
          const matches = arrStr.match(/[\d.]+/g);
          if (matches) {
            matches.forEach(m => {
              const num = parseFloat(m);
              if (!isNaN(num)) dataPoints.push({ timestamp: null, value: num });
            });
          }
        }
      }
    }
  }

  // 3. Robust SVG path coordinates
  const pathMatches = content.match(/d\s*=\s*['"]\s*M\s*[^'"]+['"]/gi);
  if (pathMatches) {
    pathMatches.forEach(pathStr => {
      const coordTokens = pathStr.match(/[\d.]+/g);
      if (coordTokens && coordTokens.length > 4) {
        const yCoords: number[] = [];
        for (let i = 1; i < coordTokens.length; i += 2) {
          const y = parseFloat(coordTokens[i]);
          if (!isNaN(y)) yCoords.push(y);
        }
        if (yCoords.length > 5) {
          const maxY = Math.max(...yCoords);
          const minY = Math.min(...yCoords);
          const h = maxY - minY;
          if (h > 10) {
            yCoords.forEach(y => {
              const norm = (maxY - y) / h;
              dataPoints.push({ timestamp: null, value: norm * 50 });
            });
          }
        }
      }
    });
  }

  // Find max timestamp in dataset to anchor our filter
  let maxTimestamp = 0;
  dataPoints.forEach(p => {
    if (p.timestamp && p.timestamp > maxTimestamp) {
      maxTimestamp = p.timestamp;
    }
  });

  // Is maxTimestamp present? Let's check if it's seconds or milliseconds
  let isMs = false;
  if (maxTimestamp > 100000000000) {
    isMs = true;
  }

  const fiveHoursInterval = 5 * 60 * 60 * 1000; // 5 hours in ms
  const fiveHoursIntervalSec = 5 * 60 * 60; // 5 hours in seconds

  const filterThreshold = isMs 
    ? maxTimestamp - fiveHoursInterval 
    : maxTimestamp - fiveHoursIntervalSec;

  // Filter data points:
  // - If it has a timestamp, it MUST be >= filterThreshold (within the last 5 hours of the latest data point).
  // - If it does NOT have a timestamp, we keep it.
  let filteredPoints = dataPoints;
  if (maxTimestamp > 0) {
    filteredPoints = dataPoints.filter(p => {
      if (p.timestamp === null) return true; // keep fallback non-timestamped points
      return p.timestamp >= filterThreshold;
    });
  }

  const rawNumbers = filteredPoints.map(p => p.value);

  // 4. Default string rate extraction if nothing found
  if (rawNumbers.length === 0) {
    const rateMatches = content.match(/(?:rate|speed|kbps|mbps|val|value|y|data|point)[\s\S]{0,10}?([\d.]+)/gi);
    if (rateMatches) {
      rateMatches.forEach(m => {
        const numMatch = m.match(/[\d.]+/);
        if (numMatch) {
          const num = parseFloat(numMatch[0]);
          if (!isNaN(num) && num > 0) rawNumbers.push(num);
        }
      });
    }
  }

  // Filter out zero/near-zero values (inactive connection) to get active utilization
  let activeSpeeds = rawNumbers.filter(n => n > 0.05);

  if (activeSpeeds.length === 0) {
    return {
      ...defaultAnalysis,
      reason: "لم يتم رصد أي نشاط تصفح أو تحميل نشط في الرسم البياني للحساب حالياً لتقدير السرعة القصوى للخط.",
      warning: "تنبيه: لا يوجد استهلاك نشط كافٍ على الخط حالياً لتقدير سرعة الباقة بشكل دقيق."
    };
  }

  // Normalize speeds if they are in bps, kbps
  const tempAvg = activeSpeeds.reduce((a, b) => a + b, 0) / activeSpeeds.length;
  if (tempAvg > 5000000) {
    activeSpeeds = activeSpeeds.map(n => n / 1000000);
  } else if (tempAvg > 5000) {
    activeSpeeds = activeSpeeds.map(n => n / 1000);
  }

  // Filter speeds again on Mbps basis
  activeSpeeds = activeSpeeds.filter(n => n < 1200);

  // Calculate statistics
  const sorted = [...activeSpeeds].sort((a, b) => a - b);
  const nElement = sorted.length;

  // Percentiles
  const p95Val = sorted[Math.min(Math.floor(nElement * 0.95), nElement - 1)];
  const p98Val = sorted[Math.min(Math.floor(nElement * 0.98), nElement - 1)];
  const p85Val = sorted[Math.min(Math.floor(nElement * 0.85), nElement - 1)]; // stable peak indicator

  // Extract local peaks
  const localPeaks: number[] = [];
  if (activeSpeeds.length === 1) {
    localPeaks.push(activeSpeeds[0]);
  } else {
    for (let i = 0; i < activeSpeeds.length; i++) {
      const curr = activeSpeeds[i];
      const prev = i > 0 ? activeSpeeds[i - 1] : 0;
      const next = i < activeSpeeds.length - 1 ? activeSpeeds[i + 1] : 0;
      if (curr >= prev && curr >= next && curr > 0.5) {
        localPeaks.push(curr);
      }
    }
  }

  const peaksToUse = localPeaks.length > 0 ? localPeaks : activeSpeeds;
  const maxObserved = Math.max(...activeSpeeds);
  const avgPeak = peaksToUse.reduce((a, b) => a + b, 0) / peaksToUse.length;

  // Determine most frequent peak level by binning peak values in 1 Mbps intervals
  const bins: { [key: number]: number } = {};
  peaksToUse.forEach(p => {
    const binVal = Math.round(p);
    bins[binVal] = (bins[binVal] || 0) + 1;
  });
  let mostFreqBin = 10;
  let maxCount = -1;
  Object.keys(bins).forEach(binStr => {
    const b = parseInt(binStr);
    if (bins[b] > maxCount) {
      maxCount = bins[b];
      mostFreqBin = b;
    }
  });

  // Target standard packages speed company list (strictly matched from fly-leaf images!)
  const standardSpeeds = [1, 2, 4, 5, 10, 50];

  // Align to the closest logical package cap.
  const stablePeakRef = Math.max(p85Val, avgPeak);

  let matchedPackage = 4;
  let found = false;

  // Select closest package where Cap * 1.15 >= stablePeakRef
  for (const cap of standardSpeeds) {
    if (cap * 1.15 >= stablePeakRef) {
      matchedPackage = cap;
      found = true;
      break;
    }
  }
  if (!found) {
    matchedPackage = Math.round(stablePeakRef);
  }

  // Calculate confidence score
  let confidence = 95;
  let warnings: string[] = [];

  if (nElement < 15) {
    confidence -= 35;
    warnings.push("مستوى البيانات المسترجعة ضئيل جداً لتأكيد موثوقية عالية.");
  }

  // check if there is high standard deviation / instability which degrades confidence
  const variance = activeSpeeds.reduce((sum, item) => sum + Math.pow(item - avgPeak, 2), 0) / activeSpeeds.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev / avgPeak > 0.4) {
    confidence -= 15;
    warnings.push("يوجد تذبذب كبير في معدل السرعات المرصودة، قد يكون الخط غير مستقر.");
  }

  // Check if data seems clipped (all peak values hitting exactly the same limit)
  const hitsCapCount = activeSpeeds.filter(p => Math.abs(p - p95Val) < 0.2).length;
  const clippedRatio = hitsCapCount / activeSpeeds.length;
  let isClipped = false;
  if (clippedRatio > 0.25 && activeSpeeds.length > 10) {
    isClipped = true;
    confidence += 5; // Flat plateau ceiling increases confidence
  }

  confidence = Math.max(30, Math.min(99, confidence));

  const reason = isClipped
    ? `تم رصد استقرار وثبات تام (Plateau) متكرر عند مستوى ${p95Val.toFixed(1)} Mbps مما يؤكد تفعيل محدد السرعة الأقصى لهذه الباقة لباقة ${matchedPackage} Mbps.`
    : `استقرار متوسط القمم النشطة للخط عند حوالي ${avgPeak.toFixed(1)} Mbps مع بلوغ مستويات Percentile 95 بنحو ${p95Val.toFixed(1)} Mbps يشير بوضوح إلى تفعيل ملف سرعة باقة ${matchedPackage} Mbps على بورت المشترك.`;

  const warningMsg = warnings.length > 0 ? warnings.join(" | ") : undefined;

  return {
    expectedPackage: `${matchedPackage} Mbps`,
    confidence,
    peakSpeed: `${maxObserved.toFixed(1)} Mbps`,
    avgPeakSpeed: `${avgPeak.toFixed(1)} Mbps`,
    p95Speed: `${p95Val.toFixed(1)} Mbps`,
    p98Speed: `${p98Val.toFixed(1)} Mbps`,
    mostFrequentPeak: `${mostFreqBin} Mbps`,
    reason,
    warning: warningMsg,
    chartDataFound: true
  };
}

function extractAndCalculateStatsSpeed(htmlOrData: any): string | undefined {
  const analysis = analyzeHighchartsSpeed(htmlOrData);
  return analysis ? analysis.expectedPackage : undefined;
}

// API Endpoints

// 1. LOGIN API
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message_ar: "يرجى إدخال اسم المستخدم وكلمة المرور.",
      message_en: "Please enter username and password."
    });
  }

  const result = await performLoginAndScrape(username, password);
  if (!result.success || !verifyLoginSuccess(result.html)) {
    return res.status(401).json({
      success: false,
      message_ar: "اسم المستخدم أو كلمة المرور خاطئة. يرجى المحاولة مرة أخرى.",
      message_en: "Incorrect username or password. Please try again."
    });
  }

  const balance = parseBalance(result.html);
  if (!balance) {
    return res.status(422).json({
      success: false,
      message_ar: "تعذر تحليل بيانات الرصيد من جدول بوابة الخدمة.",
      message_en: "Failed to parse balance information from portal table."
    });
  }

  // Unlimited speed analysis features deactivated as requested by user
  /*
  if (balance.isUnlimited) {
    console.log(`Unlimited profile found for user ${username}. Fetching Highcharts traffic statistics...`);
    const statsData = await fetchStatsPage(result.cookies);
    if (statsData) {
      balance.speedAnalysis = analyzeHighchartsSpeed(statsData);
    }
  }
  */

  // Create active session
  const token = crypto.randomUUID();
  sessions.set(token, {
    username,
    password, // Store credentials to enable seamless invisible automatic login refresh on subsequent queries
    cookies: result.cookies,
    lastActive: Date.now()
  });

  return res.json({
    success: true,
    token,
    balance,
    username
  });
});

// 2. REFRESH BALANCE API
app.post("/api/balance", async (req, res) => {
  const authHeader = req.headers.authorization || req.headers["x-session-token"];
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message_ar: "غير مصرح به. الرجاء تسجيل الدخول.",
      message_en: "Unauthorized. Please log in."
    });
  }

  const token = typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : "";
  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      code: "SESSION_EXPIRED",
      message_ar: "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.",
      message_en: "Session expired. Please log in again."
    });
  }

  // Attemp directly using current active cookies
  let html = await fetchProfilePage(session.cookies);
  let balance = (html && verifyLoginSuccess(html)) ? parseBalance(html) : null;

  // If fetching with cookies fails or session expired on ISP, automatically execute re-login
  if (!balance && session.password) {
    console.log(`Auto-refreshing ISP cookies for user: ${session.username}`);
    const result = await performLoginAndScrape(session.username, session.password);
    if (result.success && verifyLoginSuccess(result.html)) {
      // Update session map
      session.cookies = result.cookies;
      session.lastActive = Date.now();
      sessions.set(token, session);

      // Re-parse balance
      balance = parseBalance(result.html);
    }
  }

  if (!balance) {
    return res.status(502).json({
      success: false,
      message_ar: "تعذر تحديث الرصيد من بوابة الخدمة حالياً، يرجى المحاولة لاحقاً.",
      message_en: "Could not retrieve balance from ISP portal at the moment, please try again later."
    });
  }

  // Unlimited speed analysis features deactivated as requested by user
  /*
  if (balance.isUnlimited) {
    console.log(`Unlimited profile found for user ${session.username} on refresh. Fetching Highcharts traffic statistics...`);
    const statsData = await fetchStatsPage(session.cookies);
    if (statsData) {
      balance.speedAnalysis = analyzeHighchartsSpeed(statsData);
    }
  }
  */

  session.lastActive = Date.now();
  return res.json({
    success: true,
    balance
  });
});

// 3. LOGOUT API
app.post("/api/logout", (req, res) => {
  const authHeader = req.headers.authorization || req.headers["x-session-token"];
  if (authHeader) {
    const token = typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : "";
    sessions.delete(token);
  }
  return res.json({ success: true });
});

// Setup Vite Dev server middleware or static deployment serve
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server starting on port ${PORT}`);
  });
}

startServer();
