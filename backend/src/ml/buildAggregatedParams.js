const LEAD_STATUS_FLOOR_VALUES = new Set(["lead", "re_enquired", "re-enquired", "reenquired"]);

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function num(value) {
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function safeLogit(p) {
  const pp = Math.min(1 - 1e-12, Math.max(1e-12, p));
  return Math.log(pp / (1 - pp));
}

function makeVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `agg_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dr_ml_conversion_params (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      model_version VARCHAR(64) NOT NULL,
      trained_at DATETIME NOT NULL,
      feature_key VARCHAR(64) NOT NULL,
      feature_value TEXT NULL,
      all_count DOUBLE NOT NULL DEFAULT 0,
      conv_count DOUBLE NOT NULL DEFAULT 0,
      alpha DOUBLE NOT NULL DEFAULT 1,
      beta DOUBLE NOT NULL DEFAULT 1,
      probability DOUBLE NOT NULL,
      score_logit DOUBLE NOT NULL,
      notes TEXT NULL,
      INDEX idx_model_version (model_version),
      INDEX idx_model_feature (model_version, feature_key(32)),
      INDEX idx_model_feature_value (model_version, feature_key(32), feature_value(128))
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  const ensureColumn = async (name, ddl) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name = 'dr_ml_conversion_params'
         AND column_name = ?`,
      [dbName, name],
    );
    if (Number(rows[0]?.c || 0) === 0) {
      await pool.query(`ALTER TABLE dr_ml_conversion_params ADD COLUMN ${ddl}`);
    }
  };
  await ensureColumn("all_count", "all_count DOUBLE NOT NULL DEFAULT 0");
  await ensureColumn("conv_count", "conv_count DOUBLE NOT NULL DEFAULT 0");
  await ensureColumn("alpha", "alpha DOUBLE NOT NULL DEFAULT 1");
  await ensureColumn("beta", "beta DOUBLE NOT NULL DEFAULT 1");
  await ensureColumn("probability", "probability DOUBLE NOT NULL DEFAULT 0.5");
  await ensureColumn("score_logit", "score_logit DOUBLE NOT NULL DEFAULT 0");
  await ensureColumn("coefficient", "coefficient DOUBLE NOT NULL DEFAULT 0");
  await ensureColumn("param_kind", "param_kind VARCHAR(32) NOT NULL DEFAULT 'category'");
  await ensureColumn("reference_flag", "reference_flag TINYINT NOT NULL DEFAULT 0");
}

async function queryRows(pool, tableName) {
  const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
  return rows;
}

