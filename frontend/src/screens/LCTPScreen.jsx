import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api.js";

// Canonical display order + labels. Matching is done by checking whether the
// actual feature_key from the DB *contains* the slug (case-insensitive).
const FEATURE_ORDER = [
  { slug: "country",          label: "Country",          icon: <GlobeIcon /> },
  { slug: "course",           label: "Course",           icon: <BookIcon /> },
  { slug: "qualification",    label: "Qualification",    icon: <DegreeIcon /> },
  { slug: "lead_status",      label: "Lead Status",      icon: <StatusIcon /> },
  { slug: "lead_sub_status",  label: "Lead Sub Status",  icon: <SubStatusIcon /> },
  { slug: "study_mode",       label: "Study Mode",       icon: <StudyModeIcon /> },
  { slug: "city",             label: "City",             icon: <CityIcon /> },
  { slug: "remarks",          label: "Remarks",          icon: <RemarksIcon /> },
];

function matchSlug(featureKey, slug) {
  const k = featureKey.toLowerCase();
  // lead_sub_status must match before lead_status
  if (slug === "lead_status")     return k === "lead_status";
  if (slug === "lead_sub_status") return k === "lead_sub_status" || k.includes("sub_status");
  // Exact keys only — avoids summing stray keys whose names contain "country" / "course"
  if (slug === "country")         return k === "country";
  if (slug === "course")          return k === "course";
  return k.includes(slug.replace(/_/g, "")) || k.includes(slug);
}

