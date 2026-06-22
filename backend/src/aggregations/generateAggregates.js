/** Lead statuses treated as "converted" for dr_conv_* aggregates. */
import { clusterCities } from "./clusterCities.js";

import {
  getLastProcessedId,
  saveAggregationMetadata,
  getLatestContactId
} from "./helpers/getLastProcessedId.js";

export const CONV_LEAD_STATUSES = [3, 4, 5, 11];

const CONV_STATUS_SQL = CONV_LEAD_STATUSES.join(", ");

function getAggregateTableNames() {
  return [...ALL_GENERATORS, ...CONV_GENERATORS].map((s) => s.tableName);
}

async function filterExistingTables(pool, tableNames) {
  const [dbRows] = await pool.query("SELECT DATABASE() AS db_name");
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return [];

  const placeholders = tableNames.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT table_name AS name
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name IN (${placeholders})`,
    [dbName, ...tableNames],
  );
  const existing = new Set(rows.map((r) => r.name));
  return tableNames.filter((t) => existing.has(t));
}

/** One aggregate_id per full refresh — max across all dr_* aggregate tables, then +1. */
async function getNextAggregateId(pool, tableNames) {
  const existing = await filterExistingTables(pool, tableNames);
  if (!existing.length) return "AGG1";

  const unionSql = existing
    .map((t) => `SELECT aggregate_id FROM \`${t}\``)
    .join(" UNION ALL ");
  const [rows] = await pool.query(
    `
    SELECT aggregate_id
    FROM (${unionSql}) AS agg_ids
    WHERE aggregate_id IS NOT NULL AND aggregate_id != ''
    ORDER BY CAST(REPLACE(aggregate_id, 'AGG', '') AS UNSIGNED) DESC
    LIMIT 1
    `,
  );

  let nextNumber = 1;
  if (rows.length > 0 && rows[0].aggregate_id) {
    nextNumber =
      parseInt(String(rows[0].aggregate_id).replace("AGG", ""), 10) + 1;
  }
  return `AGG${nextNumber}`;
}

// async function truncateTable(pool, tableName) {
//   await pool.query(`TRUNCATE TABLE \`${tableName}\``);
// }

async function refreshAggregateTable(
  pool,
  { tableName, insertColumns, query, mapRow },
  aggregateId,
  lastProcessedId,
) {
  const [rows] = await pool.query(query, [lastProcessedId]);

  // ✅ ADD HERE (DATA TRANSFORMATION LAYER)
  let processedRows = rows;

  if (tableName.includes("city")) {
    processedRows = clusterCities(rows);
  }

  if (!processedRows.length) {
    console.log(
      `${tableName}: no rows from source query — table left unchanged`,
    );
    return { tableName, rowsInserted: 0, aggregateId, skipped: true };
  }

  const colSql = ["aggregate_id", ...insertColumns]
    .map((c) => `\`${c}\``)
    .join(", ");

  const rowPlaceholder = `(${["?", ...insertColumns.map(() => "?")].join(", ")})`;

  const chunkSize = 500;

  for (let i = 0; i < processedRows.length; i += chunkSize) {
    const chunk = processedRows.slice(i, i + chunkSize);
    const valuesSql = chunk.map(() => rowPlaceholder).join(", ");

    const flat = chunk.flatMap((row) => [aggregateId, ...mapRow(row)]);

    await pool.query(
      `INSERT INTO \`${tableName}\` (${colSql}) VALUES ${valuesSql}`,
      flat,
    );
  }

  console.log(
    `${tableName} refreshed (${aggregateId}). Rows: ${processedRows.length}`,
  );

  return { tableName, rowsInserted: processedRows.length, aggregateId };
}

