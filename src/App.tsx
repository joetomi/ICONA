import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Globe, 
  Lock, 
  User, 
  RefreshCw, 
  LogOut, 
  Wifi, 
  Database,
  Layers,
  AlertCircle,
  HelpCircle,
  Activity,
  Moon,
  Sun,
  Check,
  Home,
  Gauge
} from "lucide-react";
import { translations } from "./translations";
import { Language, UserSessionData } from "./types";
// @ts-ignore
import logoImg from "./full-logo.png";
// @ts-ignore
import logoRemoveBg from "./logo-removebg.png";
// @ts-ignore
import bkgImg from "./icona_bkg.png";

const getTranslatedStatus = (statusValue: string | undefined, lang: Language): string => {
  if (!statusValue) return "";
  const val = statusValue.trim().toLowerCase();
  if (lang === "ar") {
    if (val === "active") return "نشط";
    if (val === "inactive") return "غير نشط";
    if (val === "suspended") return "معلق";
    return statusValue;
  }
  return statusValue;
};

const formatNextPayment = (nextPaymentText: string | undefined, language: Language): string => {
  if (!nextPaymentText) return "";
  
  // Strip out hu-100 or variations
  const cleanNextPayment = nextPaymentText.replace(/hu[-_ ]?100/gi, "").trim();
  
  const lines = cleanNextPayment.split("\n");
  
  const processedLines = lines.map(line => {
    let cleanLine = line.trim();
    
    // Replace "B-50G" (or any plan starting with B- or B) with "باقة-50G" / "Package-50G"
    if (/^[Bb](-|\s+|$)/.test(cleanLine) || cleanLine.toLowerCase().startsWith("b-") || cleanLine === "B") {
      if (language === "ar") {
        cleanLine = cleanLine.replace(/^[Bb]-?/i, "باقة ");
      } else {
        cleanLine = cleanLine.replace(/^[Bb]-?/i, "Package ");
      }
    }
    
    // Replace "مجموع" or "SUM" with "مقدار الدفع المطلوب" or "Required Payment Amount"
    if (cleanLine.includes("مجموع:") || cleanLine.toLowerCase().includes("sum:") || cleanLine.toLowerCase().includes("total:")) {
      if (language === "ar") {
        cleanLine = cleanLine.replace(/(مجموع|sum|total)\s*:/i, "مقدار الدفع المطلوب:");
      } else {
        cleanLine = cleanLine.replace(/(مجموع|sum|total)\s*:/i, "Required Payment Amount:");
      }
    }

    // Match both English and Arabic formats of next periodic payment lines
    const arRegex = /(الدفعة التالية الدورية بعد|الدفعة التالية الدورية)\s*(\d+)?(?:\s*من\s*الأيام)?(?:\s*(\d{4}-\d{2}-\d{2}))?/i;
    const enRegex = /Next\s+(?:periodic|recurring)\s+(?:payment|automatic\s+payment)\s+(?:after|is\s+after)\s*(\d+)?(?:\s*days)?(?:\s*(\d{4}-\d{2}-\d{2}))?/i;

    const arMatch = cleanLine.match(arRegex);
    const enMatch = cleanLine.match(enRegex);

    if (arMatch) {
      const days = arMatch[2] || "30";
      const date = arMatch[3] || "";
      if (language === "en") {
        cleanLine = `Next periodic payment after ${days} days${date ? " " + date : ""}`;
      } else {
        cleanLine = `الدفعة التالية الدورية بعد ${days} من الأيام${date ? " " + date : ""}`;
      }
    } else if (enMatch) {
      const days = enMatch[1] || "30";
      const date = enMatch[2] || "";
      if (language === "ar") {
        cleanLine = `الدفعة التالية الدورية بعد ${days} من الأيام${date ? " " + date : ""}`;
      } else {
        cleanLine = `Next periodic payment after ${days} days${date ? " " + date : ""}`;
      }
    }

    return cleanLine;
  });

  return processedLines.join("\n");
};

const isDepositNegative = (depositStr: string | undefined | null): boolean => {
  if (!depositStr) return false;
  // Strip out any non-numeric and non-negative/decimal characters to get a raw number
  const cleaned = String(depositStr).replace(/[^\d.-]/g, "");
  const num = parseFloat(cleaned);
  return !isNaN(num) && num < 0;
};

const isDateBeforeToday = (dateStr: string): boolean => {
  if (!dateStr || dateStr === "0000-00-00" || dateStr === "الرجاء التعبئة" || dateStr === "Please recharge") return false;
  const parts = dateStr.split("-").map(Number);
  if (parts.length === 3) {
    const [y, m, d] = parts;
    if (y && m && d) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const targetDate = new Date(y, m - 1, d);
      targetDate.setHours(0, 0, 0, 0);
      return today > targetDate;
    }
  }
  return false;
};

