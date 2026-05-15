import React from "react";
import RegenesysLogo from "../assets/RegenesysLogo.jsx";

export default function AppShell({ user, onLogout, currentPage, onNavigate, children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Top Nav */}
      <nav style={{
        background: "#1e4d30",
        borderBottom: "4px solid var(--accent)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "52px",
        flexShrink: 0,
        zIndex: 10,
      }}>
        {/* Logo + brand (left) */}
        <button
          onClick={() => onNavigate("home")}
          style={{
            display: "flex", alignItems: "center", gap: "10px",
            background: "none", border: "none", cursor: "pointer", padding: 0,
          }}
        >
          <RegenesysLogo size={32} />
          <span style={{ color: "#fff", fontWeight: 800, letterSpacing: "2px", fontSize: "13px", textTransform: "uppercase" }}>
            Regenesys
          </span>
        </button>

        {/* Breadcrumb */}
        {currentPage && currentPage !== "home" && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <button
              onClick={() => onNavigate("home")}
              style={{ color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: "13px", fontFamily: "inherit" }}
            >
              Dashboard
            </button>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>›</span>
            <span style={{ color: "#f5c400", fontWeight: 600 }}>{currentPage}</span>
          </div>
        )}

        {/* User + sign-out (right) */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px" }}>
            {user?.name || user?.username}
          </span>
          <button
            onClick={onLogout}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              padding: "5px 13px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "inherit",
            }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Page content */}
      <div style={{ flex: 1 }}>
        {children}
      </div>
    </div>
  );
}
