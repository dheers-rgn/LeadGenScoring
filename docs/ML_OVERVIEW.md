# Lead Conversion Scoring — How the ML Works in This Repo

This document walks through, end-to-end, how the codebase ingests data, "trains" a model, scores leads, versions retrains, and (separately) calls an LLM for outreach emails. All claims below are anchored to actual files and line numbers.

---

## 1. What kind of "ML" is this?

The system does **not** use a library like scikit-learn, XGBoost, PyTorch, or TensorFlow. There is **no gradient descent, no loss function, no train/test split, and no neural network**. The `ml/` top-level folder is empty:

```bash
$ ls /Users/apple/Projects/LeadGenScoring/ml
# (empty)
```

All ML logic lives in JavaScript inside `backend/src/ml/`:

```
backend/src/ml/
├── buildAggregatedParams.js   # "training": builds per-feature log-odds from counts
├── scoreTrainingLeads.js      # "inference": sums logits, applies sigmoid
├── verifyAggregatedParams.js  # CLI smoke test
└── generateLeadEmails.js      # Bedrock LLM call (post-scoring, not training)
```

### Model in one sentence

For each categorical feature value (e.g. `country = "India"`, `course = "MBA"`), compute a **Beta-smoothed conversion probability** from aggregate counts, convert it to a **log-odds score**, then at inference time **sum the matched logits across features** and squash with a **sigmoid**.

Mathematically, for each `(feature_key, feature_value)`:

- p = (conv_count + α) / (all_count + α + β)
- score_logit = ln( p / (1 − p) )

At score time:

- z = Σ score_logit over matched feature values
- probability = 1 / (1 + e^(−z))

This is **equivalent to a hand-fit Naive Bayes / "independent logistic" model with a Beta(α, β) prior on each category's conversion rate**. The independence assumption is called out explicitly in `README.md`:

```113:114:README.md
This treats dimensions as independent (naive combination of marginal logits from aggregates).
```

### Why this model was chosen (inferred from the code shape)

The codebase has these constraints baked in, which make a heavyweight learner overkill:

1. **The training input is already aggregated.** The Excel workbooks are pivot tables (`dr_all_country_course`, `dr_all_qualification`, `dr_all_remarks`, …), not row-level labeled leads. A classifier like logistic regression needs (X, y) pairs at the row level. With only marginal counts, Beta-smoothed per-category rates are the natural fit.
2. **Zero Python / data-science stack.** The whole backend is Node.js + MySQL (`backend/package.json` — `mysql2`, `exceljs`, `express`, `@aws-sdk/client-bedrock-runtime`, no `tensorflow`, `onnx`, `python-shell`, etc.).
3. **Transparency / auditability.** Every parameter is one row in `dr_ml_conversion_params` with raw counts, α, β, probability, and logit visible. Stakeholders can answer "why did this lead score 0.31?" by reading rows from a SQL table.
4. **Cold-start handling.** Beta(α, β) smoothing (defaults α=β=1, Laplace) guarantees a finite logit for every category, even those with zero conversions, and the `ML_LEAD_STATUS_FLOOR` keeps `Lead` / `Re-enquired` from collapsing to zero before any conversion has been recorded.
5. **Cheap retrains.** Rebuilding the whole model is a few `SELECT *` queries plus an `INSERT … VALUES ?` chunked write — fast enough to run synchronously from an HTTP endpoint.

---

## 2. How the model "understands" the data

### 2.1 Data ingestion (Excel → MySQL)

Two Excel workbooks defined in `backend/.env`:

```13:14:backend/.env.example
ALL_EXCEL_PATH=/Users/apple/Documents/LeadAnalysis.xlsx
CONV_EXCEL_PATH=/Users/apple/Documents/LeadConverted.xlsx
```

`runFullImport` loads every worksheet from both workbooks and writes one table per tab, prefixed `dr_all_` (population) or `dr_conv_` (converted subset):

```167:179:backend/src/import/importExcels.js
export async function runFullImport({ pool, allExcelPath, convExcelPath }) {
  const all = await importWorkbook({
    pool,
    filePath: allExcelPath,
    tablePrefix: "dr_all_",
  });
  const conv = await importWorkbook({
    pool,
    filePath: convExcelPath,
    tablePrefix: "dr_conv_",
  });
  return { all, conv };
}
```

Header rows become snake_case columns; **percent-formatted columns are deliberately dropped** (`buildColumnPlan` in `importExcels.js`, lines 92–122) because the importer treats them as derived, not raw data:

