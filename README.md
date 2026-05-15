# LeadGenScoring (Excel → MySQL)

Node.js backend + React frontend that imports two Excel workbooks (multiple tabs) into MySQL tables.

## Inputs
- All-leads workbook: `/Users/apple/Documents/LeadAnalysis.xlsx`
  - Tables: `dr_all_<tab_name>`
- Converted-leads workbook: `/Users/apple/Documents/LeadConverted.xlsx`
  - Tables: `dr_conv_<tab_name>`

`<tab_name>` is the Excel tab name sanitized to lowercase `snake_case`.

**Percent-formatted columns are excluded**: any column where at least one data cell is formatted as a percentage in Excel will be ignored (not created in MySQL and not loaded).

## Prereqs
- Docker Desktop
- Node.js 20+ (for backend + frontend)

## 1) Start MySQL (Docker)

```bash
docker compose up -d
```

MySQL will be available on `localhost:3306` with database `LeadsDB`.

## 2) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API:
- `POST /api/import` import both workbooks
- `GET /api/tables` list imported tables
- `GET /api/table/:name?limit=100` preview rows
- `POST /api/ml/build-params` build aggregated ML scoring parameters table
- `POST /api/ml/score-training-leads` write per-row `conversion_probability` on `dr_training_leads`
- `GET /api/ml/params?version=latest` read latest (or specific) model parameters

## 3) Frontend

```bash
cd frontend
npm install
npm run dev
```

## Connection string
- DSN: `mysql://leads_user:leads_pass@127.0.0.1:3306/LeadsDB`

## Lead-level training table (optional)

`dr_training_leads` holds CRM-style rows for future supervised training. These columns are **reference / display only** and are **not** used by the aggregated ML builder:

- `contact_uuid`, `name`, `email`, `mobile`, `updated_at`

Create (new database only — `CREATE TABLE IF NOT EXISTS` does **not** add columns to an existing table):

```bash
docker exec -i leadsdb-mysql mysql -uleads_user -pleads_pass LeadsDB < sql/dr_training_leads.sql
```

If `dr_training_leads` already exists and is missing the reference columns, run the migration once:

```bash
docker exec -i leadsdb-mysql mysql -uleads_user -pleads_pass LeadsDB < sql/dr_training_leads_migrate_add_reference_columns.sql
```

Scoring output columns (added on new installs via `sql/dr_training_leads.sql`; existing DBs: run migration below):

- `conversion_probability` — predicted conversion probability per row
- `score_logit_sum` — sum \(z\) of matched `score_logit` terms before sigmoid
- `scored_model_version` — which `dr_ml_conversion_params.model_version` was used
- `scored_at` — when the batch scorer last updated the row

```bash
docker exec -i leadsdb-mysql mysql -uleads_user -pleads_pass LeadsDB < sql/dr_training_leads_migrate_add_scoring_columns.sql
```

## Aggregated ML Scoring Parameters

This creates conversion scoring parameters from aggregated tables (`dr_all_*` and `dr_conv_*`) and stores them in `dr_ml_conversion_params`.

### Create schema

```bash
docker exec -i leadsdb-mysql mysql -uleads_user -pleads_pass LeadsDB < sql/aggregated_ml_schema.sql
```

### Build parameter model

```bash
curl -X POST http://localhost:8080/api/ml/build-params
```

### Probability and score formula

For each `(feature_key, feature_value)`:

- `p = (conv_count + alpha) / (all_count + alpha + beta)`
- `score_logit = ln(p / (1 - p))`

`Lead` and `Re-enquired` in `lead_status` are always included and get non-zero probability via smoothing and `ML_LEAD_STATUS_FLOOR`.

To later score a real lead, sum one score per feature and convert with sigmoid:

- `z = sum(score_logit for matched feature values)`
- `probability = 1 / (1 + exp(-z))`

This treats dimensions as independent (naive combination of marginal logits from aggregates).

### Per-row scores on `dr_training_leads`

After `POST /api/ml/build-params` has populated `dr_ml_conversion_params`, load sample rows into `dr_training_leads` (feature columns + `converted` label), then run:

```bash
curl -X POST http://localhost:8080/api/ml/score-training-leads
```

Optional: pin a model with JSON body `{"modelVersion":"agg_20260407_120000"}` or query `?modelVersion=...`. Otherwise the latest `model_version` by `trained_at` is used (or `ML_MODEL_VERSION` in env).

**Matching:** lookups use **trim + lowercase** on both the training row value and `dr_ml_conversion_params.feature_value`. If a dimension value has no matching param row, it contributes `0` to `z`. **Remarks** must match a category present in the aggregated remarks tables or that term contributes `0`.