export default function LCTPScreen({ onBack }) {
  const [params, setParams]     = useState([]);
  const [status, setStatus]     = useState("Loading…");
  const [error, setError]       = useState("");
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState(null); // feature_key string | null

  useEffect(() => { loadParams(); }, []);

  async function loadParams() {
    setError("");
    setStatus("Loading parameters…");
    try {
      const data = await apiGet("/api/ml/params?version=latest");
      setParams(data.params || []);
      setStatus(`${(data.params || []).length} parameter rows loaded.`);
    } catch (e) {
      setError(e.message);
      setStatus("Failed to load.");
    }
  }

  async function buildParams() {
    setError("");
    setBuilding(true);
    setStatus("Rebuilding ML parameters…");
    try {
      const data = await apiPost("/api/ml/build-params");
      setStatus(data.message || "Build complete.");
      await loadParams();
    } catch (e) {
      setError(e.message);
      setStatus("Build failed.");
    } finally {
      setBuilding(false);
    }
  }

  // Group raw params by actual feature_key
  const grouped = params.reduce((acc, row) => {
    const k = row.feature_key || "_unknown_";
    if (!acc[k]) acc[k] = [];
    acc[k].push(row);
    return acc;
  }, {});

  // Build ordered tile list from FEATURE_ORDER, aggregating counts
  const tiles = FEATURE_ORDER.map(({ slug, label, icon }) => {
    // Find all actual feature_keys that match this slug
    const matchingKeys = Object.keys(grouped).filter((k) => matchSlug(k, slug));
    const rows = matchingKeys.flatMap((k) => grouped[k]);
    const allCount  = rows.reduce((s, r) => s + (Number(r.all_count)  || 0), 0);
    const convCount = rows.reduce((s, r) => s + (Number(r.conv_count) || 0), 0);
    const rate = allCount > 0 ? ((convCount / allCount) * 100).toFixed(1) : "—";
    return { slug, label, icon, matchingKeys, allCount, convCount, rate, rowCount: rows.length };
  });

  // If a feature tile is selected, show its detail table
  if (selected) {
    const meta    = FEATURE_ORDER.find((f) => f.slug === selected);
    const detailKeys = Object.keys(grouped).filter((k) => matchSlug(k, selected));
    const rows    = detailKeys.flatMap((k) => grouped[k])
                              .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    return (
      <DetailView
        label={meta?.label || selected}
        rows={rows}
        onBack={() => setSelected(null)}
      />
    );
  }

  // ── Tile landing view ────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1200px", margin: "0 auto" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <BackBtn onClick={onBack} label="Dashboard" />
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", color: "#fff", fontWeight: 700 }}>
              Lead Conversion Tuning Params
            </h2>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginTop: "4px" }}>
              Click a feature to explore its scoring parameters
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <ActionBtn onClick={buildParams} disabled={building}>
            {building ? "Rebuilding…" : "Rebuild ML Params"}
          </ActionBtn>
          <ActionBtn onClick={loadParams} secondary>Refresh</ActionBtn>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar status={status} error={error} />

      {/* Feature tiles */}
      {params.length === 0 && !error ? (
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
          No parameters found. Click "Rebuild ML Params" to generate them.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "20px",
        }}>
          {tiles.map(({ slug, label, icon, allCount, convCount, rate, rowCount }) => (
            <FeatureTile
              key={slug}
              label={label}
              icon={icon}
              allCount={allCount}
              convCount={convCount}
              rate={rate}
              rowCount={rowCount}
              onClick={() => setSelected(slug)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail table view ─────────────────────────────────────────────────────────
function DetailView({ label, rows, onBack }) {
  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px", flexWrap: "wrap" }}>
        <BackBtn onClick={onBack} label="All Features" />
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", color: "#fff", fontWeight: 700 }}>
            {label}
          </h2>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginTop: "3px" }}>
            {rows.length} parameter values · sorted by conversion probability ↓
          </div>
        </div>
      </div>

      <div style={{
        borderRadius: "6px",
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", color: "rgba(255,255,255,0.85)" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.3)" }}>
                {["#", "Feature Value", "All Count", "High Probables", "Alpha", "Beta", "Probability", "Score Logit"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  style={{ background: i % 2 === 0 ? "rgba(0,0,0,0.14)" : "transparent" }}
                >
                  <td style={{ ...tdStyle, color: "rgba(255,255,255,0.3)", width: "40px" }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{row.feature_value ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{(row.all_count ?? 0).toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{(row.conv_count ?? 0).toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{row.alpha ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{row.beta ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {row.probability != null ? (
                      <ProbBadge value={row.probability} />
                    ) : "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#86c8f0", fontFamily: "monospace" }}>
                    {row.score_logit != null ? Number(row.score_logit).toFixed(4) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Feature tile card ─────────────────────────────────────────────────────────
function FeatureTile({ label, icon, allCount, convCount, rate, rowCount, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#f5c400" : "#ffffff",
        border: "none",
        borderRadius: "6px",
        padding: "0 0 5px",
        cursor: "pointer",
        boxShadow: hovered ? "0 8px 28px rgba(245,196,0,0.4)" : "0 4px 18px rgba(0,0,0,0.28)",
        transform: hovered ? "translateY(-3px)" : "none",
        transition: "background 0.18s, box-shadow 0.18s, transform 0.18s",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        textAlign: "center",
      }}
    >
      <div style={{ padding: "22px 18px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        {/* Icon circle */}
        <div style={{
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          background: hovered ? "rgba(0,0,0,0.08)" : "rgba(42,96,64,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          {React.cloneElement(icon, { color: hovered ? "#1e4d30" : "#2a6040" })}
        </div>

        {/* Label */}
        <div style={{ fontWeight: 800, fontSize: "15px", color: hovered ? "#1a2e1a" : "#1e4d30" }}>
          {label}
        </div>

        {/* Stats */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "5px" }}>
          <StatRow label="All Leads"  value={allCount.toLocaleString()}  hovered={hovered} />
          <StatRow label="High Probables" value={convCount.toLocaleString()} hovered={hovered} highlight />
          <StatRow label="Conv. Rate" value={rate !== "—" ? `${rate}%` : "—"} hovered={hovered} />
          <StatRow label="Values"     value={rowCount.toLocaleString()}  hovered={hovered} small />
        </div>
      </div>
      {/* Accent bar */}
      <div style={{
        height: "5px",
        background: hovered ? "rgba(0,0,0,0.15)" : "#f5c400",
        flexShrink: 0,
      }} />
    </button>
  );
}

function StatRow({ label, value, hovered, highlight, small }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "2px 0",
      borderTop: "1px solid " + (hovered ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.06)"),
    }}>
      <span style={{ fontSize: small ? "10px" : "11px", color: hovered ? "rgba(0,0,0,0.5)" : "#6b7b6b", textTransform: "uppercase", letterSpacing: "0.4px" }}>
        {label}
      </span>
      <span style={{ fontSize: small ? "11px" : "13px", fontWeight: 700, color: highlight ? (hovered ? "#1e4d30" : "#2a7a3a") : (hovered ? "#1a2e1a" : "#1e2e1e") }}>
        {value}
      </span>
    </div>
  );
}

function ProbBadge({ value }) {
  const pct = (value * 100).toFixed(1);
  const hue = Math.round(value * 120); // 0=red, 120=green
  return (
    <span style={{
      display: "inline-block",
      background: `hsla(${hue},60%,35%,0.25)`,
      color: `hsl(${hue},70%,65%)`,
      border: `1px solid hsla(${hue},60%,50%,0.3)`,
      borderRadius: "4px",
      padding: "2px 8px",
      fontWeight: 600,
      fontSize: "12px",
    }}>
      {pct}%
    </span>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function BackBtn({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "#fff",
        padding: "7px 14px",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: 600,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      ← {label}
    </button>
  );
}

function StatusBar({ status, error }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "22px", flexWrap: "wrap" }}>
      <span style={{
        background: "rgba(245,196,0,0.14)",
        border: "1px solid rgba(245,196,0,0.35)",
        color: "#f5c400",
        padding: "5px 14px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
      }}>{status}</span>
      {error && <span style={{ color: "#ff8a80", fontSize: "13px" }}>{error}</span>}
    </div>
  );
}

function ActionBtn({ children, onClick, secondary, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: secondary ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: disabled ? "rgba(255,255,255,0.35)" : "#fff",
        padding: "7px 15px",
        borderRadius: "4px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "13px",
        fontWeight: 600,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

// ── Table styles ──────────────────────────────────────────────────────────────
const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  color: "rgba(255,255,255,0.5)",
  fontWeight: 600,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "9px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "middle",
};

// ── Feature icons (inline SVG) ────────────────────────────────────────────────
function GlobeIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="11" stroke={color} strokeWidth="1.8" />
      <ellipse cx="13" cy="13" rx="5" ry="11" stroke={color} strokeWidth="1.4" />
      <line x1="2" y1="13" x2="24" y2="13" stroke={color} strokeWidth="1.4" />
      <line x1="4" y1="8" x2="22" y2="8" stroke={color} strokeWidth="1" />
      <line x1="4" y1="18" x2="22" y2="18" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function BookIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M4 5h8a4 4 0 0 1 4 4v12H8a4 4 0 0 0-4-4V5Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M22 5h-6a4 4 0 0 0-4 4v12h8a4 4 0 0 1 4-4V5Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function DegreeIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <polygon points="13,3 25,9 13,15 1,9" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
      <path d="M6 11.5v6c0 2.5 3.1 4.5 7 4.5s7-2 7-4.5v-6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="25" y1="9" x2="25" y2="16" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="10" stroke={color} strokeWidth="1.7" />
      <circle cx="13" cy="13" r="4" fill={color} opacity="0.6" />
      <line x1="13" y1="3" x2="13" y2="7" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="13" y1="19" x2="13" y2="23" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="3" y1="13" x2="7" y2="13" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="19" y1="13" x2="23" y2="13" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SubStatusIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="10" stroke={color} strokeWidth="1.7" />
      <circle cx="13" cy="13" r="6.5" stroke={color} strokeWidth="1.2" strokeDasharray="3 2" />
      <circle cx="13" cy="13" r="2.5" fill={color} />
    </svg>
  );
}

function StudyModeIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="3" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth="1.7" />
      <line x1="3" y1="19" x2="23" y2="19" stroke={color} strokeWidth="1.7" />
      <line x1="13" y1="19" x2="13" y2="23" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="9" y1="23" x2="17" y2="23" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <line x1="9" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="9" y1="13.5" x2="14" y2="13.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CityIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="3" y="10" width="8" height="14" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="11" y="5" width="12" height="19" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="14" y="15" width="3" height="4" stroke={color} strokeWidth="1.2" />
      <rect x="5" y="14" width="2" height="2" stroke={color} strokeWidth="1.1" />
      <rect x="13" y="8" width="2" height="2" stroke={color} strokeWidth="1.1" />
      <rect x="18" y="8" width="2" height="2" stroke={color} strokeWidth="1.1" />
    </svg>
  );
}

function RemarksIcon({ color = "#2a6040" }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M4 4h18a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <line x1="8" y1="10" x2="18" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="8" y1="14" x2="14" y2="14" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
