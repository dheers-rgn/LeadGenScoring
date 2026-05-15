-- Lead-level training data (optional; for supervised ML when you load CRM exports).
-- Columns contact_uuid, name, email, mobile, updated_at are reference/view only — not used for inference.

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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
