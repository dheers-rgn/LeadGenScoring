import "dotenv/config";
import express from "express";
import cors from "cors";

import { createPool, getDbConfigFromEnv } from "./db.js";
import { runFullImport } from "./import/importExcels.js";
import { buildAggregatedMlParams } from "./ml/buildAggregatedParams.js";
import { scoreTrainingLeads } from "./ml/scoreTrainingLeads.js";
import {
  generateLeadEmails,
  startLeadEmailScheduler,
  getBedrockEnvSnapshot,
  checkBedrockSdkLoadable,
} from "./ml/generateLeadEmails.js";
import { authRoutes } from "./auth/authRoutes.js";
import { trainingLeadsRoutes } from "./trainingLeadsRoutes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const pool = createPool(process.env);

app.use("/api/auth", authRoutes(pool));
app.use("/api/training-leads", trainingLeadsRoutes(pool));

app.get("/api/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows?.[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/import", async (_req, res) => {
  const allExcelPath = process.env.ALL_EXCEL_PATH;
  const convExcelPath = process.env.CONV_EXCEL_PATH;
  if (!allExcelPath || !convExcelPath) {
    return res.status(400).json({
      ok: false,
      error: "Missing ALL_EXCEL_PATH or CONV_EXCEL_PATH in env",
    });
  }

  try {
    const result = await runFullImport({ pool, allExcelPath, convExcelPath });
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/api/tables", async (_req, res) => {
  try {
    const dbName = getDbConfigFromEnv(process.env).database;
    const [rows] = await pool.query(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = ?
         AND (table_name LIKE 'dr_all\\_%' OR table_name LIKE 'dr_conv\\_%')
       ORDER BY table_name`,
      [dbName],
    );
    res.json({ ok: true, tables: rows.map((r) => r.name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/api/table/:name", async (req, res) => {
  const { name } = req.params;
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  if (!/^dr_(all|conv)_[a-z0-9_]+$/.test(name)) {
    return res.status(400).json({ ok: false, error: "Invalid table name" });
  }

  try {
    const [rows] = await pool.query(`SELECT * FROM \`${name}\` LIMIT ${limit}`);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/ml/build-params", async (_req, res) => {
  try {
    const result = await buildAggregatedMlParams(pool, process.env);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/ml/score-training-leads", async (req, res) => {
  try {
    const modelVersion = req.body?.modelVersion ?? req.query?.modelVersion;
    const result = await scoreTrainingLeads(pool, process.env, {
      modelVersion: modelVersion ? String(modelVersion) : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/ml/generate-lead-emails", async (req, res) => {
  try {
    const threshold = req.body?.threshold ?? req.query?.threshold;
    const batchSize = req.body?.batchSize ?? req.query?.batchSize;
    const result = await generateLeadEmails(pool, process.env, {
      threshold: threshold != null ? Number(threshold) : undefined,
      batchSize: batchSize != null ? Number(batchSize) : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/ml/generate-lead-emails/preview", async (req, res) => {
  try {
    const threshold = req.body?.threshold ?? req.query?.threshold;
    const batchSize = req.body?.batchSize ?? req.query?.batchSize ?? 10;
    const result = await generateLeadEmails(pool, process.env, {
      dryRun: true,
      threshold: threshold != null ? Number(threshold) : undefined,
      batchSize: batchSize != null ? Number(batchSize) : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/** Read-only: verify Bedrock env + whether @aws-sdk/client-bedrock-runtime loads (no invoke). */
app.get("/api/ml/bedrock-email-env", async (_req, res) => {
  try {
    const sdk = await checkBedrockSdkLoadable();
    return res.json({
      ok: true,
      ...getBedrockEnvSnapshot(process.env),
      sdkLoadable: sdk.sdkLoadable,
      sdkError: sdk.error,
      bedrockTemperature: process.env.BEDROCK_TEMPERATURE,
      bedrockMaxTokens: process.env.BEDROCK_MAX_TOKENS,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/api/ml/params", async (req, res) => {
  try {
    const version = String(req.query.version || "latest");
    let targetVersion = version;
    if (targetVersion === "latest") {
      const [vrows] = await pool.query(
        `SELECT model_version
         FROM dr_ml_conversion_params
         ORDER BY trained_at DESC
         LIMIT 1`,
      );
      if (!vrows.length) return res.json({ ok: true, modelVersion: null, params: [] });
      targetVersion = vrows[0].model_version;
    }

    const [rows] = await pool.query(
      `SELECT model_version, trained_at, feature_key, feature_value, all_count, conv_count, alpha, beta, probability, score_logit, notes
       FROM dr_ml_conversion_params
       WHERE model_version = ?
       ORDER BY feature_key, probability DESC`,
      [targetVersion],
    );
    return res.json({ ok: true, modelVersion: targetVersion, params: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});

startLeadEmailScheduler(pool, process.env);