```106:117:backend/src/import/importExcels.js
    let isPercentCol = false;
    const scanTo = Math.min(worksheet.actualRowCount || 0, maxScanRows);
    for (let r = 2; r <= scanTo; r += 1) {
      const cell = worksheet.getRow(r).getCell(col);
      if (isPercentFormattedCell(cell)) {
        isPercentCol = true;
        break;
      }
    }

    plan.push({ colIndex: col, colName, include: !isPercentCol });
```

### 2.2 What the model sees as "features"

The trainer hard-codes eight feature keys and tells the loader exactly which `dr_all_*` and `dr_conv_*` tables to read for each, and which column holds the *value* and which holds the *count* in each table:

```104:188:backend/src/ml/buildAggregatedParams.js
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
    { feature: "city",            allTable: "dr_all_city",            convTable: "dr_conv_city",            ... },
    { feature: "study_mode",      allTable: "dr_all_study_mode",      convTable: "dr_conv_study_mode",      ... },
    { feature: "country",         allTable: "dr_all_country_course",  convTable: "dr_conv_country_course",  ... },
    { feature: "course",          allTable: "dr_all_country_course",  convTable: "dr_conv_country_course",  ... },
    { feature: "qualification",   allTable: "dr_all_qualification",   convTable: "dr_conv_qualification",   ... },
    { feature: "lead_status",     allTable: "dr_all_leads_status",    convTable: "dr_conv_lead_status",     ... },
    { feature: "lead_sub_status", allTable: "dr_all_lead_sublead",    convTable: "dr_conv_lead_sublead",    ... },
    { feature: "remarks",         allTable: "dr_all_remarks",         convTable: "dr_conv_remarks",         ... },
  ];
```

Two count strategies are used:

- **Sum of counts** (`upsertCount`) for most features — count rows can be aggregated.
- **Max of counts** (`upsertMax`) for `country` only, because the `dr_*_country_course` cross-tab repeats the country-level total on every (country, course) row, so summing would massively double-count:

```95:101:backend/src/ml/buildAggregatedParams.js
/** For marginals repeated on every row of a cross-tab (e.g. country total per course row), keep one value. */
function upsertMax(map, key, raw) {
  const n = num(raw);
  if (!key || !Number.isFinite(n)) return;
  const prev = map.get(key) || 0;
  map.set(key, Math.max(prev, n));
}
```

That single design decision is the clearest example of the model "understanding" a quirk of the input data (a denormalized cross-tab).

---

## 3. "Training": `buildAggregatedMlParams`

Triggered by `POST /api/ml/build-params`:

```86:93:backend/src/server.js
app.post("/api/ml/build-params", async (_req, res) => {
  try {
    const result = await buildAggregatedMlParams(pool, process.env);
    return res.json({ ok: true, ...result });
```

Step-by-step in `buildAggregatedMlParams` (`backend/src/ml/buildAggregatedParams.js`, 219–281):

1. **Ensure schema.** `dr_ml_conversion_params` is created if missing; otherwise `ensureColumn` adds any missing column (`alpha`, `beta`, `probability`, `score_logit`, `coefficient`, `param_kind`, `reference_flag`) — i.e. the table is schema-migrated forward each train.
2. **Collect counts** with `collectFeatureCounts` (described above).
3. **Read hyperparameters from env:**

```222:225:backend/src/ml/buildAggregatedParams.js
  const alpha = Number.parseFloat(env.ML_ALPHA || "1");
  const beta = Number.parseFloat(env.ML_BETA || "1");
  const leadStatusFloor = Number.parseFloat(env.ML_LEAD_STATUS_FLOOR || "0.001");
  const modelVersion = env.ML_MODEL_VERSION || makeVersion();
  const trainedAt = new Date();
```

4. **For every observed feature value**, compute the smoothed probability, apply a special floor for `Lead` / `Re-enquired` (so brand-new leads never get logit ≈ −∞), clip to (1e-12, 1−1e-12), take the logit, and stage one row:

```237:266:backend/src/ml/buildAggregatedParams.js
    for (const value of values) {
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
```

5. **Atomic replacement of this version's rows**, then chunked bulk insert of 1,000 rows at a time:

```269:278:backend/src/ml/buildAggregatedParams.js
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
```

Effectively, **the entire "trained model" is a set of rows in `dr_ml_conversion_params`** keyed by `model_version`. Each row is one learned parameter (one log-odds per category value).

