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
  Sun
} from "lucide-react";
import { translations } from "./translations";
import { Language, UserSessionData } from "./types";
// @ts-ignore
import logoImg from "./logo-removebg.png";
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
  
  const lines = nextPaymentText.split("\n");
  
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

const getExtractedEndDate = (balanceData: any): string => {
  if (!balanceData) return "";
  
  // Try to find a date like YYYY-MM-DD in nextPayment string first
  if (balanceData.nextPayment) {
    const dateMatch = balanceData.nextPayment.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      return dateMatch[1];
    }
  }
  
  return balanceData.endDate || "";
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

  // Keep track of theme choice in cache
  useEffect(() => {
    localStorage.setItem("icona_theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  // UI state
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorText, setErrorText] = useState("");

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
        setSession({
          token: data.token,
          username: data.username,
          balance: data.balance
        });
        setStatusMessage(t.updatedStatus);
        setUsernameInput("");
        setPasswordInput("");
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
      className={`min-h-[100dvh] w-full flex flex-col overflow-y-auto overflow-x-hidden transition-all duration-300 font-sans relative select-none ${
        isDarkMode ? "bg-[#07070a] text-white" : "bg-[#f4f5f7] text-slate-800"
      }`}
    >
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className={`fixed inset-0 z-[100] flex flex-col items-center justify-center ${
              isDarkMode ? "bg-[#07070a]" : "bg-[#f4f5f7]"
            }`}
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
            <div className={`absolute top-[20%] left-[50%] translate-x-[-50%] w-[90%] max-w-[400px] aspect-square rounded-full pointer-events-none blur-[120px] ${
              isDarkMode ? "bg-[#D4AF37] opacity-[0.08]" : "bg-[#D4AF37] opacity-[0.1]"
            }`}></div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="z-10 flex flex-col items-center px-6 text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.03, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <img src={logoImg} alt="Icona Logo" className="w-[180px] sm:w-[220px] h-auto drop-shadow-2xl mb-8" />
              </motion.div>
              
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight max-w-lg mb-8 drop-shadow-sm" style={{ color: '#D4AF37' }}>
                مرحباً بك في بوابة ايقونة للمستخدمين
              </h1>
              
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
              src={logoImg} 
              alt="Icona Logo" 
              className="h-8 sm:h-9 w-auto object-contain select-none" 
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

      <main style={{ opacity: showSplash ? 0 : 1, transition: 'opacity 0.6s ease' }} className="flex-1 w-full flex items-center justify-center pointer-events-none relative z-10 px-4 pb-4">
        <div className={`w-full max-w-[640px] relative pointer-events-auto flex flex-col`}>
          {/* Background Decorative Glow Elements */}
          <div className={`absolute top-[-10%] left-[-10%] w-[80%] max-w-[500px] aspect-square rounded-full pointer-events-none blur-[120px] transition-all duration-300 ${
            isDarkMode ? "bg-[#D4AF37] opacity-[0.04]" : "bg-[#D4AF37] opacity-[0.08]"
          }`}></div>
          <div className={`absolute bottom-[-10%] right-[10%] w-[70%] max-w-[400px] aspect-square rounded-full pointer-events-none blur-[100px] transition-all duration-300 ${
            isDarkMode ? "bg-white opacity-[0.02]" : "bg-white opacity-[0.05]"
          }`}></div>

          {/* Main Container */}
          <div className={`w-full min-h-[460px] rounded-[24px] sm:rounded-[32px] border shadow-2xl relative flex flex-col overflow-hidden z-10 transition-all duration-300 ${
            isDarkMode 
              ? "bg-slate-950/40 backdrop-blur-[40px] border-white/10" 
              : "bg-white/90 border-slate-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.06)]"
          }`}>
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
            {!session ? (
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
                    src={logoImg} 
                    alt="Icona Logo" 
                    className="h-24 sm:h-28 w-auto object-contain select-none drop-shadow-[0_8px_24px_rgba(212,175,55,0.18)] hover:scale-105 transition-transform duration-300"
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
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.25 }}
                className="space-y-8 text-center animate-fade-in"
              >
                {/* Large Centered Logo on Dashboard */}
                <div className="flex flex-col items-center justify-center">
                  <img 
                    src={logoImg} 
                    alt="Icona Logo" 
                    className="h-24 sm:h-28 w-auto object-contain select-none drop-shadow-[0_8px_24px_rgba(212,175,55,0.18)] hover:scale-105 transition-transform duration-300"
                    referrerPolicy="no-referrer" 
                  />
                </div>

                {/* Simple greeting with zero noise */}
                <div className="space-y-2">
                  <h3 className={`text-base sm:text-lg tracking-wide font-medium ${
                    isDarkMode ? "text-white/50" : "text-slate-500"
                  }`}>
                    {lang === "ar" ? "مرحباً بك يا" : "Welcome,"} <span className="text-[#D4AF37] font-bold">{session.balance.fullName || session.username}</span>
                  </h3>
                  {session.balance.deposit && (
                    <div className="text-center mt-2 mb-4">
                      <span className={`text-lg sm:text-xl font-bold tracking-wide ${isDarkMode ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}>
                        {t.depositLabel}: <span className={isDarkMode ? "text-white" : "text-slate-800"}>{session.balance.deposit} {lang === "ar" ? "د.ل" : "LYD"}</span>
                      </span>
                    </div>
                  )}
                  <p className={`text-xl sm:text-2xl font-black tracking-tight ${
                    isDarkMode ? "text-white" : "text-slate-800"
                  }`}>
                    {t.remainingDataLabel}
                  </p>
                </div>

                {/* Balance Big Typography */}
                <div className="py-4 relative flex flex-col items-center justify-center">
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

                  {/* MB conversion display */}
                  <p className={`text-sm sm:text-base font-mono mt-4 font-bold ${
                    isDarkMode ? "text-white/40" : "text-slate-500"
                  }`}>
                    {remaining_mb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.mbLabel}
                  </p>
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
                  {getExtractedEndDate(session.balance) && (
                    <div className="flex justify-between items-center text-sm">
                      <span className={isDarkMode ? "text-white/50" : "text-slate-400"}>{t.endDateLabel}</span>
                      <span className={`font-mono font-bold ${isDarkMode ? "text-white/95" : "text-slate-800"}`}>{getExtractedEndDate(session.balance)}</span>
                    </div>
                  )}
                  
                  {/* Next Payment Callout Alert */}
                  {session.balance.nextPayment && (
                    <div className="pt-4 border-t border-dashed border-slate-200 dark:border-white/5 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#D4AF37]">
                        <Activity className="w-4.5 h-4.5 animate-pulse" />
                        <span>{t.nextPaymentLabel}</span>
                      </div>
                      <div className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line font-bold ${
                        isDarkMode ? "text-white/85" : "text-slate-700"
                      }`}>
                        {formatNextPayment(session.balance.nextPayment, lang)}
                      </div>
                    </div>
                  )}
                </div>

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
        <div className={`p-4 sm:p-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-300 ${
          isDarkMode ? "border-white/5" : "border-slate-100"
        }`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
            <span className={`text-xs font-medium ${
              isDarkMode ? "text-white/40" : "text-slate-500"
            }`}>
              {loading ? (statusMessage || t.refreshingStatus) : (statusMessage || t.updatedStatus)}
            </span>
          </div>

          {session && (
            <button
              id="balance-refresh-action-btn"
              onClick={() => handleRefreshBalance()}
              disabled={loading}
              className="flex items-center gap-2 bg-[#D4AF37] hover:bg-[#c4a132] disabled:opacity-50 text-slate-950 px-5 py-2.5 rounded-xl font-bold text-xs tracking-wide shadow-[0_4px_12px_rgba(212,175,55,0.1)] hover:shadow-[0_4px_16px_rgba(212,175,55,0.18)] cursor-pointer transition-all active:scale-[0.97]"
            >
              <span>{t.refreshButton}</span>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>

      </div>
        </div>
      </main>
    </div>
  );
}