const getExtractedEndDate = (balanceData: any, lang: Language = "ar"): string => {
  if (!balanceData) return "";
  
  // 1. Determine base date
  let baseDate = "";
  const creditAmountVal = parseFloat(balanceData.creditAmount || "0");
  const hasCredit = !isNaN(creditAmountVal) && creditAmountVal > 0;
  
  if (hasCredit && balanceData.creditExpiry && balanceData.creditExpiry !== "0000-00-00") {
    baseDate = balanceData.creditExpiry;
  } else if (balanceData.nextPayment) {
    const dateMatch = balanceData.nextPayment.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      baseDate = dateMatch[1];
    }
  }
  
  if (!baseDate) {
    baseDate = balanceData.endDate || "";
  }
  
  if (!baseDate) return "";

  // 2. If the base date is before today, return "Please recharge" / "الرجاء التعبئة"
  if (isDateBeforeToday(baseDate)) {
    return lang === "ar" ? "الرجاء التعبئة" : "Please recharge";
  }

  // 3. Calculate extra months based on deposit & credit
  const depositStrCleaned = String(balanceData.deposit || "0").replace(/[^\d.-]/g, "");
  const deposit = parseFloat(depositStrCleaned);
  
  let effectiveDeposit = deposit;
  if (hasCredit) {
    effectiveDeposit = deposit - creditAmountVal;
  }

  // If effectiveDeposit is negative, or if the deposit is negative under old logic
  if (effectiveDeposit < 0 || isDepositNegative(balanceData.deposit)) {
    return baseDate;
  }

  // Calculate pre-paid extensions from effectiveDeposit
  if (balanceData.isUnlimited) {
    const monthFeeStrCleaned = String(balanceData.monthFee || "100.00").replace(/[^\d.-]/g, "");
    const monthFee = parseFloat(monthFeeStrCleaned);
    
    if (monthFee > 0 && effectiveDeposit >= monthFee) {
      const extraMonths = Math.floor(effectiveDeposit / monthFee);
      if (extraMonths > 0) {
        try {
          const parts = baseDate.split("-");
          if (parts.length === 3) {
            let year = parseInt(parts[0], 10);
            let month = parseInt(parts[1], 10);
            let day = parseInt(parts[2], 10);
            
            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
              month += extraMonths;
              while (month > 12) {
                month -= 12;
                year += 1;
              }
              const mm = String(month).padStart(2, '0');
              const dd = String(day).padStart(2, '0');
              const finalDate = `${year}-${mm}-${dd}`;
              
              if (isDateBeforeToday(finalDate)) {
                return lang === "ar" ? "الرجاء التعبئة" : "Please recharge";
              }
              return finalDate;
            }
          }
        } catch (e) {
          console.error("Error calculating extended prepaid next payment date:", e);
        }
      }
    }
  }

  return baseDate;
};

const getPrepaidMonths = (balanceData: any): number => {
  if (!balanceData || !balanceData.isUnlimited) return 0;
  if (isDepositNegative(balanceData.deposit)) return 0;
  
  const depositStrCleaned = String(balanceData.deposit || "0").replace(/[^\d.-]/g, "");
  const deposit = parseFloat(depositStrCleaned);
  const creditAmountVal = parseFloat(balanceData.creditAmount || "0");
  const monthFeeStrCleaned = String(balanceData.monthFee || "100.00").replace(/[^\d.-]/g, "");
  const monthFee = parseFloat(monthFeeStrCleaned);
  
  let effectiveDeposit = deposit;
  if (!isNaN(creditAmountVal) && creditAmountVal > 0) {
    effectiveDeposit = deposit - creditAmountVal;
  }
  
  if (monthFee > 0 && effectiveDeposit >= monthFee) {
    return Math.floor(effectiveDeposit / monthFee);
  }
  return 0;
};

const checkSubscriptionState = (balance: any) => {
  if (!balance) return { expired: false, depleted: false, timeExpired: false, netBalance: 0, totalNeeded: 0 };
  
  const isUnlimited = !!balance.isUnlimited;
  const status = (balance.status || "").trim().toLowerCase();
  
  // Parse deposit, credit, month fee
  const depositStrCleaned = String(balance.deposit || "0").replace(/[^\d.-]/g, "");
  const deposit = parseFloat(depositStrCleaned);
  const creditAmountVal = parseFloat(balance.creditAmount || "0");
  const monthFeeStrCleaned = String(balance.monthFee || "100.00").replace(/[^\d.-]/g, "");
  const monthFee = parseFloat(monthFeeStrCleaned);
  
  const hasCredit = !isNaN(creditAmountVal) && creditAmountVal > 0;
  const netBalance = hasCredit ? deposit - creditAmountVal : deposit;
  const isDepositNeg = netBalance < 0;
  
  // Calculate total required to recharge if netBalance is negative
  let totalNeeded = 0;
  if (hasCredit && deposit < creditAmountVal) {
    const shortage = creditAmountVal - deposit;
    totalNeeded = shortage + monthFee;
  }
  
  // Parse endDate
  const endDateStr = getExtractedEndDate(balance, "ar");
  
  let isTimeExpired = false;
  if (endDateStr) {
    if (endDateStr === "الرجاء التعبئة" || endDateStr === "Please recharge") {
      isTimeExpired = true;
    } else {
      isTimeExpired = isDateBeforeToday(endDateStr);
    }
  }
  
  const inactiveStatus = status === "inactive" || status === "suspended" || status.includes("منتهي") || status.includes("غير نشط") || status.includes("معلق");
  const isExpired = isTimeExpired || inactiveStatus || isDepositNeg;
  
  if (isUnlimited) {
    return { expired: isExpired, depleted: false, timeExpired: isTimeExpired || isDepositNeg, netBalance, totalNeeded };
  } else {
    const remainingGb = balance.remaining_gb !== undefined ? balance.remaining_gb : 0;
    const remainingMb = balance.remaining_mb !== undefined ? balance.remaining_mb : 0;
    const depleted = (remainingGb <= 0 && remainingMb <= 0) || isDepositNeg;
    return { expired: isExpired, depleted, timeExpired: isTimeExpired || isDepositNeg, netBalance, totalNeeded };
  }
};

