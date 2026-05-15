-- Migration: IsMailGenerated -> IsEmailGenerated (codes 0–3) and lookup table.
-- Run dr_email_generation_status.sql first, or copy its CREATE/INSERT below.

-- Lookup table (safe to re-run)
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

-- Add IsEmailGenerated if missing (ignore duplicate column error if already applied)
ALTER TABLE dr_training_leads ADD COLUMN IsEmailGenerated TINYINT UNSIGNED NOT NULL DEFAULT 0
  COMMENT 'dr_email_generation_status.code';

-- Re-queue all leads for email generation
UPDATE dr_training_leads SET IsEmailGenerated = 0;

-- Optional: remove legacy column after deploy (uncomment when ready)
-- ALTER TABLE dr_training_leads DROP COLUMN IsMailGenerated;
