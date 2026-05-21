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
- Docker Desktop (Compose v2)
- Node.js 20+ (only needed if you want to run backend / frontend outside Docker)

## Run the full stack with Docker

The stack is three services, brought up in order by Compose:

```
mysql  →  backend  →  frontend
 (db)     (Node.js)   (built React + nginx)
```

`backend` waits for `mysql` to be **healthy** before starting; `frontend` waits for `backend` to be **healthy**.

### 1) One-time setup

```bash
cp backend/.env.example backend/.env
# edit backend/.env: set MYSQL_ROOT_PASSWORD, AWS_*, BEDROCK_MODEL_ID, ALL_EXCEL_PATH, CONV_EXCEL_PATH

cp frontend/.env.example frontend/.env   # optional, only if you change VITE_API_BASE
```

`ALL_EXCEL_PATH` / `CONV_EXCEL_PATH` in `backend/.env` must point to the **host** paths of the two Excel workbooks — Compose bind-mounts them read-only into the backend container at `/data/LeadAnalysis.xlsx` and `/data/LeadConverted.xlsx`.

### 2) Final docker run command

```bash
docker compose --env-file backend/.env up -d --build
```

That single command:
- Builds `backend` (Node 20-alpine) and `frontend` (multi-stage: Vite build → nginx).
- Starts `mysql` and waits for its healthcheck.
- Starts `backend` (depends on `mysql: service_healthy`) and waits for `GET /api/health` to return 200.
- Starts `frontend` (depends on `backend: service_healthy`).

After it's up:

| URL                                    | What                  |
|----------------------------------------|-----------------------|
| http://localhost:5173                  | React UI (nginx)      |
| http://localhost:8080/api/health       | Backend health probe  |
| `localhost:3306`                       | MySQL (`LeadsDB`)     |

### 3) Useful follow-ups

```bash
docker compose logs -f backend          # tail backend logs
docker compose logs -f frontend         # tail nginx logs
docker compose ps                       # see health + ports
docker compose down                     # stop everything (volume preserved)
docker compose down -v                  # stop AND wipe MySQL data volume
docker compose --env-file backend/.env up -d --build backend   # rebuild only backend
```

### 4) Run components outside Docker (optional)

You can still run backend / frontend natively against the dockerized MySQL:

```bash
# Backend (uses backend/.env: DB_HOST=127.0.0.1, DATABASE_URL=mysql://...127.0.0.1...)
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

API endpoints exposed by the backend:
- `POST /api/import` import both workbooks
- `GET /api/tables` list imported tables
- `GET /api/table/:name?limit=100` preview rows
- `POST /api/ml/build-params` build aggregated ML scoring parameters table
- `POST /api/ml/score-training-leads` write per-row `conversion_probability` on `dr_training_leads`
- `GET /api/ml/params?version=latest` read latest (or specific) model parameters

## Connection string
- DSN (host → container): `mysql://leads_user:leads_pass@127.0.0.1:3306/LeadsDB`
- DSN (backend container → mysql container): `mysql://leads_user:leads_pass@mysql:3306/LeadsDB` (Compose sets this automatically via `DATABASE_URL`)

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

{/* Reason: Procedural restoration steps on the secondary machine. */}
  Open your terminal on the new machine, navigate to the folder where you placed `backup.sql`, and start a fresh container with a clean volume attached:

```docker command for restoring the database on another machine using sql backup 
   Move the newly created `backup.sql` file over to your secondary machine.
   {/* Reason: Procedural restoration steps on the secondary machine. */}
   Open your terminal on the new machine, navigate to the folder where you placed `backup.sql`, and start a fresh container with a clean volume attached:

docker run -d
--name leadsdb-mysql
-v leadsdb_mysql_data:/var/lib/mysql
-e MYSQL_ROOT_PASSWORD="your_root_password"
-p 3306:3306
mysql:latest