async function hasTable(pool, tableName) {
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return false;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?`,
    [dbName, tableName],
  );
  return Number(rows[0]?.c || 0) > 0;
}

function upsertCount(map, key, inc) {
  map.set(key, (map.get(key) || 0) + inc);
}

/** For marginals repeated on every row of a cross-tab (e.g. country total per course row), keep one value. */
function upsertMax(map, key, raw) {
  const n = num(raw);
  if (!key || !Number.isFinite(n)) return;
  const prev = map.get(key) || 0;
  map.set(key, Math.max(prev, n));
}

async function collectFeatureCounts(pool) {
  const featureMaps = {
    city: { all: new Map(), conv: new Map() },
    study_mode: { all: new Map(), conv: new Map() },
    country: { all: new Map(), conv: new Map() },
    course: { all: new Map(), conv: new Map() },
    qualification: { all: new Map(), conv: new Map() },
    lead_status: { all: new Map(), conv: new Map() },
    lead_sub_status: { all: new Map(), conv: new Map() },
    remarks: { all: new Map(), conv: new Map() },
  };

  const mappings = [
    {
      feature: "city",
      allTable: "dr_all_city",
      convTable: "dr_conv_city",
      allValueCol: "city",
      convValueCol: "city",
      allCountCol: "count",
      convCountCol: "count",
    },
    {
      feature: "study_mode",
      allTable: "dr_all_study_mode",
      convTable: "dr_conv_study_mode",
      allValueCol: "studymode",
      convValueCol: "studymode",
      allCountCol: "count",
      convCountCol: "count",
    },
    {
      feature: "country",
      allTable: "dr_all_country_course",
      convTable: "dr_conv_country_course",
      allValueCol: "country",
      convValueCol: "country",
      allCountCol: "countcountrylevel",
      convCountCol: "count_country_level",
    },
    {
      feature: "course",
      allTable: "dr_all_country_course",
      convTable: "dr_conv_country_course",
      allValueCol: "interestcourse",
      convValueCol: "interest_course",
      allCountCol: "countcourselevel",
      convCountCol: "count_course_level",
    },
    {
      feature: "qualification",
      allTable: "dr_all_qualification",
      convTable: "dr_conv_qualification",
      allValueCol: "qualification",
      convValueCol: "qualification",
      allCountCol: "hlq_count",
      convCountCol: "hlq_count",
    },
    {
      feature: "lead_status",
      allTable: "dr_all_leads_status",
      convTable: "dr_conv_lead_status",
      allValueCol: "lead_status",
      convValueCol: "lead_status",
      allCountCol: "leads_count",
      convCountCol: "leads_count",
    },
    {
      feature: "lead_sub_status",
      allTable: "dr_all_lead_sublead",
      convTable: "dr_conv_lead_sublead",
      allValueCol: "lead_substatus",
      convValueCol: "lead_substatus",
      allCountCol: "count_leads",
      convCountCol: "count_leads",
    },
    {
      feature: "remarks",
      allTable: "dr_all_remarks",
      convTable: "dr_conv_remarks",
      allValueCol: "response",
      convValueCol: "remarks",
      allCountCol: "count",
      convCountCol: "count_remarks",
    },
  ];

  for (const m of mappings) {
    if ((await hasTable(pool, m.allTable)) === false) continue;
    if ((await hasTable(pool, m.convTable)) === false) continue;
    const allRows = await queryRows(pool, m.allTable);
    const convRows = await queryRows(pool, m.convTable);

    for (const r of allRows) {
      const val = norm(r[m.allValueCol]);
      if (!val) continue;
      if (m.feature === "country") {
        upsertMax(featureMaps.country.all, val, r[m.allCountCol]);
      } else {
        upsertCount(featureMaps[m.feature].all, val, num(r[m.allCountCol]));
      }
    }
    for (const r of convRows) {
      const val = norm(r[m.convValueCol]);
      if (!val) continue;
      if (m.feature === "country") {
        upsertMax(featureMaps.country.conv, val, r[m.convCountCol]);
      } else {
        upsertCount(featureMaps[m.feature].conv, val, num(r[m.convCountCol]));
      }
    }
  }

  return featureMaps;
}

export async function buildAggregatedMlParams(pool, env = process.env) {
  await ensureSchema(pool);
  const featureMaps = await collectFeatureCounts(pool);
  const alpha = Number.parseFloat(env.ML_ALPHA || "1");
  const beta = Number.parseFloat(env.ML_BETA || "1");
  const leadStatusFloor = Number.parseFloat(env.ML_LEAD_STATUS_FLOOR || "0.001");
  const modelVersion = env.ML_MODEL_VERSION || makeVersion();
  const trainedAt = new Date();

  const rows = [];

  for (const [featureKey, maps] of Object.entries(featureMaps)) {
    
    const values = new Set([...maps.all.keys(), ...maps.conv.keys()]);
    if (featureKey === "lead_status") {
      values.add("Lead");
      values.add("Re-enquired");
    }
    console.log("FEATURE KEYS:", Object.keys(featureMaps));

    for (const value of values) {
      console.log("FEATURE KEYS:", Object.keys(featureMaps));
      const allCount = maps.all.get(value) || 0;
      let convCount = maps.conv.get(value) || 0;
      let probability = (convCount + alpha) / (allCount + alpha + beta);
      const n = norm(value);
      if (featureKey === "lead_status" && LEAD_STATUS_FLOOR_VALUES.has(n)) {
        probability = Math.max(probability, leadStatusFloor);
      }
      probability = Math.min(1 - 1e-12, Math.max(1e-12, probability));
      const scoreLogit = safeLogit(probability);
      const notes = JSON.stringify({
        source: "aggregated_tables",
      });
      rows.push([
        modelVersion,
        trainedAt,
        featureKey,
        value,
        "category",
        0,
        allCount,
        convCount,
        alpha,
        beta,
        probability,
        scoreLogit,
        scoreLogit,
        notes,
      ]);
    }
  }

  await pool.query(`DELETE FROM dr_ml_conversion_params WHERE model_version = ?`, [modelVersion]);
  if (rows.length) {
    const sql = `INSERT INTO dr_ml_conversion_params
      (model_version, trained_at, feature_key, feature_value, param_kind, reference_flag, all_count, conv_count, alpha, beta, probability, score_logit, coefficient, notes)
      VALUES ?`;
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await pool.query(sql, [rows.slice(i, i + chunkSize)]);
    }
  }

  return { modelVersion, trainedAt, rowsInserted: rows.length };
}