const ALL_GENERATORS = [
  {
    tableName: "dr_all_country_course",
    insertColumns: [
      "country",
      "interestcourse",
      "countcountrylevel",
      "countcourselevel",
    ],
    query: `
      WITH Country_leads AS (
        SELECT Con.country_id, COUNT(Con.country_id) AS CtrCount
        FROM dr_contacts Con
        LEFT JOIN dr_country_master Ctr ON Con.country_id = Ctr.id
        GROUP BY Con.country_id
      ),
      course_leads AS (
        SELECT Con.country_id, Intrst.id AS intrest_id, COUNT(Intrst.id) AS Coursecount
        FROM dr_contacts Con
        LEFT JOIN dr_country_master Ctr ON Con.country_id = Ctr.id
        LEFT JOIN dr_interest_master Intrst ON Con.interest_id = Intrst.id
        GROUP BY Con.country_id, Intrst.id
      )
      SELECT Country.country, Intrest.interest_name, A.CtrCount, B.Coursecount
      FROM Country_leads A
      LEFT JOIN course_leads B ON A.country_id = B.country_id
      INNER JOIN dr_country_master Country ON Country.id = A.country_id
      INNER JOIN dr_interest_master Intrest ON Intrest.id = B.intrest_id
      ORDER BY A.CtrCount DESC, B.Coursecount DESC
    `,
    mapRow: (r) => [r.country, r.interest_name, r.CtrCount, r.Coursecount],
  },
  {
    tableName: "dr_all_qualification",
    insertColumns: ["maxdate", "hlq_count", "qualification"],
    query: `
      SELECT MAX(C.created_at) AS maxdate,
             COUNT(C.hlq_id) AS hlq_count,
             Q.qualification_name AS qualification
      FROM dr_contacts C
      LEFT JOIN dr_highest_level_qualification Q ON C.hlq_id = Q.id
      WHERE C.id > ?
      GROUP BY C.hlq_id, Q.qualification_name
      ORDER BY hlq_count DESC
    `,
    mapRow: (r) => [r.maxdate, r.hlq_count, r.qualification],
  },
  {
    tableName: "dr_all_study_mode",
    insertColumns: ["max_date", "count", "studymode"],
    query: `
      SELECT
    MAX(C.created_at) AS max_date,
    COUNT(*) AS count,
    CASE
	    WHEN UPPER(TRIM(C.study_mode)) = 'NULL' THEN NULL
	    WHEN C.study_mode IS NULL OR TRIM(study_mode) = '' THEN NULL
        WHEN study_mode LIKE '%ONLINE%'
        THEN 'ONLINE'
    WHEN study_mode LIKE '%CONTACT%'
        THEN 'CONTACT'
        ELSE COALESCE(M.mode_name, C.study_mode)
    END AS studymode
FROM dr_contacts C
LEFT JOIN dr_mode_of_study M
    ON C.study_mode COLLATE utf8mb4_0900_ai_ci =
       CAST(M.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
GROUP BY studymode;
    `,
    mapRow: (r) => [r.max_date, r.count, r.studymode],
  },
  {
    tableName: "dr_all_city",
    insertColumns: ["city", "count"],
    query: `
      SELECT city, COUNT(1) AS count
      FROM dr_contacts
      WHERE id > ?
      GROUP BY city
      HAVING COUNT(1) > 2
      ORDER BY count DESC
    `,
    mapRow: (r) => [r.city, r.count],
  },
  {
    tableName: "dr_all_leads_status",
    insertColumns: ["maxdate", "leads_count", "lead_status", "status_name"],
    query: `
      SELECT MAX(A.created_at) AS maxdate,
             COUNT(A.lead_status) AS leads_count,
             B.status_name AS lead_status,
             B.status_name AS status_name
      FROM dr_leads A
      LEFT JOIN dr_lead_status_master B ON A.lead_status = B.id
      WHERE A.id > ?
      GROUP BY A.lead_status, B.status_name
      ORDER BY leads_count DESC
    `,
    mapRow: (r) => [r.maxdate, r.leads_count, r.lead_status, r.status_name],
  },
  {
    tableName: "dr_all_lead_sublead",
    insertColumns: [
      "count_leads",
      "lead_status_id",
      "lead_sub_status_id",
      "lead_status",
      "lead_substatus",
      "last_lead_date",
    ],
    query: `
      SELECT COUNT(1) AS count_leads,
             A.lead_status AS lead_status_id,
             A.lead_sub_status AS lead_sub_status_id,
             B.status_name AS lead_status,
             C.sub_status_name AS lead_substatus,
             MAX(A.created_at) AS last_lead_date
      FROM dr_leads A
      LEFT JOIN dr_lead_status_master B ON A.lead_status = B.id
      LEFT JOIN dr_lead_sub_status_master C ON A.lead_sub_status = C.id
      GROUP BY A.lead_status, A.lead_sub_status, B.status_name, C.sub_status_name
      ORDER BY B.id DESC, C.id DESC
    `,
    mapRow: (r) => [
      r.count_leads,
      r.lead_status_id,
      r.lead_sub_status_id,
      r.lead_status,
      r.lead_substatus,
      r.last_lead_date,
    ],
  },
  {
    tableName: "dr_all_remarks",
    insertColumns: ["count", "response"],
    query: `
      SELECT COUNT(R.remarks) AS count,
             R.remarks AS response
      FROM dr_lead_remarks R
      INNER JOIN dr_leads A ON R.lead_id = A.id
      WHERE R.id > ?
      GROUP BY R.remarks
      ORDER BY count DESC
    `,
    mapRow: (r) => [r.count, r.response],
  },
];