---

## 4. "Inference": `scoreTrainingLeads`

Triggered by `POST /api/ml/score-training-leads`. The scorer:

1. Ensures the four scoring columns exist on `dr_training_leads`:

```41:51:backend/src/ml/scoreTrainingLeads.js
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
```

2. Resolves which model version to use — explicit arg → env var → latest by `trained_at`:

```53:63:backend/src/ml/scoreTrainingLeads.js
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
```

3. Loads all logits for the eight feature keys into in-memory `Map<featureKey, Map<normValue, logit>>` (`loadLogitMaps`, lines 65–86).

4. For each row, normalizes each feature value (trim + lowercase via `norm`), looks up its logit, and sums them. If a value has no matching parameter row, it contributes **0** — i.e. it is treated as neutral, not penalised:

```88:99:backend/src/ml/scoreTrainingLeads.js
function scoreRow(row, maps) {
  let z = 0;
  for (const { key, col } of FEATURE_COLUMNS) {
    const raw = row[col];
    if (raw == null || String(raw).trim() === "") continue;
    const k = norm(raw);
    const logit = maps.get(key)?.get(k);
    if (logit != null && Number.isFinite(logit)) z += logit;
  }
  const p = sigmoid(z);
  return { scoreLogitSum: z, conversionProbability: p };
}
```

5. Writes `conversion_probability`, `score_logit_sum`, `scored_model_version`, and `scored_at` back per row in chunks of 500 (configurable 50–5000):

```113:135:backend/src/ml/scoreTrainingLeads.js
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
```

The scored leads are then served to the UI in `conversion_probability DESC` order:

```104:107:backend/src/trainingLeadsRoutes.js
        ${whereSql}
        ORDER BY (conversion_probability IS NULL) ASC, conversion_probability DESC, id DESC
        LIMIT ? OFFSET ?
      `;
```

---

## 5. Versioning and retraining

### 5.1 How a version is named

`makeVersion` is a UTC timestamp string, prefixed `agg_`:

```19:25:backend/src/ml/buildAggregatedParams.js
function makeVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `agg_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
```

Example: `agg_20260514_062500`. Setting `ML_MODEL_VERSION=...` in `.env` overrides auto-naming and pins the trainer (and scorer) to that label — useful for hotfixes or reruns that must overwrite a known version.

### 5.2 What happens on retrain

Each call to `POST /api/ml/build-params`:

- Generates (or reuses, if `ML_MODEL_VERSION` is set) a version label.
- **Deletes only the rows that share that `model_version`**, then re-inserts.
- All previous versions remain in `dr_ml_conversion_params` — there is no automatic cleanup.

```269:278:backend/src/ml/buildAggregatedParams.js
  await pool.query(`DELETE FROM dr_ml_conversion_params WHERE model_version = ?`, [modelVersion]);
```

This gives you **append-only version history**: every retrain is a new row group, queryable side-by-side. The `GET /api/ml/params?version=...` endpoint will return any historical version, with `latest` resolved by `trained_at DESC`:

```153:179:backend/src/server.js
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
```

### 5.3 What "rollback" looks like

Because every scored row stamps `scored_model_version`, you can pin the scorer to an earlier version simply by posting `{ "modelVersion": "agg_20260401_010101" }` to `/api/ml/score-training-leads`, or by setting `ML_MODEL_VERSION` in `.env`. This is documented in the README:

```122:124:README.md
Optional: pin a model with JSON body `{"modelVersion":"agg_20260407_120000"}` or query `?modelVersion=...`. Otherwise the latest `model_version` by `trained_at` is used (or `ML_MODEL_VERSION` in env).
```

### 5.4 Email regeneration on retrain

`generateLeadEmails` only emails leads whose `scored_model_version` matches the **latest** version, so an out-of-date scoring run will pause email generation until you re-score:

```538:547:backend/src/ml/generateLeadEmails.js
    const [leads] = await pool.query(
      `SELECT id, name, email, city, country, course, qualification, study_mode, conversion_probability
       FROM dr_training_leads
       WHERE conversion_probability > ?
         AND COALESCE(IsEmailGenerated, 0) = 0
         AND scored_model_version = ?
       ORDER BY conversion_probability DESC, id DESC
       LIMIT ?`,
      [threshold, modelVersion, batchSize],
    );
```

### 5.5 Recommended retrain flow

