import React, { useState } from "react";
import RegenesysLogo from "./assets/RegenesysLogo.jsx";

const MODULES = [
  {
    id: "lcp",
    code: "LCP",
    title: "Leads Conversion\nProbability",
    icon: <LCPIcon />,
  },
  {
    id: "lctp",
    code: "LCTP",
    title: "Lead Conversion\nTuning Params",
    icon: <LCTPIcon />,
  },
];

export default function AppDashboard({ onNavigate }) {
  const [hovered, setHovered] = useState(null);
  const [active, setActive] = useState(null);

  function handleClick(id) {
    setActive(id);
    setTimeout(() => {
      setActive(null);
      onNavigate(id);
    }, 150);
  }

  return (
    <div style={{
      minHeight: "calc(100vh - 52px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      paddingTop: "52px",
      paddingBottom: "60px",
      background: "var(--bg)",
      backgroundImage: `
        url("data:image/svg+xml,%3Csvg width='28' height='28' viewBox='0 0 28 28' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='rgba(255,255,255,0.06)' stroke-width='0.75'%3E%3Cpath d='M14 0 L14 28 M0 14 L28 14'/%3E%3C/g%3E%3C/svg%3E")
      `,
    }}>
      {/* Brand block */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "36px" }}>
        <RegenesysLogo size={80} />
        <div style={{
          color: "#fff",
          fontWeight: 900,
          fontSize: "28px",
          letterSpacing: "6px",
          textTransform: "uppercase",
          marginTop: "14px",
          lineHeight: 1,
        }}>
          REGENESYS
        </div>
        <div style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: "11px",
          letterSpacing: "5px",
          textTransform: "uppercase",
          marginTop: "5px",
        }}>
          BUSINESS SCHOOL
        </div>
      </div>

      {/* Page heading */}
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1 style={{
          margin: 0,
          color: "#ffffff",
          fontSize: "18px",
          fontWeight: 700,
          letterSpacing: "2px",
          textTransform: "uppercase",
          textDecoration: "underline",
          textUnderlineOffset: "5px",
        }}>
          APPLICATION DASHBOARD
        </h1>
        <p style={{
          margin: "10px 0 0",
          color: "rgba(255,255,255,0.6)",
          fontSize: "13px",
        }}>
          Here are all the applications that you're able to access
        </p>
      </div>

      {/* Module cards */}
      <div style={{
        display: "flex",
        gap: "28px",
        flexWrap: "wrap",
        justifyContent: "center",
        padding: "0 24px",
      }}>
        {MODULES.map(({ id, code, title, icon }) => {
          const isActive = hovered === id || active === id;
          return (
            <button
              key={id}
              onClick={() => handleClick(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: "220px",
                background: isActive ? "#f5c400" : "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "0 0 5px",
                cursor: "pointer",
                boxShadow: isActive
                  ? "0 8px 28px rgba(245,196,0,0.4)"
                  : "0 4px 18px rgba(0,0,0,0.28)",
                transform: isActive ? "translateY(-3px)" : "none",
                transition: "background 0.18s, box-shadow 0.18s, transform 0.18s",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                textAlign: "center",
              }}
            >
              {/* Card inner */}
              <div style={{ padding: "28px 20px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
                {/* Icon circle */}
                <div style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: isActive ? "rgba(0,0,0,0.08)" : "rgba(42,96,64,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {React.cloneElement(icon, { active: isActive })}
                </div>

                {/* Title */}
                <div>
                  <div style={{
                    fontWeight: 800,
                    fontSize: "18px",
                    color: isActive ? "#1a2e1a" : "#1e4d30",
                    letterSpacing: "1px",
                    lineHeight: 1.1,
                    marginBottom: "4px",
                  }}>
                    {code}
                  </div>
                  <div style={{
                    fontSize: "12px",
                    color: isActive ? "#2a2a00" : "#4a6a4a",
                    lineHeight: 1.4,
                    whiteSpace: "pre-line",
                  }}>
                    {title}
                  </div>
                </div>
              </div>

              {/* Yellow accent bar at bottom */}
              <div style={{
                height: "5px",
                background: isActive ? "rgba(0,0,0,0.15)" : "#f5c400",
                flexShrink: 0,
              }} />
            </button>
          );
        })}
      </div>

      {/* Decorative corners */}
      <div className="corner-circle-tl" />
      <div className="corner-circle-tr" />
    </div>
  );
}

function LCPIcon({ active }) {
  const color = active ? "#1e4d30" : "#2a6040";
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="20" width="5" height="10" rx="1.5" fill={color} />
      <rect x="9" y="14" width="5" height="16" rx="1.5" fill={color} />
      <rect x="16" y="8" width="5" height="22" rx="1.5" fill={color} />
      <rect x="23" y="2" width="5" height="28" rx="1.5" fill={color} opacity="0.65" />
      <polyline points="4,18 11,12 18,6 25,2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" fill="none" />
    </svg>
  );
}

function LCTPIcon({ active }) {
  const color = active ? "#1e4d30" : "#2a6040";
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="8" x2="28" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="8" r="3.5" fill={color} />
      <line x1="4" y1="16" x2="28" y2="16" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="22" cy="16" r="3.5" fill={color} />
      <line x1="4" y1="24" x2="28" y2="24" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="24" r="3.5" fill={color} />
    </svg>
  );
}
