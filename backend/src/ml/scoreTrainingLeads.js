const FEATURE_COLUMNS = [
  { key: "city", col: "city" },
  { key: "country", col: "country" },
  { key: "course", col: "course" },
  { key: "qualification", col: "qualification" },
  { key: "lead_status", col: "lead_status" },
  { key: "lead_sub_status", col: "lead_sub_status" },
  { key: "remarks", col: "remarks" },
  { key: "study_mode", col: "study_mode" },
];

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function sigmoid(z) {
  if (z > 40) return 1 - 1e-12;
  if (z < -40) return 1e-12;
  return 1 / (1 + Math.exp(-z));
}

async function ensureScoringColumns(pool) {
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db_name`);
  const dbName = dbRows[0]?.db_name;
  if (!dbName) return;
  const ensureColumn = async (name, ddl) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.columns
       WHERE table_schema = ?
         AND table_name = 'dr_training_leads'
         AND column_name = ?`,
      [dbName, name],
    );
    if (Number(rows[0]?.c || 0) === 0) {
      await pool.query(`ALTER TABLE dr_training_leads ADD COLUMN ${ddl}`);
    }
  };
  await ensureColumn(
    "conversion_probability",
    "conversion_probability DOUBLE NULL COMMENT 'predicted conversion probability from aggregated ML params'",
  );
  await ensureColumn("score_logit_sum", "score_logit_sum DOUBLE NULL COMMENT 'sum of score_logit before sigmoid'");
  await ensureColumn(
    "scored_model_version",
    "scored_model_version VARCHAR(64) NULL COMMENT 'dr_ml_conversion_params.model_version used'",
  );
  await ensureColumn("scored_at", "scored_at DATETIME NULL COMMENT 'when batch scoring last ran'");
}

async function resolveModelVersion(pool, env, explicit) {
  if (explicit) return explicit;
  if (env.ML_MODEL_VERSION) return env.ML_MODEL_VERSION;
  const [rows] = await pool.query(
    `SELECT model_version FROM dr_ml_conversion_params ORDER BY trained_at DESC LIMIT 1`,
  );
  if (!rows.length) {
    throw new Error("No rows in dr_ml_conversion_params; run POST /api/ml/build-params first.");
  }
  return rows[0].model_version;
}

async function loadLogitMaps(pool, modelVersion) {
  const [rows] = await pool.query(
    `SELECT feature_key, feature_value, score_logit
     FROM dr_ml_conversion_params
     WHERE model_version = ?
       AND feature_key IN ('city','country','course','qualification','lead_status','lead_sub_status','remarks','study_mode')
       AND (param_kind IS NULL OR param_kind = 'category')`,
    [modelVersion],
  );
  const maps = new Map();
  for (const { key } of FEATURE_COLUMNS) {
    maps.set(key, new Map());
  }
  for (const r of rows) {
    const fk = r.feature_key;
    if (!maps.has(fk)) continue;
    const nv = norm(r.feature_value);
    if (!nv) continue;
    maps.get(fk).set(nv, Number(r.score_logit));
  }
  return maps;
}

function scoreRow(row, maps) {
  let z = 0;
  let matched = 0;

  for (const { key, col } of FEATURE_COLUMNS) {
    const raw = row[col];
    if (raw == null || String(raw).trim() === "") continue;

    const k = norm(raw);
    const logit = maps.get(key)?.get(k);

    if (logit != null && Number.isFinite(logit)) {
      z += logit;
      matched += 1;
    }
  }

  if (matched > 0) {
    z = z / matched;
  }

  const p = sigmoid(z);

  return {
    scoreLogitSum: z,
    conversionProbability: p,
  };
}

/**
 * Batch-score all rows in dr_training_leads using aggregated params for modelVersion.
 */
export async function scoreTrainingLeads(pool, env = process.env, options = {}) {
  await ensureScoringColumns(pool);
  const modelVersion = await resolveModelVersion(pool, env, options.modelVersion);
  const maps = await loadLogitMaps(pool, modelVersion);
  const chunkSize = Math.min(Math.max(Number(options.chunkSize) || 500, 50), 5000);

  let rowsUpdated = 0;
  let lastId = 0;

  for (;;) {
    const [batch] = await pool.query(
      `SELECT id, city, country, course, qualification, lead_status, lead_sub_status, remarks, study_mode
       FROM dr_training_leads
       WHERE id > ?
       ORDER BY id
       LIMIT ?`,
      [lastId, chunkSize],
    );
    if (!batch.length) break;

    for (const row of batch) {
      const { scoreLogitSum, conversionProbability } = scoreRow(row, maps);
      await pool.query(
        `UPDATE dr_training_leads
         SET conversion_probability = ?, score_logit_sum = ?, scored_model_version = ?, scored_at = NOW()
         WHERE id = ?`,
        [conversionProbability, scoreLogitSum, modelVersion, row.id],
      );
      rowsUpdated += 1;
    }
    lastId = batch[batch.length - 1].id;
  }

  return { modelVersion, rowsUpdated };
}
