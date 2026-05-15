-- Lookup for dr_training_leads.IsEmailGenerated codes.
CREATE TABLE IF NOT EXISTS dr_email_generation_status (
  code TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  label VARCHAR(96) NOT NULL,
  description VARCHAR(512) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO dr_email_generation_status (code, label, description) VALUES
(0, 'Pending', 'Not yet generated; eligible when conversion probability > threshold and latest model version'),
(1, 'Template', 'Email HTML generated using the built-in template (Bedrock not used or not configured)'),
(2, 'Bedrock', 'Email HTML generated using the configured AWS Bedrock model'),
(3, 'Other fallback', 'Bedrock was invoked but failed or returned empty; built-in template was used as fallback')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description);
