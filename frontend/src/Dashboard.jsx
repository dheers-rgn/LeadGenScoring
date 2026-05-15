import React, { useMemo, useState } from "react";
import { apiGet, apiPost } from "./api.js";

export default function Dashboard({ user, onLogout }) {
  const [status, setStatus] = useState("Idle");
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState("");
  const [previewRows, setPreviewRows] = useState([]);
  const [error, setError] = useState("");

  const tableOptions = useMemo(() => [...tables].sort(), [tables]);

  async function refreshTables() {
    setError("");
    setStatus("Loading tables…");
    try {
      const data = await apiGet("/api/tables");
      setTables(data.tables || []);
      setStatus("Tables loaded.");
    } catch (e) {
      setError(e.message);
      setStatus("Failed.");
    }
  }

  async function runImport() {
    setError("");
    setStatus("Import running…");
    setPreviewRows([]);
    try {
      await apiPost("/api/import");
      setStatus("Import finished.");
      await refreshTables();
    } catch (e) {
      setError(e.message);
      setStatus("Failed.");
    }
  }

  async function loadPreview(name) {
    setSelected(name);
    setError("");
    setStatus(`Loading preview for ${name}…`);
    try {
      const data = await apiGet(`/api/table/${encodeURIComponent(name)}?limit=50`);
      setPreviewRows(data.rows || []);
      setStatus("Preview loaded.");
    } catch (e) {
      setError(e.message);
      setStatus("Failed.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top Nav */}
      <nav style={{
        background: "#1e4d30",
        borderBottom: "4px solid var(--accent)",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "56px",
      }}>
        <span style={{ color: "#fff", fontWeight: 800, letterSpacing: "2px", fontSize: "15px", textTransform: "uppercase" }}>
          Regenesys — Lead Scoring
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "13px" }}>
            {user?.name || user?.username}
          </span>
          <button
            onClick={onLogout}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 18px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", color: "#fff", fontWeight: 700 }}>Lead Scoring Dashboard</h1>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "13px", marginTop: "4px" }}>Excel → MySQL importer &amp; data preview</div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button onClick={runImport} style={btnStyle}>Run Import</button>
            <button onClick={refreshTables} style={{ ...btnStyle, background: "rgba(255,255,255,0.06)" }}>Refresh Tables</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
          <span style={{
            background: "rgba(245,196,0,0.15)",
            border: "1px solid rgba(245,196,0,0.35)",
            color: "#f5c400",
            padding: "7px 14px",
            borderRadius: "999px",
            fontSize: "13px",
          }}>{status}</span>
          {error && <span style={{ color: "#ff8a80", fontSize: "13px" }}>{error}</span>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "16px" }}>
          <section style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: "12px", color: "#fff", fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Imported Tables
            </div>
            {tableOptions.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px" }}>No tables found. Run Import first.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {tableOptions.map((t) => (
                  <button
                    key={t}
                    onClick={() => loadPreview(t)}
                    style={{
                      textAlign: "left",
                      background: selected === t ? "rgba(245,196,0,0.12)" : "rgba(0,0,0,0.2)",
                      border: `1px solid ${selected === t ? "rgba(245,196,0,0.4)" : "rgba(255,255,255,0.08)"}`,
                      color: selected === t ? "#f5c400" : "rgba(255,255,255,0.8)",
                      borderRadius: "4px",
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontFamily: "monospace",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: "12px", color: "#fff", fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Preview (first 50 rows)
            </div>
            {previewRows.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px" }}>Select a table to preview.</div>
            ) : (
              <pre style={{
                margin: 0, overflow: "auto", maxHeight: "540px",
                fontSize: "12px", lineHeight: "1.5", padding: "14px",
                borderRadius: "4px", background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)",
              }}>
                {JSON.stringify(previewRows, null, 2)}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.2)",
  color: "#fff",
  padding: "9px 16px",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
};

const cardStyle = {
  borderRadius: "6px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.06)",
  padding: "16px",
};