export default function App() {
  // Config state
  const [lang, setLang] = useState<Language>(() => {
    // Default to 'ar' as requested by the user, or restore from localStorage if preferred
    const saved = localStorage.getItem("icona_lang");
    return (saved === "ar" || saved === "en") ? saved : "ar";
  });

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("icona_theme");
    return saved !== "light"; // Default to dark mode (true)
  });

  // Keep track of theme choice in cache and set html data-theme
  useEffect(() => {
    const theme = isDarkMode ? "dark" : "light";
    localStorage.setItem("icona_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [isDarkMode]);

  // UI state
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLoggingInSuccess, setIsLoggingInSuccess] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [activeTab, setActiveTab] = useState<"home" | "details">("home");

  // Dynamically process logo to remove solid black background and split it into Emblem & Text
  const [processedLogo, setProcessedLogo] = useState<string>(logoImg);
  const [processedEmblem, setProcessedEmblem] = useState<string>("");
  const [processedText, setProcessedText] = useState<string>("");

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = logoImg;
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        // Base division point: Emblem resides on the left (about 37% of width)
        const splitX = Math.round(width * 0.37);

        // 1. Process full logo (removed black background, paint everything beautiful gold)
        const canvasFull = document.createElement("canvas");
        canvasFull.width = width;
        canvasFull.height = height;
        const ctxFull = canvasFull.getContext("2d");
        if (ctxFull) {
          ctxFull.drawImage(img, 0, 0);
          const imgData = ctxFull.getImageData(0, 0, width, height);
          const dFull = imgData.data;
          
          for (let i = 0; i < dFull.length; i += 4) {
            const r = dFull[i];
            const g = dFull[i + 1];
            const b = dFull[i + 2];
            const avg = (r + g + b) / 3;
            // Transparentize black/dark backgrounds smoothly
            if (avg < 45) {
              dFull[i + 3] = 0;
            } else {
              // Unify to exquisite Gold (#D4AF37)
              dFull[i] = 212;
              dFull[i + 1] = 175;
              dFull[i + 2] = 55;
            }
          }
          ctxFull.putImageData(imgData, 0, 0);
          setProcessedLogo(canvasFull.toDataURL("image/png"));
        }

        // 2. Create emblem canvas (Left 37%) - painted gold
        const canvasEmblem = document.createElement("canvas");
        canvasEmblem.width = splitX;
        canvasEmblem.height = height;
        const ctxEmblem = canvasEmblem.getContext("2d");
        if (ctxEmblem && ctxFull) {
          ctxEmblem.drawImage(canvasFull, 0, 0, splitX, height, 0, 0, splitX, height);
          setProcessedEmblem(canvasEmblem.toDataURL("image/png"));
        }

        // 3. Create text canvas (Right 63%) - painted gold
        const canvasText = document.createElement("canvas");
        const textWidth = width - splitX;
        canvasText.width = textWidth;
        canvasText.height = height;
        const ctxText = canvasText.getContext("2d");
        if (ctxText && ctxFull) {
          ctxText.drawImage(canvasFull, splitX, 0, textWidth, height, 0, 0, textWidth, height);
          setProcessedText(canvasText.toDataURL("image/png"));
        }
      } catch (err) {
        console.error("Canvas rendering error, fallback to default", err);
      }
    };
    img.onerror = () => {
      console.warn("Could not load logoImg for canvas processing");
    };
  }, []);

  // Splash screen state
  const [showSplash, setShowSplash] = useState(true);

  // Session state
  const [session, setSession] = useState<UserSessionData | null>(() => {
    try {
      const saved = localStorage.getItem("icona_session");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Error reading session from cache:", e);
    }
    return null;
  });

  // Splash Screen Timer
  useEffect(() => {
    if (showSplash) {
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showSplash]);

  // Keep track of language choice
  useEffect(() => {
    localStorage.setItem("icona_lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  // Keep track of active session storage
  useEffect(() => {
    if (session) {
      localStorage.setItem("icona_session", JSON.stringify(session));
    } else {
      localStorage.removeItem("icona_session");
    }
  }, [session]);

  // Handle system directions (English LTR, Arabic RTL)
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = translations[lang];

  // Auto-fetch balance on mount if session exists
  useEffect(() => {
    if (session?.token) {
      // Small delay on first mount to make transition smoother
      const timer = setTimeout(() => {
        handleRefreshBalance(session.token);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Login handler
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorText("");

    if (!usernameInput.trim() || !passwordInput.trim()) {
      setErrorText(t.requiredFieldsError);
      return;
    }

    setLoading(true);
    setStatusMessage(t.loggingInButton);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          password: passwordInput.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setIsLoggingInSuccess(true);
        const finalSession = {
          token: data.token,
          username: data.username,
          balance: data.balance
        };
        setTimeout(() => {
          setSession(finalSession);
          setIsLoggingInSuccess(false);
          setStatusMessage("");
          setUsernameInput("");
          setPasswordInput("");
        }, 3200);
      } else {
        const errorMsg = lang === "ar" ? data.message_ar : data.message_en;
        setErrorText(errorMsg || t.connectionError);
      }
    } catch (err) {
      console.error("Login request failed:", err);
      setErrorText(t.connectionError);
    } finally {
      setLoading(false);
    }
  };

  // Refresh balance handler
  const handleRefreshBalance = async (tokenString?: string) => {
    const activeToken = tokenString || session?.token;
    if (!activeToken) return;

    setLoading(true);
    setStatusMessage(t.refreshingStatus);
    setErrorText("");

    try {
      const res = await fetch("/api/balance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeToken}`
        }
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            balance: data.balance
          };
        });
        setStatusMessage(t.updatedStatus);
      } else {
        if (data.code === "SESSION_EXPIRED") {
          // Force logout
          setSession(null);
          setErrorText(lang === "ar" ? data.message_ar : data.message_en);
        } else {
          setErrorText(lang === "ar" ? data.message_ar : data.message_en || t.connectionError);
          setStatusMessage("");
        }
      }
    } catch (err) {
      console.error("Refresh request failed:", err);
      setErrorText(t.connectionError);
      setStatusMessage("");
    } finally {
      setLoading(false);
    }
  };

  // Sign out handler
  const handleLogout = async () => {
    const currentToken = session?.token;
    setSession(null);
    setErrorText("");
    setStatusMessage("");
    setActiveTab("home");

    if (currentToken) {
      try {
        await fetch("/api/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${currentToken}`
          }
        });
      } catch (e) {
        console.error("Logout request failed:", e);
      }
    }
  };

  const remaining_gb = session?.balance?.remaining_gb || 0;
  const remaining_mb = session?.balance?.remaining_mb || 0;

  return (
    <div 
      className={`h-[100dvh] w-full flex flex-col overflow-hidden transition-all duration-300 font-sans relative select-none ${
        isDarkMode ? "text-white" : "text-slate-800"
      }`}
      style={{
        backgroundColor: "var(--bg-color)",
        backgroundImage: "var(--bg-gradient)"
      }}
    >
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            dir="ltr"
            initial={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center transition-all duration-300"
            style={{
              backgroundColor: "var(--bg-color)",
              backgroundImage: "var(--bg-gradient)"
            }}
          >
            {/* Splash Background Graphic */}
            <div 
              className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none transition-opacity duration-300"
              style={{ 
                backgroundImage: `url(${bkgImg})`,
                opacity: isDarkMode ? 0.08 : 0.04
              }}
            />
            
            {/* Decorative Glow inside Splash */}
            {isDarkMode && (
              <div className="absolute top-[20%] left-[50%] translate-x-[-50%] w-[90%] max-w-[400px] aspect-square rounded-full pointer-events-none blur-[120px] bg-[#D4AF37] opacity-[0.08]"></div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="z-10 flex flex-col items-center px-6 text-center"
            >
              <div className="relative w-[320px] sm:w-[460px] aspect-[2340/1080] mb-12 select-none flex items-center justify-center">
                {/* 1. Golden Emblem Container (Left Part) */}
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  className="relative z-20 shrink-0 select-none pointer-events-none"
                  style={{
                    width: "37%",
                    height: "100%"
                  }}
                >
                  {processedEmblem ? (
                    <img 
                      src={processedEmblem} 
                      alt="Icona Logo Icon" 
                      className="w-full h-full object-contain filter drop-shadow-[0_4px_28px_rgba(212,175,55,0.7)]"
                      style={{ contentVisibility: "auto" }}
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full animate-pulse bg-amber-500/10 rounded-lg" />
                  )}
                </motion.div>

                {/* 2. Text Slide Out Mask Container (Right Part) */}
                <div 
                  className="relative z-10 overflow-hidden flex items-center justify-start"
                  style={{
                    width: "63%",
                    height: "100%"
                  }}
                >
                  {/* The sliding gold text image */}
                  <motion.div
                    initial={{ x: "-100%", opacity: 0 }}
                    animate={{ x: "0%", opacity: 1 }}
                    transition={{ delay: 0.8, duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full h-full filter drop-shadow-[0_2px_16px_rgba(212,175,55,0.4)] select-none pointer-events-none"
                  >
                    {processedText ? (
                      <img 
                        src={processedText} 
                        alt="Icona Logo Text" 
                        className="w-full h-full object-contain"
                        style={{ contentVisibility: "auto" }}
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full animate-pulse bg-white/5 rounded-lg" />
                    )}
                  </motion.div>
                </div>

                {/* 3. Golden Laser/Sweep Boundary Line that moves as the text is revealed */}
                <motion.div
                  initial={{ left: "37%", opacity: 0, scaleY: 0 }}
                  animate={{ 
                    left: ["37%", "37%", "100%"], 
                    opacity: [0, 1, 1, 0],
                    scaleY: [0, 1, 1, 0]
                  }}
                  transition={{ 
                    delay: 0.75, 
                    duration: 1.85, 
                    times: [0, 0.05, 0.95, 1],
                    ease: [0.16, 1, 0.3, 1] 
                  }}
                  className="absolute top-[5%] bottom-[5%] w-[4px] bg-gradient-to-b from-amber-300 via-[#D4AF37] to-amber-500 shadow-[0_0_20px_rgba(212,175,55,1),_0_0_8px_rgba(212,175,55,0.8)] pointer-events-none z-30"
                />
              </div>
              
              <motion.h1 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.4, duration: 0.8 }}
                className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight max-w-lg mb-8 drop-shadow-sm" 
                style={{ color: '#D4AF37' }}
              >
                مرحباً بك في بوابة ايقونة للمستخدمين
              </motion.h1>
              
              {/* Animated Progress Bar */}
              <div 
                className="w-48 sm:w-64 h-1.5 rounded-full flex overflow-hidden relative" 
                style={{ backgroundColor: isDarkMode ? 'rgba(212,175,55,0.15)' : 'rgba(212,175,55,0.25)' }}
              >
                <motion.div
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 4.8, ease: "linear" }}
                  className="bg-[#D4AF37] h-full rounded-full absolute left-0"
                  style={{ transformOrigin: 'left' }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header 
        className="w-full shrink-0 flex justify-center z-50 pointer-events-auto transition-opacity duration-600 mb-2 sm:mb-8"
        style={{ opacity: showSplash ? 0 : 1, paddingTop: 'max(env(safe-area-inset-top), 20px)' }}
      >
        <div className="w-full max-w-[640px] px-4 flex items-center justify-between">
          {/* Logo Brand area */}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className={`w-3 h-3 rounded-full ${loading ? "bg-amber-500 animate-ping" : "bg-[#D4AF37] animate-pulse"}`} />
            <img 
              src={logoRemoveBg} 
              alt="Icona Logo" 
              className="h-8 sm:h-9 w-auto object-contain select-none" 
              style={{ contentVisibility: "auto" }}
              decoding="async"
              referrerPolicy="no-referrer" 
            />
            <span className="font-bold text-base sm:text-lg tracking-wider font-display text-[#D4AF37]">
              {t.titleLogo}
            </span>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Dark Mode Switcher */}
            <button
              onClick={() => setIsDarkMode(prev => !prev)}
              id="theme-toggle-btn"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all border cursor-pointer ${
                isDarkMode 
                  ? "bg-white/5 border-white/10 text-[#D4AF37] hover:bg-white/10" 
                  : "bg-white border-slate-200 text-amber-600 hover:bg-slate-50 shadow-sm"
              }`}
              title={t.toggleTheme}
            >
              {isDarkMode ? (
                <Sun className="w-[20px] h-[20px] fill-[#D4AF37] text-[#D4AF37]" />
              ) : (
                <Moon className="w-[20px] h-[20px] fill-amber-600 text-amber-600" />
              )}
            </button>

            {/* Language switch button */}
            <button
              onClick={() => setLang(prev => prev === "ar" ? "en" : "ar")}
              id="btn-lang-toggle"
              className={`h-11 px-4 rounded-xl text-sm font-bold transition-all border cursor-pointer flex items-center justify-center ${
                isDarkMode 
                  ? "bg-white/5 border-white/10 text-white/80 hover:text-white" 
                  : "bg-white border-slate-200 text-slate-700 hover:text-slate-900 shadow-sm"
              }`}
            >
              {lang === "ar" ? "EN" : "العربية"}
            </button>

            {session && (
              <button
                onClick={handleLogout}
                id="header-logout-btn"
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all border hover:bg-rose-500/10 hover:text-rose-500 cursor-pointer ${
                  isDarkMode 
                    ? "bg-white/5 border-white/10 text-white/50" 
                    : "bg-white border-slate-200 text-slate-500 shadow-sm"
                }`}
                title={t.logoutButton}
              >
                <LogOut className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main 
        style={{ 
          opacity: showSplash ? 0 : 1, 
          transition: 'opacity 0.6s ease',
          paddingBottom: 'max(env(safe-area-inset-bottom), 40px)'
        }} 
        className="flex-1 w-full flex flex-col overflow-y-auto overflow-x-hidden relative z-10 px-4"
      >
        <div className={`w-full max-w-[640px] relative flex flex-col mx-auto my-auto shrink-0 py-4 sm:py-8`}>
          {/* Background Decorative Glow Elements */}
          {isDarkMode && (
            <>
              <div className="absolute top-[-10%] left-[-10%] w-[80%] max-w-[500px] aspect-square rounded-full pointer-events-none blur-[120px] transition-all duration-300 bg-[#D4AF37] opacity-[0.05]"></div>
              <div className="absolute bottom-[-10%] right-[10%] w-[70%] max-w-[400px] aspect-square rounded-full pointer-events-none blur-[100px] transition-all duration-300 bg-white opacity-[0.02]"></div>
            </>
          )}

          {/* Main Container */}
          <motion.div 
            layout="size"
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={`w-full min-h-[460px] rounded-[24px] sm:rounded-[32px] border shadow-2xl relative flex flex-col overflow-hidden z-10 ${
              isDarkMode 
                ? "bg-slate-950/40 backdrop-blur-[40px] border-white/10" 
                : "bg-white/90 border-slate-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.06)]"
            }`}
          >
            {/* Card Background Image (not for the back of the website) */}
        <div 
          className="absolute inset-0 pointer-events-none bg-cover bg-center z-0 transition-opacity duration-300"
          style={{ 
            backgroundImage: `url(${bkgImg})`,
            opacity: isDarkMode ? 0.12 : 0.08
          }}
        />

        {/* Content Body */}
        <div className="relative z-10 flex-1 p-4 sm:p-8 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {isLoggingInSuccess ? (
              /* ========================================================
                 SUCCESS TRANSITION VIEW (1 SECOND)
                 ======================================================== */
              <motion.div
                key="success-view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 1.02 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-sm mx-auto flex flex-col items-center justify-center py-12 space-y-6 text-center"
              >
                <div className="relative flex items-center justify-center">
                  {/* Glowing background circles */}
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: [1, 1.4, 1.6], opacity: [0.5, 0.2, 0] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: "easeOut" }}
                    className="absolute w-24 h-24 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 pointer-events-none"
                  />
                  <motion.div 
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-20 h-20 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] relative z-10 shadow-[0_0_30px_rgba(212,175,55,0.2)]"
                  >
                    <motion.div
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
                    >
                      <Check className="w-10 h-10 stroke-[3]" />
                    </motion.div>
                  </motion.div>
                </div>

                <div className="space-y-4">
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.5 }}
                    className="text-2xl font-black text-[#D4AF37]"
                  >
                    {lang === "ar" ? "تم تسجيل الدخول بنجاح" : "Success!"}
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25, duration: 0.5 }}
                    className={`text-sm tracking-wide ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}
                  >
                    {lang === "ar" ? "جاري تحويلك إلى لوحة التحكم..." : "Redirecting you to dashboard..."}
                  </motion.p>
                </div>
              </motion.div>
            ) : !session ? (
              /* ========================================================
                 LOGIN / AUTHENTICATION INTERFACE
                 ======================================================== */
              <motion.div
                key="login-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="w-full max-w-sm mx-auto space-y-8"
              >
                {/* Large Centered Logo */}
                <div className="flex flex-col items-center justify-center">
                  <img 
                    src={logoRemoveBg} 
                    alt="Icona Logo" 
                    className="h-24 sm:h-28 w-auto object-contain select-none drop-shadow-[0_8px_24px_rgba(212,175,55,0.22)] hover:scale-105 transition-transform duration-300"
                    style={{ contentVisibility: "auto" }}
                    decoding="async"
                    referrerPolicy="no-referrer" 
                  />
                </div>

                {/* Simplified Centered Headline */}
                <div className="text-center space-y-2">
                  <h2 className={`text-3xl sm:text-4xl font-black tracking-tight transition-colors duration-300 ${
                    isDarkMode ? "text-white" : "text-slate-800"
                  }`}>
                    {t.title}
                  </h2>
                </div>

                {errorText && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    id="login-error-box"
                    className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl flex items-start gap-3 text-sm text-start"
                  >
                    <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
                    <p className="font-semibold leading-relaxed text-xs sm:text-sm">{errorText}</p>
                  </motion.div>
                )}

                <form onSubmit={handleLogin} className="space-y-6">
                  {/* Username Field */}
                  <div className="space-y-2 text-start">
                    <label htmlFor="user-input" className={`block text-xs sm:text-sm font-bold uppercase tracking-wider ${
                      isDarkMode ? "text-slate-300" : "text-slate-500"
                    }`}>
                      {t.usernameLabel}
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 start-0 ps-4 flex items-center text-slate-500">
                        <User className="w-[18px] h-[18px] text-[#D4AF37]" />
                      </span>
                      <input
                        id="user-input"
                        type="text"
                        dir="ltr"
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        placeholder={t.usernamePlaceholder}
                        className={`w-full py-3 px-5 ps-11 pe-4 rounded-xl text-base focus:ring-2 focus:ring-[#D4AF37]/40 focus:outline-none transition-all text-center font-mono ${
                          isDarkMode 
                            ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-[#D4AF37]" 
                            : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#D4AF37]"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-2 text-start">
                    <label htmlFor="pass-input" className={`block text-xs sm:text-sm font-bold uppercase tracking-wider ${
                      isDarkMode ? "text-slate-300" : "text-slate-500"
                    }`}>
                      {t.passwordLabel}
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 start-0 ps-4 flex items-center text-slate-500">
                        <Lock className="w-[18px] h-[18px] text-[#D4AF37]" />
                      </span>
                      <input
                        id="pass-input"
                        type="password"
                        dir="ltr"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder={t.passwordPlaceholder}
                        className={`w-full py-3 px-5 ps-11 pe-4 rounded-xl text-base focus:ring-2 focus:ring-[#D4AF37]/40 focus:outline-none transition-all text-center font-mono ${
                          isDarkMode 
                            ? "bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-[#D4AF37]" 
                            : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#D4AF37]"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    id="submit-login-button"
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 px-5 rounded-xl bg-[#D4AF37] hover:bg-[#c4a132] active:scale-[0.98] text-slate-950 font-black text-base tracking-wide shadow-[0_8px_24px_rgba(212,175,55,0.15)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        <span>{t.loggingInButton}</span>
                      </>
                    ) : (
                      <span>{t.loginButton}</span>
                    )}
                  </button>
                </form>
              </motion.div>
            ) : (
              /* ========================================================
                 DASHBOARD / SUBSCRIPTION BALANCE VIEW
                 ======================================================== */
              <motion.div
                key="dashboard-view"
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -20 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-8 text-center animate-fade-in relative"
              >
                {/* Elegant Top Bar: Logo (centered) & Navigation Tabs (aligned to top right corner matching screenshot) */}
                <div className="relative flex items-center justify-between w-full h-16 mb-4 px-1">
                  {/* Left Side: Spacer for symmetry */}
                  <div className="w-24 shrink-0" />

                  {/* Centered Logo */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <img 
                      src={logoRemoveBg} 
                      alt="Icona Logo" 
                      className="h-[68px] sm:h-[80px] w-auto object-contain select-none pointer-events-auto filter drop-shadow-[0_8px_16px_rgba(212,175,55,0.18)] hover:scale-105 transition-transform duration-300"
                    />
                  </div>

                  {/* Right Side: Tab Buttons precisely placed in a beautiful custom segmented control */}
                  <div className={`flex items-center gap-1 p-1 rounded-full border z-10 shrink-0 transition-colors duration-300 ${
                    isDarkMode 
                      ? "bg-black/30 border-white/5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.03)]" 
                      : "bg-slate-100 border-slate-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]"
                  }`}>
                    {/* Home Tab Button */}
                    <button
                      onClick={() => setActiveTab("home")}
                      className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer overflow-visible z-10 group`}
                      title={lang === "ar" ? "الرئيسية" : "Home"}
                    >
                      {activeTab === "home" && (
                        <motion.span
                          layoutId="activeTabPill"
                          className="absolute inset-0 bg-[#D4AF37] rounded-full shadow-[0_4px_20px_rgba(212,175,55,0.45)]"
                          transition={{ type: "spring", stiffness: 380, damping: 28 }}
                        />
                      )}
                      <span className={`relative z-10 transition-transform duration-300 group-hover:scale-105 ${
                        activeTab === "home"
                          ? "text-slate-950 font-bold"
                          : isDarkMode
                            ? "text-white/60 group-hover:text-white"
                            : "text-slate-500 group-hover:text-slate-800"
                      }`}>
                        <Home className="w-5 h-5" />
                      </span>
                    </button>

                    {/* Details Tab Button */}
                    <button
                      onClick={() => setActiveTab("details")}
                      className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer overflow-visible z-10 group`}
                      title={lang === "ar" ? "التفاصيل" : "Details"}
                    >
                      {activeTab === "details" && (
                        <motion.span
                          layoutId="activeTabPill"
                          className="absolute inset-0 bg-[#D4AF37] rounded-full shadow-[0_4px_20px_rgba(212,175,55,0.45)]"
                          transition={{ type: "spring", stiffness: 380, damping: 28 }}
                        />
                      )}
                      <span className={`relative z-10 transition-transform duration-300 group-hover:scale-105 ${
                        activeTab === "details"
                          ? "text-slate-950 font-bold"
                          : isDarkMode
                            ? "text-white/60 group-hover:text-white"
                            : "text-slate-500 group-hover:text-slate-800"
                      }`}>
                        <User className="w-5 h-5" />
                      </span>
                    </button>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {activeTab === "home" ? (
                    <motion.div
                      key="tab-home"
                      initial={{ opacity: 0, scale: 0.98, y: 15, filter: "blur(4px)" }}
                      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.98, y: -15, filter: "blur(4px)" }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-8"
                    >
                      {/* Simple greeting with zero noise */}
                      <div className="space-y-2">
                        <h3 className={`text-base sm:text-lg tracking-wide font-medium ${
                          isDarkMode ? "text-white/50" : "text-slate-500"
                        }`}>
                          {lang === "ar" ? "مرحباً بك يا" : "Welcome,"} <span className="text-[#D4AF37] font-bold">{session.balance.fullName || session.username}</span>
                        </h3>
                        {(() => {
                          if (!session.balance.deposit) return null;
                          const depositStrCleaned = String(session.balance.deposit || "0").replace(/[^\d.-]/g, "");
                          const deposit = parseFloat(depositStrCleaned);
                          const creditAmountVal = parseFloat(session.balance.creditAmount || "0");
                          const hasCredit = !isNaN(creditAmountVal) && creditAmountVal > 0;
                          const netBalance = hasCredit ? deposit - creditAmountVal : deposit;
                          
                          return (
                            <div className="text-center mt-2 mb-4 space-y-1">
                              <span className={`text-lg sm:text-xl font-bold tracking-wide ${isDarkMode ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}>
                                {t.depositLabel}: <span className={isDarkMode ? "text-white" : "text-slate-800"}>
                                  {netBalance.toFixed(2)} {lang === "ar" ? "د.ل" : "LYD"}
                                </span>
                              </span>
                              {hasCredit && (
                                <div className="text-xs sm:text-sm font-semibold opacity-85 text-slate-500 dark:text-white/60">
                                  {lang === "ar" 
                                    ? `(الكريديت: ${creditAmountVal.toFixed(2)} د.ل - الرصيد الأصلي: ${deposit.toFixed(2)} د.ل)` 
                                    : `(Credit: ${creditAmountVal.toFixed(2)} LYD - Original Balance: ${deposit.toFixed(2)} LYD)`}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <p className={`text-xl sm:text-2xl font-black tracking-tight ${
                          isDarkMode ? "text-white" : "text-slate-800"
                        }`}>
                          {session.balance.isUnlimited ? (t.unlimitedPackage || "باقة غير محدودة") : t.remainingDataLabel}
                        </p>
                      </div>

                      {/* Balance Big Typography */}
                      <div className="py-4 relative flex flex-col items-center justify-center">
                        {session.balance.isUnlimited ? (
                          <div className="flex flex-col items-center justify-center">
                            <span className={`text-4xl sm:text-6xl font-black font-sans tracking-tight ${
                              isDarkMode ? "text-white animate-pulse" : "text-slate-900"
                            }`}>
                              {getExtractedEndDate(session.balance, lang) || "---"}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold tracking-wider text-[#D4AF37] mt-3 uppercase">
                              {t.packageExpiry || "تاريخ انتهاء الباقة"}
                            </span>
                            {getPrepaidMonths(session.balance) > 0 && (
                              <span className="text-[11px] sm:text-[12px] font-bold px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 mt-3.5 text-center max-w-[90%] leading-relaxed border border-emerald-500/15 animate-pulse">
                                📡 {lang === "ar" 
                                  ? `تم التمديد تلقائياً لـ ${getPrepaidMonths(session.balance)} شهر إضافي من الرصيد المتاح`
                                  : `Auto-extended by ${getPrepaidMonths(session.balance)} extra month(s) from available balance`
                                }
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-baseline gap-2.5">
                            <span className={`text-6xl sm:text-8xl font-black font-sans tracking-tight ${
                              isDarkMode ? "text-white animate-pulse" : "text-slate-900"
                            }`}>
                              {remaining_gb.toFixed(2)}
                            </span>
                            <span className="text-2xl sm:text-3xl font-light text-[#D4AF37] self-end mb-2">
                              {t.gbLabel}
                            </span>
                          </div>
                        )}

                        {/* Subtitle / mb or speed display */}
                        {!session.balance.isUnlimited && (
                          <p className={`text-sm sm:text-base font-mono mt-4 font-bold ${
                            isDarkMode ? "text-white/40" : "text-slate-500"
                          }`}>
                            {remaining_mb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.mbLabel}
                          </p>
                        )}
                      </div>

                      {/* Subscription Expiration / Quota Depletion Alert */}
                      {(() => {
                        const subState = checkSubscriptionState(session.balance);
                        let alertTitle = "";
                        let alertSub = "";
                        
                        if (subState.totalNeeded > 0) {
                          alertTitle = lang === "ar" ? "الرجاء التعبئة" : "Please recharge";
                          alertSub = lang === "ar" 
                            ? `المبلغ المطلوب للتعبئة لتفعيل الاشتراك: ${subState.totalNeeded.toFixed(2)} د.ل`
                            : `Required recharge to activate: ${subState.totalNeeded.toFixed(2)} LYD`;
                        } else if (session.balance.isUnlimited) {
                          if (subState.expired) {
                            alertTitle = lang === "ar" ? "انتهت مدة الاشتراك" : "Subscription expired";
                          }
                        } else {
                          if (subState.depleted) {
                            alertTitle = lang === "ar" ? "انتهى الرصيد" : "Balance depleted";
                          } else if (subState.timeExpired) {
                            alertTitle = lang === "ar" ? "انتهت مدة الاشتراك" : "Subscription expired";
                          }
                        }

                        if (!alertTitle) return null;

                        return (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-4 rounded-[20px] border text-center transition-all duration-300 flex flex-col items-center justify-center gap-1.5 ${
                              isDarkMode 
                                ? "bg-red-500/10 border-red-500/20 shadow-[0_4px_24px_rgba(239,68,68,0.08)] text-red-400" 
                                : "bg-red-500/5 border-red-500/15 shadow-[0_4px_20px_rgba(239,68,68,0.03)] text-red-600"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 justify-center">
                              <AlertCircle className="w-5 h-5 shrink-0 animate-pulse" />
                              <span className="font-bold tracking-tight text-sm sm:text-base">{alertTitle}</span>
                            </div>
                            {alertSub && (
                              <p className={`text-xs sm:text-sm font-semibold opacity-90 ${
                                isDarkMode ? "text-red-300/90" : "text-red-800/90"
                              }`}>
                                {alertSub}
                              </p>
                            )}
                          </motion.div>
                        );
                      })()}

                    </motion.div>
                  ) : (
                    <motion.div
                      key="tab-details"
                      initial={{ opacity: 0, scale: 0.98, y: 15, filter: "blur(4px)" }}
                      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.98, y: -15, filter: "blur(4px)" }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-6"
                    >
                      {/* Sub-header inside Account Details */}
                      <div className="text-center space-y-1">
                        <p className={`text-xs uppercase tracking-widest font-black ${isDarkMode ? "text-[#D4AF37]" : "text-slate-400"}`}>
                          {lang === "ar" ? "بيانات الملف الشخصي" : "Subscriber Account Profile"}
                        </p>
                        <h4 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-slate-800"}`}>
                          {session.balance.fullName || session.username}
                        </h4>
                      </div>

                      {/* Additional Information Sub-panel */}
                      <div className={`p-4 sm:p-5 rounded-[20px] sm:rounded-[22px] border text-start space-y-4 transition-colors duration-300 ${
                        isDarkMode 
                          ? "bg-white/[0.02] border-white/5" 
                          : "bg-slate-50/80 border-slate-100"
                      }`}>
                        {/* Name field */}
                        {session.balance.fullName && (
                          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center text-sm gap-1 sm:gap-0">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.fullNameLabel}</span>
                            <span className={`font-black text-start sm:text-end break-words w-full sm:w-auto ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>{session.balance.fullName}</span>
                          </div>
                        )}

                        {/* Phone field */}
                        {session.balance.phone && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.phoneLabel}</span>
                            <span className={`font-mono font-bold ${isDarkMode ? "text-white/95" : "text-slate-800"}`} dir="ltr">{session.balance.phone}</span>
                          </div>
                        )}

                        {/* Address field */}
                        {session.balance.address && (
                          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center text-sm gap-1 sm:gap-0">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.addressLabel}</span>
                            <span className={`font-black text-start sm:text-end break-words w-full sm:w-auto ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>{session.balance.address}</span>
                          </div>
                        )}

                        {/* Status field */}
                        {session.balance.status && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.statusLabel}</span>
                            <span className="px-3.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-black">
                              {getTranslatedStatus(session.balance.status, lang)}
                            </span>
                          </div>
                        )}

                        {/* Start Date field */}
                        {session.balance.startDate && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.startDateLabel}</span>
                            <span className={`font-mono font-bold ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>{session.balance.startDate}</span>
                          </div>
                        )}

                        {/* End Date field */}
                        {getExtractedEndDate(session.balance, lang) && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.endDateLabel}</span>
                            <span className={`font-mono font-bold ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>{getExtractedEndDate(session.balance, lang)}</span>
                          </div>
                        )}

                        {/* Credit field if present */}
                        {session.balance.creditAmount && parseFloat(session.balance.creditAmount) > 0 && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>
                              {lang === "ar" ? "رصيد الكريديت" : "Credit Balance"}
                            </span>
                            <span className="font-mono font-bold text-amber-500">
                              {parseFloat(session.balance.creditAmount).toFixed(2)} {lang === "ar" ? "د.ل" : "LYD"}
                            </span>
                          </div>
                        )}
                        {session.balance.creditExpiry && session.balance.creditExpiry !== "0000-00-00" && parseFloat(session.balance.creditAmount || "0") > 0 && (
                          <div className="flex justify-between items-center text-sm">
                            <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>
                              {lang === "ar" ? "تاريخ انتهاء الكريديت" : "Credit Expiration"}
                            </span>
                            <span className={`font-mono font-bold ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>
                              {session.balance.creditExpiry}
                            </span>
                          </div>
                        )}
                        
                        {/* Next Payment Callout Alert */}
                        {session.balance.nextPayment && !isDepositNegative(session.balance.deposit) && checkSubscriptionState(session.balance).netBalance >= 0 && (
                          <div className="pt-4 border-t border-dashed border-slate-200 dark:border-white/5 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#D4AF37]">
                              <Activity className="w-4.5 h-4.5 animate-pulse" />
                              <span>{t.nextPaymentLabel}</span>
                            </div>
                            <div className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line font-bold ${
                              isDarkMode ? "text-white/85" : "text-slate-700"
                            }`}>
                              {formatNextPayment(session.balance.nextPayment, lang).replace(/&nbsp;/gi, " ")}
                            </div>
                          </div>
                        )}


                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {errorText && (
                  <motion.div 
                    id="dashboard-error-banner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-4 bg-rose-500/10 border border-rose-500/25 text-rose-400 rounded-xl text-sm flex items-center justify-center gap-2 font-bold"
                  >
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    <span>{errorText}</span>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Bottom Section / Refresh Button */}
        {session && (
          <div className={`p-4 sm:p-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-300 ${
            isDarkMode ? "border-white/5" : "border-slate-100"
          }`}>
            <div className="flex items-center gap-2">
              {(statusMessage || loading) && (
                <>
                  <span className={`w-2 h-2 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                  <span className={`text-xs font-medium ${
                    isDarkMode ? "text-white/40" : "text-slate-500"
                  }`}>
                    {loading ? (statusMessage || t.refreshingStatus) : statusMessage}
                  </span>
                </>
              )}
            </div>

            <button
              id="balance-refresh-action-btn"
              onClick={() => handleRefreshBalance()}
              disabled={loading}
              className="flex items-center gap-2 bg-[#D4AF37] hover:bg-[#c4a132] disabled:opacity-50 text-slate-950 px-5 py-2.5 rounded-xl font-bold text-xs tracking-wide shadow-[0_4px_12px_rgba(212,175,55,0.1)] hover:shadow-[0_4px_16px_rgba(212,175,55,0.18)] cursor-pointer transition-all active:scale-[0.97]"
            >
              <span>{t.refreshButton}</span>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        )}

      </motion.div>
        </div>
      </main>
    </div>
  );
}
