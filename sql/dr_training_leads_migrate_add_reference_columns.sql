-- Run once if `dr_training_leads` already exists without the reference columns.
-- `CREATE TABLE IF NOT EXISTS` does NOT add columns to an existing table — use this migration instead.
-- If you see "Duplicate column name", skip that statement.

ALTER TABLE dr_training_leads ADD COLUMN contact_uuid VARCHAR(64) NULL COMMENT 'reference only' AFTER id;
ALTER TABLE dr_training_leads ADD COLUMN name VARCHAR(255) NULL COMMENT 'reference only' AFTER lead_id;
ALTER TABLE dr_training_leads ADD COLUMN email VARCHAR(255) NULL COMMENT 'reference only' AFTER name;
ALTER TABLE dr_training_leads ADD COLUMN mobile VARCHAR(64) NULL COMMENT 'reference only' AFTER email;
ALTER TABLE dr_training_leads ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'reference only' AFTER created_at;

CREATE INDEX idx_contact_uuid ON dr_training_leads (contact_uuid);
CREATE INDEX idx_lead_id ON dr_training_leads (lead_id);