1. Re-import Excels: `POST /api/import` → refreshes all `dr_all_*` and `dr_conv_*`.
2. Rebuild params: `POST /api/ml/build-params` → new `agg_YYYYMMDD_HHMMSS` row group.
3. Re-score leads: `POST /api/ml/score-training-leads` → all `dr_training_leads.scored_model_version` move to the new label.
4. Re-generate emails: `POST /api/ml/generate-lead-emails` (or wait for the scheduler started at `server.js:187`).

---

## 6. Token usage — what is *actually* consumed?

> Short answer: **training and scoring use 0 LLM tokens.** The only LLM call in this repo is the per-lead Bedrock email body, which runs **after** scoring.

### 6.1 Training (`buildAggregatedParams.js`)

Pure SQL + arithmetic. Zero LLM calls, zero API tokens. The "compute cost" is:

- 8 feature mappings × 2 tables read in full (`SELECT * FROM dr_all_<x>` / `dr_conv_<x>`).
- ≤ a few thousand `UNION`'d distinct feature values across all eight features (cities × countries × courses × qualifications × lead statuses × lead sub-statuses × remarks × study modes).
- One `DELETE … WHERE model_version=?` + chunked `INSERT … VALUES ?` of `N` parameter rows.

For a realistic CRM with, say, ~500 cities, ~150 countries, ~80 courses, ~30 qualifications, ~10 lead statuses, ~50 sub-statuses, ~200 remarks categories, ~5 study modes ≈ **~1,000–1,500 parameter rows total**, training runs in seconds against MySQL on localhost. Memory footprint is dominated by `featureMaps`, which is bounded by the same ~1,500 keys.

### 6.2 Scoring (`scoreTrainingLeads.js`)

Same story: pure JS arithmetic + `UPDATE` per row. Zero LLM tokens. If you have `R` rows in `dr_training_leads`, you do `R` updates (configurable batch reads of 500). A 100k-row table is ~100k single-row `UPDATE`s, which is the actual cost driver, not anything ML-related.

### 6.3 Email generation (`generateLeadEmails.js`) — **this is the only place tokens are spent**

For every eligible lead (probability above threshold, latest model version, not yet emailed), the code builds a prompt and sends it to AWS Bedrock via the Converse API:

```474:481:backend/src/ml/generateLeadEmails.js
  const command = new ConverseCommand({
    modelId,
    inferenceConfig: {
      temperature: parseTemperature(env),
      maxTokens: parseMaxTokens(env),
    },
    messages: [{ role: "user", content: [{ text: prompt }] }],
  });
```

The prompt is constructed in `buildPrompt` (lines 385–429). Token estimate per call (using the common rule-of-thumb of **~4 characters per token** for English):

| Component                                              | Approx chars | Approx tokens |
|--------------------------------------------------------|-------------:|--------------:|
| System / style rules (`lines` array, fixed)            | ~1,800       | **~450**      |
| Profile JSON (firstName, city, country, course, …)     | ~200–400     | ~50–100       |
| Few-shot phrasing examples                             | ~400         | ~100          |
| **Input tokens per call**                              |              | **~600–700**  |
| Output (motivational email, ~180–260 words, HTML tags) | ~1,400–2,200 | **~350–550**  |
| **Total per lead (input + output)**                    |              | **~950–1,250**|

`BEDROCK_MAX_TOKENS` defaults to **2000** (capped at 2047 unless `BEDROCK_MAX_TOKENS_CAP` is set), which sets the hard ceiling on output:

```101:107:backend/src/ml/generateLeadEmails.js
function parseMaxTokens(env) {
  const capRaw = envNum(env, "BEDROCK_MAX_TOKENS_CAP");
  const hardCap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : 2047;
  const n = envNum(env, "BEDROCK_MAX_TOKENS");
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), hardCap);
  return Math.min(2000, hardCap);
}
```

**Volume math (for "how many tokens does training spend?" framed as "how many tokens does the whole pipeline spend on a refresh?")**

Let `L` = number of leads scoring above `threshold` (default `0.2`) and still flagged `IsEmailGenerated = 0`. The default scheduler runs every `LEAD_MAIL_SCHEDULE_MINUTES=60` minutes (`env.example` line 45) and a batch processes up to `DEFAULT_BATCH_SIZE = 100` leads per invocation:

```1:4:backend/src/ml/generateLeadEmails.js
const EMAIL_FEATURE_KEYS = ["city", "country", "course", "qualification", "study_mode"];
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_BATCH_SIZE = 100;
```

