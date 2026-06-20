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
  isUnlimited?: boolean;
  speed?: string;
  monthFee?: string;
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
        if (!finalBalance.status || value.toLowerCase() === "active" || value.includes("نشط")) {
          finalBalance.status = value;
        }
      } else if (label.includes("activation") || label.includes("تفعيل") || label.includes("بداية الاشتراك")) {
        activationDate = value;
      } else if (label.includes("contract date") || label.includes("تاريخ العقد")) {
        contractDate = value;
      } else if (label.includes("deposit") || label.includes("رصيد")) {
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.deposit = m[0];
      } else if (label.includes("month fee") || label.includes("monthly fee") || label.includes("سعر الباقة") || label.includes("قيمة الاشتراك") || label.includes("رسوم الاشتراك") || label.includes("tarif plan fee")) {
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.monthFee = m[0];
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
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.deposit = m[0];
      } else if ((label.includes("month fee") || label.includes("monthly fee") || label.includes("سعر الباقة") || label.includes("قيمة الاشتراك") || label.includes("رسوم الاشتراك")) && !finalBalance.monthFee) {
        const m = value.match(/[\d.]+/);
        if (m) finalBalance.monthFee = m[0];
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
      const h4Match = calloutText.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
      let plan = "";
      if (h4Match) {
        plan = h4Match[1].replace(/<[^>]*>/g, "").trim();
        calloutText = calloutText.replace(/<h4[^>]*>[\s\S]*?<\/h4>/i, "");
      }
      const cleanLines = calloutText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);
      
      const cleanText = cleanLines.join("\n");
      rawCalloutText = plan ? `${plan}\n${cleanText}` : cleanText;
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
      finalBalance.speed = speed;
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
function extractAndCalculateStatsSpeed(htmlOrData: any): string | undefined {
  if (!htmlOrData) return undefined;

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

  const numbers: number[] = [];

  // If we successfully obtained a JSON object, traverse and extract all numbers
  if (rawObj) {
    const traverse = (val: any) => {
      if (typeof val === "number") {
        numbers.push(val);
      } else if (Array.isArray(val)) {
        if (val.length === 2 && typeof val[0] === "number" && typeof val[1] === "number" && val[0] > 1000000) {
          // Typically [timestamp, speedMBps] or [x, y]
          numbers.push(val[1]);
        } else {
          val.forEach(item => traverse(item));
        }
      } else if (val && typeof val === "object") {
        Object.keys(val).forEach(key => traverse(val[key]));
      }
    };
    traverse(rawObj);
  }

  // Also search for JSON arrays via regex inside strings (HTML/JavaScript containing Highcharts series data)
  const arrayMatches = content.match(/\[\s*[\d.]+(?:\s*,\s*[\d.]+)*\s*\]/g);
  if (arrayMatches) {
    for (const arrStr of arrayMatches) {
      try {
        const parsed = JSON.parse(arrStr);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "number") {
              numbers.push(item);
            } else if (Array.isArray(item) && typeof item[1] === "number") {
              numbers.push(item[1]);
            }
          }
        }
      } catch (e) {
        // Fallback robust extraction for numbers inside brackets
        const matches = arrStr.match(/[\d.]+/g);
        if (matches) {
          matches.forEach(m => {
            const num = parseFloat(m);
            if (!isNaN(num)) numbers.push(num);
          });
        }
      }
    }
  }

  // Fallback: If no numbers extracted, search for values associated with rates or y coordinate labels
  if (numbers.length === 0) {
    const rateMatches = content.match(/(?:rate|speed|kbps|mbps|val|value|y|data|point)[\s\S]{0,10}?([\d.]+)/gi);
    if (rateMatches) {
      rateMatches.forEach(m => {
        const numMatch = m.match(/[\d.]+/);
        if (numMatch) {
          const num = parseFloat(numMatch[0]);
          if (!isNaN(num) && num > 0) numbers.push(num);
        }
      });
    }
  }

  // Filter out extremely low or inactive values (less than 0.1 Mbps) to focus on active usage peaks
  let activeSpeeds = numbers.filter(n => n > 0.1);
  if (activeSpeeds.length === 0) return undefined;

  // Let's normalize high numbers if they represent bps or kbps
  const tempAvg = activeSpeeds.reduce((a, b) => a + b, 0) / activeSpeeds.length;
  if (tempAvg > 10000000) {
    // scale down from bps to mbps
    activeSpeeds = activeSpeeds.map(n => n / 1000000);
  } else if (tempAvg > 10000) {
    // scale down from kbps to mbps
    activeSpeeds = activeSpeeds.map(n => n / 1000);
  }

  // Step 1: Sort the speeds ascending to determine percentile values
  const sortedSpeeds = [...activeSpeeds].sort((a, b) => a - b);
  const totalCount = sortedSpeeds.length;

  // Step 2: Extract a robust high-percentile value (85th percentile) to represent max steady speed,
  // completely ignoring top anomalies/single-point outliers (spikes)
  const percentileIndex = Math.min(Math.floor(totalCount * 0.85), totalCount - 1);
  const estimatedPeak = sortedSpeeds[percentileIndex];

  // Step 3: Match the estimated peak to the nearest typical ISP package speed in Mbps
  // Standard package speeds offered are generally: 4, 8, 10, 15, 20, 30, 40, 50, 60, 75, 80, 100, 150, 200, 300, 400, 500, 1000
  const standardSpeeds = [4, 8, 10, 15, 20, 30, 40, 50, 60, 75, 80, 100, 150, 200, 300, 400, 500, 1000];

  let bestMatch = standardSpeeds[0];
  let minDiff = Math.abs(estimatedPeak - bestMatch);

  for (const speed of standardSpeeds) {
    const diff = Math.abs(estimatedPeak - speed);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = speed;
    }
  }

  // If the closest standard speed has a reasonable difference (e.g., within 35% of standard speed value),
  // we use the standard speed to present a clean, rounded package tier.
  // Otherwise, we gracefully round the peak value to the nearest integer.
  let finalSpeedValue = bestMatch;
  if (minDiff > bestMatch * 0.35) {
    finalSpeedValue = Math.round(estimatedPeak);
  }

  // Ensure it's a valid positive speed
  if (finalSpeedValue <= 0) {
    finalSpeedValue = 10; // safe default
  }

  return `${finalSpeedValue} Mbps`;
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
  let balance = parseBalance(html || "");

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
