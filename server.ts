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
}

function parseBalance(html: string): BalanceData | null {
  if (!html) return null;
  
  // Tag match for table id="PREAPID_TRAFIC_"
  const tableRegex = /<table[^>]*id=["']PREAPID_TRAFIC_["'][^>]*>([\s\S]*?)<\/table>/i;
  const tableMatch = html.match(tableRegex);
  if (!tableMatch) {
    return null;
  }

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

  let finalBalance: BalanceData | null = null;

  // Cell index corresponding to original Python: cells[6] is MB
  if (cells.length >= 8) {
    const valStr = cells[6].replace(/,/g, ""); 
    const remaining_mb = parseFloat(valStr);
    if (!isNaN(remaining_mb)) {
      const remaining_gb = remaining_mb / 1024;
      finalBalance = {
        remaining_mb,
        remaining_gb
      };
      // Pull correct subscription start date from the traffic table matching <th>Start Date</th>
      if (startDateColIndex !== -1 && cells.length > startDateColIndex) {
        finalBalance.startDate = cells[startDateColIndex];
      } else if (cells.length >= 5) {
        finalBalance.startDate = cells[4];
      }

      // Parse end date by scanning active ranges like (2026-06-01-2026-06-30) or calculating +30 days
      let parsedEndDate = "";
      
      // Look for a date in the next payment callout text (e.g. after 30 days 2026-06-30 or الأيام 2026-06-30)
      const nextPaymentDateMatch = html.match(/(?:after\s+\d+\s+days|الأيام|periodic\s+payment\s+after\s+\d+\s+days)\s*(\d{4}-\d{2}-\d{2})/i);
      if (nextPaymentDateMatch) {
        parsedEndDate = nextPaymentDateMatch[1];
      }

      if (!parsedEndDate) {
        const rangeMatch = html.match(/(\d{4}-\d{2}-\d{2})\s*[-—–]\s*(\d{4}-\d{2}-\d{2})/);
        if (rangeMatch) {
          parsedEndDate = rangeMatch[2];
        } else if (finalBalance.startDate) {
          try {
            const sDate = new Date(finalBalance.startDate);
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
    }
  }

  if (finalBalance) {
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
        } else if (label.includes("contract date") || label.includes("activation") || label.includes("تاريخ العقد")) {
          if (!finalBalance.startDate) {
            finalBalance.startDate = value;
          }
        } else if (label.includes("deposit") || label.includes("رصيد")) {
          const m = value.match(/[\d.]+/);
          if (m) finalBalance.deposit = m[0];
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
        } else if ((label.includes("contract date") || label.includes("activation")) && !finalBalance.startDate) {
          finalBalance.startDate = value;
        } else if (label.includes("deposit") && !finalBalance.deposit) {
          const m = value.match(/[\d.]+/);
          if (m) finalBalance.deposit = m[0];
        }
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

      // Parse next payment callout
      // <div class="callout callout-success text-left" bis_skin_checked="1">
      //   <h4> B-50G</h4>الدفعة التالية الدورية بعد 30 من الأيام<br>مجموع: 90.00</div>
      const calloutRegex = /<div[^>]+class=["']/i; // Wait, let's use a more robust one
      const specificCalloutRegex = /<div[^>]+class=["'][^"']*callout\s+callout-success[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>|$)/i;
      const calloutMatch = html.match(specificCalloutRegex);
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
        finalBalance.nextPayment = plan ? `${plan}\n${cleanText}` : cleanText;
      }
    } catch (err) {
      console.error("Error parsing additional details:", err);
    }
  }

  return finalBalance;
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
