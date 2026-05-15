import React, { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../api.js";

const PAGE_SIZE = 1000;

const COLS = [
  { key: "contact_uuid", label: "Contact UUID", w: 200 },
  { key: "lead_id", label: "Lead ID", w: 120 },
  { key: "conv_pct", label: "Conv. %", w: 88 },
  { key: "name", label: "Name", w: 140 },
  { key: "email", label: "Email", w: 180 },
  { key: "mobile", label: "Mobile", w: 110 },
  { key: "city", label: "City", w: 100 },
  { key: "country", label: "Country", w: 100 },
  { key: "course", label: "Course", w: 140 },
  { key: "qualification", label: "Qualification", w: 130 },
  { key: "lead_status", label: "Status", w: 110 },
  { key: "lead_sub_status", label: "Sub status", w: 120 },
  { key: "remarks", label: "Remarks", w: 200 },
  { key: "study_mode", label: "Study mode", w: 100 },
  { key: "score_logit_sum", label: "Score logit Σ", w: 100 },
  { key: "scored_at", label: "Scored at", w: 160 },
  { key: "email_actions", label: "Email", w: 120 },
];

function pctFromProb(p) {
  if (p == null || Number.isNaN(Number(p))) return "—";
  return `${(Number(p) * 100).toFixed(2)}%`;
}

/** Conv. % column: red when below 20%, green otherwise; neutral when missing. */
function convPctCellStyle(p) {
  const n = Number(p);
  const base = { padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" };
  if (p == null || Number.isNaN(n)) {
    return { ...base, color: "rgba(255,255,255,0.55)" };
  }
  const pct = n * 100;
  return { ...base, color: pct < 20 ? "#ff6b6b" : "#7dd87d" };
}

function fmtScoredAt(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
}

export default function LCPScreen({ onBack }) {
  const [filters, setFilters] = useState({
    country: "",
    qualification: "",
    lead_status: "",
    lead_sub_status: "",
    study_mode: "",
  });
  const [options, setOptions] = useState({
    country: [],
    qualification: [],
    lead_status: [],
    lead_sub_status: [],
    study_mode: [],
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState("");
  const [mailJobStatus, setMailJobStatus] = useState("");
  const [mailJobRunning, setMailJobRunning] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [emailModal, setEmailModal] = useState({ open: false, title: "", html: "" });

  const loadOptions = useCallback(async () => {
    try {
      const data = await apiGet("/api/training-leads/filter-options");
      setOptions({
        country: data.country || [],
        qualification: data.qualification || [],
        lead_status: data.lead_status || [],
        lead_sub_status: data.lead_sub_status || [],
        study_mode: data.study_mode || [],
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadRows = useCallback(async () => {
    setError("");
    setStatus("Loading leads…");
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", String(PAGE_SIZE));
    if (filters.country) q.set("country", filters.country);
    if (filters.qualification) q.set("qualification", filters.qualification);
    if (filters.lead_status) q.set("lead_status", filters.lead_status);
    if (filters.lead_sub_status) q.set("lead_sub_status", filters.lead_sub_status);
    if (filters.study_mode) q.set("study_mode", filters.study_mode);
    try {
      const data = await apiGet(`/api/training-leads?${q.toString()}`);
      setRows(data.rows || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setStatus(`${data.total?.toLocaleString() ?? 0} lead(s) · page ${data.page} of ${data.totalPages}`);
    } catch (e) {
      setError(e.message);
      setStatus("Failed.");
      setRows([]);
    }
  }, [page, filters]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  async function runMotivationMailJob() {
    setMailJobRunning(true);
    setError("");
    setMailJobStatus("Generating motivational emails...");
    try {
      const data = await apiPost("/api/ml/generate-lead-emails", {
        threshold: 0.2,
      });
      const hist = data.bedrockDiagnostics?.failureReasonHistogram;
      const histStr = hist && Object.keys(hist).length ? ` Outcomes: ${JSON.stringify(hist)}.` : "";
      const fail = data.bedrockDiagnostics?.firstBedrockFailure;
      const failStr =
        fail?.errorDetail != null
          ? ` First Bedrock error: ${String(fail.errorDetail).slice(0, 200)}`
          : "";
      setMailJobStatus(
        `Mail job done: processed ${data.processed ?? 0} · Bedrock ${data.generatedByBedrock ?? 0} · template ${data.generatedByTemplate ?? 0} · other fallback ${data.generatedByOtherFallback ?? 0}.` +
          ` IsEmailGenerated: 0=pending, 1=template, 2=bedrock, 3=bedrock failed→template.${histStr}${failStr}`,
      );
      await loadRows();
    } catch (e) {
      setError(e.message);
      setMailJobStatus("Mail job failed.");
    } finally {
      setMailJobRunning(false);
    }
  }

  async function runPreviewEmailJob() {
    setPreviewRunning(true);
    setError("");
    setPreviewStatus("Generating preview emails...");
    try {
      const data = await apiPost("/api/ml/generate-lead-emails/preview", {
        threshold: 0.2,
        batchSize: 5,
      });
      const pRows = data.preview || [];
      setPreviewRows(pRows);
      const hist = data.bedrockDiagnostics?.failureReasonHistogram;
      const histStr = hist && Object.keys(hist).length ? ` Outcomes: ${JSON.stringify(hist)}.` : "";
      const fail = data.bedrockDiagnostics?.firstBedrockFailure;
      const failStr =
        fail?.errorDetail != null
          ? ` First Bedrock error: ${String(fail.errorDetail).slice(0, 200)}`
          : "";
      setPreviewStatus(
        `Preview done: ${pRows.length} email(s). Each row includes bedrock.attempted / error in API JSON.${histStr}${failStr}`,
      );
      if (pRows.length > 0) {
        const first = pRows[0];
        setEmailModal({
          open: true,
          title: `Preview: ${first.name || first.email || `Lead #${first.id}`}`,
          html: first.emailHtml || "<p>No HTML generated.</p>",
        });
      }
    } catch (e) {
      setError(e.message);
      setPreviewStatus("Preview failed.");
    } finally {
      setPreviewRunning(false);
    }
  }

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff", padding: "7px 14px", borderRadius: "4px",
              cursor: "pointer", fontSize: "13px", fontWeight: 600,
              fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            ← Dashboard
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", color: "#fff", fontWeight: 700 }}>
              Leads Conversion Probability
            </h2>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginTop: "4px" }}>
              <code style={{ color: "rgba(245,196,0,0.9)" }}>dr_training_leads</code>
              {" · ordered by highest conversion probability · "}
              {PAGE_SIZE} rows per page
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { loadOptions(); loadRows(); }}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#fff",
            padding: "8px 15px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={runMotivationMailJob}
          disabled={mailJobRunning}
          style={{
            background: mailJobRunning ? "rgba(255,255,255,0.05)" : "rgba(245,196,0,0.18)",
            border: "1px solid rgba(245,196,0,0.45)",
            color: mailJobRunning ? "rgba(255,255,255,0.5)" : "#f5c400",
            padding: "8px 15px",
            borderRadius: "4px",
            cursor: mailJobRunning ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          {mailJobRunning ? "Generating..." : "Generate Motivation Emails"}
        </button>
        <button
          type="button"
          onClick={runPreviewEmailJob}
          disabled={previewRunning}
          style={{
            background: previewRunning ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: previewRunning ? "rgba(255,255,255,0.5)" : "#fff",
            padding: "8px 15px",
            borderRadius: "4px",
            cursor: previewRunning ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          {previewRunning ? "Previewing..." : "Preview Emails"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <span style={{
          background: "rgba(245,196,0,0.14)",
          border: "1px solid rgba(245,196,0,0.35)",
          color: "#f5c400",
          padding: "6px 14px",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 600,
        }}>{status}</span>
        {error && <span style={{ color: "#ff8a80", fontSize: "13px" }}>{error}</span>}
        {mailJobStatus && <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "13px" }}>{mailJobStatus}</span>}
        {previewStatus && <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "13px" }}>{previewStatus}</span>}
      </div>

      {/* Filters */}
      <div style={{
        ...cardStyle,
        marginBottom: "16px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "12px 16px",
        alignItems: "end",
      }}>
        <FilterSelect
          label="Country"
          value={filters.country}
          options={options.country}
          onChange={(v) => setFilter("country", v)}
        />
        <FilterSelect
          label="Qualification"
          value={filters.qualification}
          options={options.qualification}
          onChange={(v) => setFilter("qualification", v)}
        />
        <FilterSelect
          label="Status"
          value={filters.lead_status}
          options={options.lead_status}
          onChange={(v) => setFilter("lead_status", v)}
        />
        <FilterSelect
          label="Sub status"
          value={filters.lead_sub_status}
          options={options.lead_sub_status}
          onChange={(v) => setFilter("lead_sub_status", v)}
        />
        <FilterSelect
          label="Study mode"
          value={filters.study_mode}
          options={options.study_mode}
          onChange={(v) => setFilter("study_mode", v)}
        />
        <div style={{ display: "flex", gap: "8px", paddingBottom: "2px", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              setFilters({ country: "", qualification: "", lead_status: "", lead_sub_status: "", study_mode: "" });
              setPage(1);
            }}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.85)",
              padding: "8px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            Clear filters
          </button>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>
            Changing a dropdown reloads the grid (page 1).
          </span>
        </div>
      </div>

      {/* Pagination top */}
      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={total}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        disabledPrev={page <= 1}
        disabledNext={page >= totalPages}
      />

      {/* Grid */}
      <div style={{ ...cardStyle, padding: "0", overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
          <table style={{
            borderCollapse: "collapse",
            fontSize: "12px",
            color: "rgba(255,255,255,0.9)",
            minWidth: COLS.reduce((s, c) => s + c.w, 0),
          }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#1a3d2e" }}>
              <tr>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      padding: "10px 8px",
                      textAlign: "left",
                      fontWeight: 700,
                      fontSize: "10px",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      color: "rgba(245,196,0,0.95)",
                      borderBottom: "2px solid rgba(245,196,0,0.35)",
                      whiteSpace: "nowrap",
                      width: c.w,
                      maxWidth: c.w,
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} style={{ padding: "24px", color: "rgba(255,255,255,0.45)", textAlign: "center" }}>
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={r.id != null ? r.id : `${r.lead_id}-${i}`}
                    style={{ background: i % 2 === 0 ? "rgba(0,0,0,0.12)" : "transparent" }}
                  >
                    <Cell narrow title={r.contact_uuid}>{r.contact_uuid}</Cell>
                    <Cell narrow title={r.lead_id}>{r.lead_id}</Cell>
                    <td style={convPctCellStyle(r.conversion_probability)}>
                      {pctFromProb(r.conversion_probability)}
                    </td>
                    <Cell title={r.name}>{r.name}</Cell>
                    <Cell title={r.email}>{r.email}</Cell>
                    <Cell narrow>{r.mobile}</Cell>
                    <Cell title={r.city}>{r.city}</Cell>
                    <Cell title={r.country}>{r.country}</Cell>
                    <Cell title={r.course}>{r.course}</Cell>
                    <Cell title={r.qualification}>{r.qualification}</Cell>
                    <Cell title={r.lead_status}>{r.lead_status}</Cell>
                    <Cell title={r.lead_sub_status}>{r.lead_sub_status}</Cell>
                    <Cell title={r.remarks}>{r.remarks}</Cell>
                    <Cell title={r.study_mode}>{r.study_mode}</Cell>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "11px", whiteSpace: "nowrap" }}>
                      {r.score_logit_sum != null ? Number(r.score_logit_sum).toFixed(4) : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap", fontSize: "11px" }}>
                      {fmtScoredAt(r.scored_at)}
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {Number(r.IsEmailGenerated) > 0 && r.EmailHTML ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEmailModal({
                              open: true,
                              title: `${r.name || r.email || `Lead #${r.id}`}`,
                              html: r.EmailHTML,
                            })
                          }
                          style={{
                            background: "rgba(255,255,255,0.1)",
                            border: "1px solid rgba(255,255,255,0.18)",
                            color: "#fff",
                            padding: "5px 10px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                          }}
                        >
                          Show Email
                        </button>
                      ) : (
                        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: "12px" }}>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabledPrev={page <= 1}
          disabledNext={page >= totalPages}
        />
      </div>

      {previewRows.length > 0 && (
        <div style={{ marginTop: "10px", color: "rgba(255,255,255,0.55)", fontSize: "12px" }}>
          Preview records: {previewRows.map((p) => p.name || p.email || `#${p.id}`).join(", ")}
        </div>
      )}

      {emailModal.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setEmailModal({ open: false, title: "", html: "" })}
        >
          <div
            style={{
              width: "min(900px, 95vw)",
              maxHeight: "85vh",
              overflowY: "auto",
              background: "#fff",
              color: "#111",
              borderRadius: "8px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid #e7e7e7",
                padding: "12px 14px",
              }}
            >
              <strong>{emailModal.title || "Email"}</strong>
              <button
                type="button"
                onClick={() => setEmailModal({ open: false, title: "", html: "" })}
                style={{
                  background: "transparent",
                  border: "1px solid #c9c9c9",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{ padding: "16px 18px" }}
              dangerouslySetInnerHTML={{ __html: emailModal.html || "<p>No content.</p>" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.5)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: "4px",
          fontSize: "13px",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o).length > 60 ? `${String(o).slice(0, 57)}…` : String(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Cell({ children, title, narrow }) {
  const t = title != null ? String(title) : children != null ? String(children) : "";
  return (
    <td
      title={t}
      style={{
        padding: "6px 8px",
        maxWidth: narrow ? 140 : 220,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {children ?? "—"}
    </td>
  );
}

function PaginationBar({ page, totalPages, total, onPrev, onNext, disabledPrev, disabledNext }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "10px",
      marginBottom: "12px",
    }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "13px" }}>
        Page <strong style={{ color: "#fff" }}>{page}</strong> of <strong style={{ color: "#fff" }}>{totalPages}</strong>
        {" · "}
        {total.toLocaleString()} total rows
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={disabledPrev}
          style={pgBtn(disabledPrev)}
        >
          ← Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disabledNext}
          style={pgBtn(disabledNext)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function pgBtn(disabled) {
  return {
    background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: disabled ? "rgba(255,255,255,0.3)" : "#fff",
    padding: "7px 16px",
    borderRadius: "4px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "13px",
    fontWeight: 600,
    fontFamily: "inherit",
  };
}

const cardStyle = {
  borderRadius: "6px",
  border: "1px solid rgba(255,255,255,0.09)",
  background: "rgba(255,255,255,0.05)",
  padding: "16px",
};
