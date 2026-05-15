import { Router } from "express";

const PAGE_SIZE_MAX = 1000;
const DEFAULT_PAGE_SIZE = 1000;

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function trainingLeadsRoutes(pool) {
  const router = Router();

  // GET /api/training-leads/filter-options — distinct values for dropdowns
  router.get("/filter-options", async (_req, res) => {
    try {
      const cols = ["country", "qualification", "lead_status", "lead_sub_status", "study_mode"];
      const out = {};
      await Promise.all(
        cols.map(async (col) => {
          const [rows] = await pool.query(
            `SELECT DISTINCT \`${col}\` AS v
             FROM dr_training_leads
             WHERE \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) <> ''
             ORDER BY v ASC
             LIMIT 2000`,
          );
          out[col] = rows.map((r) => r.v).filter(Boolean);
        }),
      );
      return res.json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /api/training-leads — paginated list, ordered by conversion_probability DESC
  router.get("/", async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const rawSize = parseInt(String(req.query.pageSize || String(DEFAULT_PAGE_SIZE)), 10);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.isFinite(rawSize) ? rawSize : DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const country = trimOrNull(req.query.country);
    const qualification = trimOrNull(req.query.qualification);
    const leadStatus = trimOrNull(req.query.lead_status);
    const leadSubStatus = trimOrNull(req.query.lead_sub_status);
    const studyMode = trimOrNull(req.query.study_mode);

    const where = [];
    const params = [];
    if (country) {
      where.push("country = ?");
      params.push(country);
    }
    if (qualification) {
      where.push("qualification = ?");
      params.push(qualification);
    }
    if (leadStatus) {
      where.push("lead_status = ?");
      params.push(leadStatus);
    }
    if (leadSubStatus) {
      where.push("lead_sub_status = ?");
      params.push(leadSubStatus);
    }
    if (studyMode) {
      where.push("study_mode = ?");
      params.push(studyMode);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    try {
      const countSql = `SELECT COUNT(*) AS total FROM dr_training_leads ${whereSql}`;
      const [[countRow]] = await pool.query(countSql, params);
      const total = Number(countRow?.total ?? 0);

      const listSql = `
        SELECT
          id,
          contact_uuid,
          lead_id,
          conversion_probability,
          name,
          email,
          mobile,
          city,
          country,
          course,
          qualification,
          lead_status,
          lead_sub_status,
          remarks,
          study_mode,
          IsEmailGenerated,
          EmailHTML,
          score_logit_sum,
          scored_at
        FROM dr_training_leads
        ${whereSql}
        ORDER BY (conversion_probability IS NULL) ASC, conversion_probability DESC, id DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await pool.query(listSql, [...params, pageSize, offset]);

      return res.json({
        ok: true,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        rows,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return router;
}
