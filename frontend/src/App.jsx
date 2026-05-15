import React, { useState } from "react";
import LoginPage from "./auth/LoginPage.jsx";
import RegisterPage from "./auth/RegisterPage.jsx";
import ForgotPasswordPage from "./auth/ForgotPasswordPage.jsx";
import AppDashboard from "./AppDashboard.jsx";
import LCPScreen from "./screens/LCPScreen.jsx";
import LCTPScreen from "./screens/LCTPScreen.jsx";
import AppShell from "./shell/AppShell.jsx";

// Pages: "login" | "register" | "forgot" | "home" | "lcp" | "lctp"

const PAGE_LABELS = {
  lcp: "LCP — Leads Conversion Probability",
  lctp: "LCTP — Lead Conversion Tuning Params",
};

export default function App() {
  const [page, setPage] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("rgs_user") || "null");
      return u ? "home" : "login";
    } catch { return "login"; }
  });

  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rgs_user") || "null"); }
    catch { return null; }
  });

  function handleLogin(u) {
    setUser(u);
    setPage("home");
  }

  function handleLogout() {
    localStorage.removeItem("rgs_token");
    localStorage.removeItem("rgs_user");
    setUser(null);
    setPage("login");
  }

  // ── Auth screens (no shell) ──────────────────────────────
  if (!user || page === "login") {
    return (
      <LoginPage
        onLogin={handleLogin}
        onGoRegister={() => setPage("register")}
        onGoForgot={() => setPage("forgot")}
      />
    );
  }
  if (page === "register") {
    return <RegisterPage onLogin={handleLogin} onGoLogin={() => setPage("login")} />;
  }
  if (page === "forgot") {
    return <ForgotPasswordPage onGoLogin={() => setPage("login")} />;
  }

  // ── Authenticated screens (wrapped in AppShell) ──────────
  return (
    <AppShell
      user={user}
      onLogout={handleLogout}
      currentPage={PAGE_LABELS[page] || null}
      onNavigate={setPage}
    >
      {page === "home" && <AppDashboard onNavigate={setPage} />}
      {page === "lcp"  && <LCPScreen  onBack={() => setPage("home")} />}
      {page === "lctp" && <LCTPScreen onBack={() => setPage("home")} />}
    </AppShell>
  );
}