| Scenario                                          | Eligible leads | Tokens (low–high)         |
|---------------------------------------------------|---------------:|---------------------------|
| Single batch (default `batchSize=100`)            |            100 | **~95k – 125k**           |
| 1,000 high-propensity leads in one refresh        |          1,000 | **~0.95M – 1.25M**        |
| 10,000 leads                                      |         10,000 | **~9.5M – 12.5M**         |

(These are conservative. The actual figure depends on the chosen model — Llama 3 70B Instruct has a different tokenizer ratio than Anthropic Claude, but ~4 chars/token is a fine planning approximation for both English prompts and English HTML output.)

**Important: none of these tokens are "training" tokens** in the ML sense. They are inference tokens spent on personalized email *copy*, fully decoupled from the scoring model.

---

## 7. End-to-end timeline of a single lead

```
Excel workbooks
      │
      ▼  POST /api/import
dr_all_<sheet> / dr_conv_<sheet>            ← raw aggregates, percent cols dropped
      │
      ▼  POST /api/ml/build-params
dr_ml_conversion_params                     ← one row per (model_version, feature_key, feature_value)
      │     - probability = (conv+α)/(all+α+β)
      │     - score_logit = ln(p/(1-p))
      │
      ▼  POST /api/ml/score-training-leads
dr_training_leads                           ← per-row z, sigmoid(z), version, scored_at
      │     - conversion_probability
      │     - score_logit_sum
      │     - scored_model_version
      │
      ▼  POST /api/ml/generate-lead-emails   (or scheduler @ LEAD_MAIL_SCHEDULE_MINUTES)
dr_training_leads.EmailHTML                 ← Bedrock LLM (tokens spent here)
dr_training_leads.IsEmailGenerated          ← 0 Pending / 1 Template / 2 Bedrock / 3 Other fallback
      │
      ▼  GET /api/training-leads
Frontend list ordered by conversion_probability DESC
```

---

## 8. Limitations of the chosen model (honest read)

These are not bugs, but consequences of the deliberate aggregate-only design:

1. **Feature independence assumption.** Logits are summed across features as if `country` and `course` were independent of each other, which they aren't (e.g. "MBA" + "India" interaction is lost). A logistic regression or GBM on row-level labeled leads (once `dr_training_leads` is populated end-to-end) would capture interactions.
2. **Missing-value = neutral.** A blank `lead_status` contributes `0` to `z`, the same as a category whose logit happens to be `0`. There is no missingness indicator feature.
3. **No held-out validation.** "Training" reads aggregates and writes parameters; there is no AUC/Brier/log-loss check anywhere. `verifyAggregatedParams.js` is a sanity print, not a scorer.
4. **Sub-status / remarks dominate.** Categories with few `all_count` but any `conv_count` get unusually high probabilities even after smoothing (e.g. `(2+1)/(2+2) = 0.75`). The Beta prior helps but does not eliminate this.
5. **Stale features.** Any new category that appears in `dr_training_leads` but is **not** present in `dr_ml_conversion_params` for the active `model_version` silently contributes `0`. Retrain whenever the feature space shifts.

---

## 9. Quick reference — API endpoints

| Endpoint                                      | What it does                                                                 | LLM tokens?              |
|-----------------------------------------------|------------------------------------------------------------------------------|--------------------------|
| `POST /api/import`                            | Excel → MySQL (`dr_all_*`, `dr_conv_*`)                                      | 0                        |
| `POST /api/ml/build-params`                   | "Train" — write `dr_ml_conversion_params` for a new `model_version`          | 0                        |
| `POST /api/ml/score-training-leads`           | Score every row in `dr_training_leads` with the chosen model version         | 0                        |
| `GET  /api/ml/params?version=latest`          | Inspect model parameters (counts, α, β, probability, logit)                  | 0                        |
| `POST /api/ml/generate-lead-emails`           | Generate `EmailHTML` for leads above threshold via Bedrock (template fallback)| **Yes** (~1k per lead)  |
| `POST /api/ml/generate-lead-emails/preview`   | Same as above but dry-run (no DB writes)                                     | **Yes** (~1k per lead)   |
| `GET  /api/ml/bedrock-email-env`              | Diagnostic: env + SDK loadability, no Bedrock invoke                         | 0                        |
| `GET  /api/training-leads`                    | UI list, sorted by `conversion_probability DESC`                             | 0                        |
