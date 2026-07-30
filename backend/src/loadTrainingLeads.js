/**
 * Load the latest 100 unique contacts from the CRM source tables
 * (dr_contacts, dr_leads, dr_lead_remarks, and related master tables)
 * into dr_training_leads.
 *
 * This module is intended to be called via POST /api/training-leads/load.
 *
 * The target table dr_training_leads is TRUNCATED first, then repopulated
 * with the freshest 100 contact-level rows.
 */

const PAGE_SIZE_MAX = 100;

/**
 * Ensure the dr_training_leads table exists (idempotent CREATE TABLE).
 * Also migrates the old typo column 'cousre_id' to 'course_id' if needed.
 */
async function ensureTargetTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dr_training_leads (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      contact_uuid VARCHAR(64) NULL COMMENT 'reference only',
      lead_id VARCHAR(128) NULL,
      name VARCHAR(255) NULL COMMENT 'reference only',
      email VARCHAR(255) NULL COMMENT 'reference only',
      mobile VARCHAR(64) NULL COMMENT 'reference only',
      city TEXT NULL,
      country TEXT NULL,
      course TEXT NULL,
      course_id INT NULL COMMENT 'reference only',
      qualification TEXT NULL,
      lead_status TEXT NULL,
      lead_sub_status TEXT NULL,
      remarks TEXT NULL,
      study_mode TEXT NULL,
      converted TINYINT NOT NULL COMMENT '0 = not converted, 1 = converted',
      conversion_probability DOUBLE NULL COMMENT 'predicted conversion probability from aggregated ML params',
      score_logit_sum DOUBLE NULL COMMENT 'sum of score_logit before sigmoid',
      scored_model_version VARCHAR(64) NULL COMMENT 'dr_ml_conversion_params.model_version used',
      scored_at DATETIME NULL COMMENT 'when batch scoring last ran',
      IsEmailGenerated TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'dr_email_generation_status.code: 0 pending, 1 template, 2 bedrock, 3 other fallback',
      EmailHTML LONGTEXT NULL COMMENT 'generated motivational email in HTML format',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'reference only',
      INDEX idx_converted (converted),
      INDEX idx_contact_uuid (contact_uuid),
      INDEX idx_lead_id (lead_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

/**
 * Return a list of lead_status IDs that are considered "converted".
 * Mirrors the set used in generateAggregates.js.
 */
function getConvertedStatuses() {
  return [3, 4, 5, 11];
}

/**
 * Fetch the latest <limit> unique contacts with their associated
 * lead, remark, and master-table data.
 *
 * Query strategy:
 *  1. Start with the latest <limit> rows from dr_contacts (the "contact set").
 *  2. For each contact, get the single most recent lead (if any).
 *  3. Join master tables for human-readable labels.
 *  4. Get the most recent remark for the lead.
 */
async function fetchLatestContacts(pool, limit = 100) {
  const sql = `
    SELECT
      C.id           AS contact_id,
      C.contact_uuid AS contact_uuid,
      C.name         AS contact_name,
      C.email        AS contact_email,
      C.mobile       AS contact_mobile,
      C.city         AS contact_city,
      C.created_at   AS contact_created_at,
      L.id           AS lead_id,
      L.created_at   AS lead_created_at,
      L.lead_status  AS lead_status_id,
      L.lead_sub_status AS lead_sub_status_id,
      Remark.remarks AS remarks,
      COALESCE(Country.country, '')           AS country_name,
      COALESCE(Interest.interest_name, '')    AS course_name,
      COALESCE(Interest.id, '')               AS course_id,
      COALESCE(HLQ.qualification_name, '')    AS qualification_name,
      COALESCE(Status.status_name, '')        AS lead_status_name,
      COALESCE(SubStatus.sub_status_name, '') AS lead_sub_status_name,
      CASE
        WHEN UPPER(TRIM(C.study_mode)) = 'NULL' THEN NULL
        WHEN C.study_mode IS NULL OR TRIM(C.study_mode) = '' THEN NULL
        WHEN UPPER(COALESCE(M.mode_name, C.study_mode)) LIKE '%ONLINE%' THEN 'ONLINE'
        WHEN UPPER(COALESCE(M.mode_name, C.study_mode)) LIKE '%CONTACT%' THEN 'CONTACT'
        ELSE COALESCE(M.mode_name, C.study_mode)
      END AS study_mode_label
    FROM dr_contacts C
    LEFT JOIN dr_leads L
      ON L.contact_id = C.id
    LEFT JOIN (
      SELECT *
      FROM (
        SELECT
          R.*,
          ROW_NUMBER() OVER (
            PARTITION BY R.lead_id
            ORDER BY R.id DESC
          ) AS rn
        FROM dr_lead_remarks R
      ) X
      WHERE rn = 1
    ) Remark
      ON Remark.lead_id = L.id
    LEFT JOIN dr_country_master Country
      ON Country.id = C.country_id
    LEFT JOIN dr_interest_master Interest
      ON Interest.id = C.interest_id
    LEFT JOIN dr_highest_level_qualification HLQ
      ON HLQ.id = C.hlq_id
    LEFT JOIN dr_lead_status_master Status
      ON Status.id = L.lead_status
    LEFT JOIN dr_lead_sub_status_master SubStatus
      ON SubStatus.id = L.lead_sub_status
    LEFT JOIN dr_mode_of_study M
      ON C.study_mode COLLATE utf8mb4_0900_ai_ci = CAST(M.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
    ORDER BY C.id DESC
    LIMIT ?
  `;

  const [rows] = await pool.query(sql, [limit]);
  return rows;
}

/**
 * Insert rows into dr_training_leads in chunks.
 * Returns the number of rows inserted.
 */
async function insertRows(pool, rows, chunkSize = 500) {
  if (!rows.length) return 0;

  const convStatuses = getConvertedStatuses();

  const sql = `
    INSERT INTO dr_training_leads (
      contact_uuid, lead_id, name, email, mobile,
      city, country, course, course_id, qualification,
      lead_status, lead_sub_status, remarks, study_mode,
      converted, created_at
    ) VALUES ? ON DUPLICATE KEY UPDATE
      lead_id     = VALUES(lead_id),
      name        = VALUES(name),
      email       = VALUES(email),
      mobile      = VALUES(mobile),
      city        = VALUES(city),
      country     = VALUES(country),
      course      = VALUES(course),
      course_id    = VALUES(course_id),
      qualification = VALUES(qualification),
      lead_status = VALUES(lead_status),
      lead_sub_status = VALUES(lead_sub_status),
      remarks     = VALUES(remarks),
      study_mode  = VALUES(study_mode),
      converted   = VALUES(converted),
      updated_at  = NOW()
  `;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map((r) => {
      const leadStatusId = r.lead_status_id;
      const converted = leadStatusId != null && convStatuses.includes(Number(leadStatusId)) ? 1 : 0;

      return [
        r.contact_uuid ?? null,
        r.lead_id != null ? String(r.lead_id) : null,
        r.contact_name ?? null,
        r.contact_email ?? null,
        r.contact_mobile ?? null,
        r.contact_city ?? null,
        r.country_name || null,
        r.course_name || null,
        r.course_id || null,
        r.qualification_name || null,
        r.lead_status_name || null,
        r.lead_sub_status_name || null,
        r.remarks ?? null,
        r.study_mode_label ?? null,
        converted,
        r.lead_created_at ?? r.contact_created_at ?? new Date(),
      ];
    });

    await pool.query(sql, [values]);
    inserted += chunk.length;
  }

  return inserted;
}

/**
 * Load the latest 100 unique contacts into dr_training_leads.
 *
 * Steps:
 *  1. Ensure target table exists.
 *  2. Fetch the latest <limit> contacts with full join data.
 *  3. Truncate the target table (full refresh).
 *  4. Insert the new rows.
 *
 * @param {import("mysql2/promise").Pool} pool
 * @param {number} [limit=100] - number of contacts to fetch
 * @returns {{ rowsLoaded: number, limit: number }}
 */
export async function loadTrainingLeads(pool, limit = 100) {
  const safeLimit = Math.min(Math.max(1, limit), PAGE_SIZE_MAX);

  await ensureTargetTable(pool);

  const rows = await fetchLatestContacts(pool, safeLimit);

  // Truncate before reload
  await pool.query("TRUNCATE TABLE dr_training_leads");

  const rowsInserted = await insertRows(pool, rows);

  return { rowsLoaded: rowsInserted, limit: safeLimit };
}
 