const CONV_GENERATORS = [
  {
    tableName: "dr_conv_country_course",
    insertColumns: [
      "country",
      "interest_course",
      "count_country_level",
      "count_course_level",
    ],
    query: `
      WITH Country_leads AS (
        SELECT Con.country_id, COUNT(Con.country_id) AS CtrCount
        FROM dr_contacts Con
        INNER JOIN dr_leads leads ON Con.id = leads.contact_id
        WHERE Con.id > ? AND leads.lead_status IN (${CONV_STATUS_SQL})
        GROUP BY Con.country_id
      ),
      course_leads AS (
        SELECT Con.country_id, Intrst.id AS intrest_id, COUNT(Intrst.id) AS Coursecount
        FROM dr_contacts Con
        INNER JOIN dr_leads leads ON Con.id = leads.contact_id
        LEFT JOIN dr_interest_master Intrst ON Con.interest_id = Intrst.id
        WHERE Con.id > ? AND leads.lead_status IN (${CONV_STATUS_SQL})
        GROUP BY Con.country_id, Intrst.id
      )
      SELECT Country.country, Intrest.interest_name, A.CtrCount, B.Coursecount
      FROM Country_leads A
      LEFT JOIN course_leads B ON A.country_id = B.country_id
      INNER JOIN dr_country_master Country ON Country.id = A.country_id
      INNER JOIN dr_interest_master Intrest ON Intrest.id = B.intrest_id
      ORDER BY A.CtrCount DESC, B.Coursecount DESC
    `,
    mapRow: (r) => [r.country, r.interest_name, r.CtrCount, r.Coursecount],
  },
  {
    tableName: "dr_conv_qualification",
    insertColumns: ["maxdate", "hlq_count", "qualification"],
    query: `
      SELECT MAX(C.created_at) AS maxdate,
             COUNT(C.hlq_id) AS hlq_count,
             Q.qualification_name AS qualification
      FROM dr_contacts C
      INNER JOIN dr_leads leads ON C.id = leads.contact_id
      LEFT JOIN dr_highest_level_qualification Q ON C.hlq_id = Q.id
      WHERE C.id > ? AND leads.lead_status IN (${CONV_STATUS_SQL})
      GROUP BY C.hlq_id, Q.qualification_name
      ORDER BY hlq_count DESC
    `,
    mapRow: (r) => [r.maxdate, r.hlq_count, r.qualification],
  },
  {
    tableName: "dr_conv_study_mode",
    insertColumns: ["max_date", "count", "studymode"],
    query: `
      SELECT
    MAX(C.created_at) AS max_date,
    COUNT(*) AS count,
    CASE
        WHEN UPPER(TRIM(C.study_mode)) = 'NULL' THEN NULL
        WHEN C.study_mode IS NULL OR TRIM(C.study_mode) = '' THEN NULL

        WHEN UPPER(COALESCE(M.mode_name, C.study_mode)) LIKE '%ONLINE%'
            THEN 'ONLINE'

        WHEN UPPER(COALESCE(M.mode_name, C.study_mode)) LIKE '%CONTACT%'
            THEN 'CONTACT'

        ELSE COALESCE(M.mode_name, C.study_mode)
    END AS studymode
FROM dr_contacts C
INNER JOIN dr_leads leads
    ON C.id = leads.contact_id
LEFT JOIN dr_mode_of_study M
    ON C.study_mode COLLATE utf8mb4_0900_ai_ci =
       CAST(M.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
WHERE leads.lead_status IN (${CONV_STATUS_SQL}) AND C.id > ?
GROUP BY studymode;
    `,
    mapRow: (r) => [r.max_date, r.count, r.studymode],
  },
  {
    tableName: "dr_conv_city",
    insertColumns: ["city", "count"],
    query: `
      SELECT C.city, COUNT(1) AS count
      FROM dr_contacts C
      INNER JOIN dr_leads leads ON C.id = leads.contact_id
      WHERE leads.lead_status IN (${CONV_STATUS_SQL}) AND C.id > ?
      GROUP BY C.city
      HAVING COUNT(1) > 2
      ORDER BY count DESC
    `,
    mapRow: (r) => [r.city, r.count],
  },
  {
    tableName: "dr_conv_lead_status",
    insertColumns: ["maxdate", "leads_count", "lead_status", "status_name"],
    query: `
      SELECT MAX(A.created_at) AS maxdate,
             COUNT(A.lead_status) AS leads_count,
             B.status_name AS lead_status,
             B.status_name AS status_name
      FROM dr_leads A
      LEFT JOIN dr_lead_status_master B ON A.lead_status = B.id
      WHERE B.id > ? AND A.lead_status IN (${CONV_STATUS_SQL})
      GROUP BY A.lead_status, B.status_name
      ORDER BY leads_count DESC
    `,
    mapRow: (r) => [r.maxdate, r.leads_count, r.lead_status, r.status_name],
  },
  {
    tableName: "dr_conv_lead_sublead",
    insertColumns: [
      "count_leads",
      "lead_status",
      "lead_sub_status",
      "lead_substatus",
      "last_lead_date",
    ],
    query: `
      SELECT COUNT(1) AS count_leads,
             B.status_name AS lead_status,
             C.sub_status_name AS lead_sub_status,
             C.sub_status_name AS lead_substatus,
             MAX(A.created_at) AS last_lead_date
      FROM dr_leads A
      LEFT JOIN dr_lead_status_master B ON A.lead_status = B.id
      LEFT JOIN dr_lead_sub_status_master C ON A.lead_sub_status = C.id
      WHERE B.id > ? AND A.lead_status IN (${CONV_STATUS_SQL})
      GROUP BY A.lead_status, A.lead_sub_status, B.status_name, C.sub_status_name
      ORDER BY B.id DESC, C.id DESC
    `,
    mapRow: (r) => [
      r.count_leads,
      r.lead_status,
      r.lead_sub_status,
      r.lead_substatus,
      r.last_lead_date,
    ],
  },
  {
    tableName: "dr_conv_remarks",
    insertColumns: ["count_remarks", "remarks", "lead_status", "status_name"],
    query: `
      SELECT COUNT(R.remarks) AS count_remarks,
             R.remarks AS remarks,
             B.status_name AS lead_status,
             B.status_name AS status_name
      FROM dr_lead_remarks R
      INNER JOIN dr_leads A ON R.lead_id = A.id
      LEFT JOIN dr_lead_status_master B ON A.lead_status = B.id
      WHERE B.id > ? AND A.lead_status IN (${CONV_STATUS_SQL}) AND R.id > ?
      GROUP BY R.remarks, B.status_name
      ORDER BY count_remarks DESC
    `,
    mapRow: (r) => [r.count_remarks, r.remarks, r.lead_status, r.status_name],
  },
];

export async function runAllAggregations(pool) {
  const aggregateId = await getNextAggregateId(pool, getAggregateTableNames());

  const lastProcessedId = await getLastProcessedId(pool);

  const results = [];

  for (const spec of ALL_GENERATORS) {
    results.push(
      await refreshAggregateTable(pool, spec, aggregateId, lastProcessedId),
    );
  }

  for (const spec of CONV_GENERATORS) {
    results.push(
      await refreshAggregateTable(pool, spec, aggregateId, lastProcessedId),
    );
  }

  const latestContactId = await getLatestContactId(pool);

  await saveAggregationMetadata(pool, aggregateId, latestContactId);

  return { aggregateId, results };
}

/** @deprecated Use runAllAggregations — kept for any direct imports. */
export async function generateAllCountryCourse(pool) {
  const aggregateId = await getNextAggregateId(pool, getAggregateTableNames());
  const spec = ALL_GENERATORS[0];
  return refreshAggregateTable(pool, spec, aggregateId);
}
