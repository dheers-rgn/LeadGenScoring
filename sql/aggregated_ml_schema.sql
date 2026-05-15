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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

