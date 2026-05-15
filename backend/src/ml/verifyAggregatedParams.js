import { createPool } from "../db.js";
import { buildAggregatedMlParams } from "./buildAggregatedParams.js";

async function main() {
  const pool = createPool(process.env);
  try {
    const out = await buildAggregatedMlParams(pool, process.env);
    const [counts] = await pool.query(
      `SELECT feature_key, COUNT(*) AS c
       FROM dr_ml_conversion_params
       WHERE model_version = ?
       GROUP BY feature_key
       ORDER BY feature_key`,
      [out.modelVersion],
    );
    const [leadStatus] = await pool.query(
      `SELECT feature_value, all_count, conv_count, probability
       FROM dr_ml_conversion_params
       WHERE model_version = ?
         AND feature_key = 'lead_status'
         AND LOWER(feature_value) IN ('lead', 're-enquired', 'reenquired')
       ORDER BY feature_value`,
      [out.modelVersion],
    );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ out, featureCounts: counts, leadStatusCheck: leadStatus }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

