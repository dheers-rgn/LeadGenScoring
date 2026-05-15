-- Run once if `dr_training_leads` exists without per-row scoring columns.
-- Ignore "Duplicate column" errors if a column already exists.

ALTER TABLE dr_training_leads ADD COLUMN conversion_probability DOUBLE NULL COMMENT 'predicted conversion probability from aggregated ML params';
ALTER TABLE dr_training_leads ADD COLUMN score_logit_sum DOUBLE NULL COMMENT 'sum of score_logit before sigmoid';
ALTER TABLE dr_training_leads ADD COLUMN scored_model_version VARCHAR(64) NULL COMMENT 'dr_ml_conversion_params.model_version used';
ALTER TABLE dr_training_leads ADD COLUMN scored_at DATETIME NULL COMMENT 'when batch scoring last ran';
