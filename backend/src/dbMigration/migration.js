import sourcePool from "./sourceDb.js";
import targetPool from "./targetDb.js";

const BATCH_SIZE = 1000;

const TARGET_SCHEMA = `
CREATE TABLE IF NOT EXISTS dr_contacts_V2 (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    auto_id INT NULL,
    is_campaign_unsubscribe TINYINT(1) NOT NULL DEFAULT 0,
    creator_user_id INT NULL,
    contact_uuid1 VARCHAR(55) NULL,
    contact_uuid VARCHAR(55) NULL,
    name VARCHAR(55) NULL,
    learner_name VARCHAR(100) NULL,
    curriculum VARCHAR(100) NULL,
    email VARCHAR(100) NULL,
    current_designation VARCHAR(100) NULL,
    dial_code VARCHAR(5) NULL,
    dial_number VARCHAR(20) NULL,
    mobile VARCHAR(15) NULL,
    alternate_mobile VARCHAR(15) NULL,
    alternate_email VARCHAR(50) NULL,
    address VARCHAR(500) NULL,
    city VARCHAR(100) NULL,
    pincode VARCHAR(10) NULL,
    country_id INT NULL,
    is_country_mismatch TINYINT(1) NULL DEFAULT 0,
    interest_id INT NULL,
    school_lead_flag TINYINT(1) NOT NULL DEFAULT 0,
    school_interest_id INT UNSIGNED NULL,
    hlq_id INT NULL,
    mode VARCHAR(20) NULL,
    study_mode VARCHAR(20) NULL,
    preferred_time_to_call TIME NULL,
    expected_billing VARCHAR(45) NULL,
    notes TEXT NULL,
    referral_code VARCHAR(20) NOT NULL,
    referred_by INT NULL,
    self_source VARCHAR(50) NULL,
    is_agent TINYINT NOT NULL DEFAULT 0,
    is_payment_success INT NOT NULL DEFAULT 0,
    transaction_reference_number VARCHAR(45) NULL,
    transaction_resource VARCHAR(45) NULL,
    organization_name VARCHAR(100) NULL,
    work_experience INT NULL,
    payment_amount INT NOT NULL DEFAULT 0,
    is_lead_created INT NOT NULL DEFAULT 0,
    is_repeated INT NOT NULL DEFAULT 0,
    is_manual INT NOT NULL DEFAULT 0,
    is_email_verified INT NOT NULL DEFAULT 0,
    is_churned INT NULL,
    distribution_initiated_at DATETIME NULL,
    is_otp_verified INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    reggie_id VARCHAR(255) NULL,
    last_email_interest_sent INT NULL,
    last_email_school_sent INT NULL,
    last_email_sent_at DATETIME NULL,

    INDEX idx_auto_id (auto_id),
    INDEX idx_creator_user_id (creator_user_id),
    INDEX idx_contact_uuid (contact_uuid),
    INDEX idx_name (name),
    UNIQUE KEY uk_email (email),
    INDEX idx_mobile (mobile),
    INDEX idx_alternate_mobile (alternate_mobile),
    INDEX idx_alternate_email (alternate_email),
    INDEX idx_address (address),
    INDEX idx_city (city),
    INDEX idx_pincode (pincode),
    INDEX idx_country_id (country_id),
    INDEX idx_interest_id (interest_id),
    INDEX idx_hlq_id (hlq_id),
    INDEX idx_mode (mode),
    INDEX idx_study_mode (study_mode),
    INDEX idx_preferred_time_to_call (preferred_time_to_call),
    INDEX idx_expected_billing (expected_billing),
    INDEX idx_referral_code (referral_code),
    INDEX idx_referred_by (referred_by),
    INDEX idx_self_source (self_source),
    INDEX idx_is_agent (is_agent),
    INDEX idx_is_lead_created (is_lead_created),
    INDEX idx_is_repeated (is_repeated),
    INDEX idx_is_manual (is_manual),
    INDEX idx_is_email_verified (is_email_verified),
    INDEX idx_is_churned (is_churned),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
);
`;

const LEADS_TARGET_SCHEMA = `
CREATE TABLE IF NOT EXISTS dr_leads_V2 (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    lead_uuid VARCHAR(55) NULL,
    user_id INT NULL,
    contact_id INT NULL,
    lead_status INT NOT NULL DEFAULT 1,
    lead_sub_status INT NOT NULL DEFAULT 1,
    call_status INT NOT NULL DEFAULT 1,
    expected_billing INT NULL DEFAULT 0,
    churn_flag INT NULL DEFAULT 0,
    is_search_indexed INT NOT NULL DEFAULT 0,
    is_vinesearch_synced INT NOT NULL DEFAULT 0,
    vinesearch_synced_status VARCHAR(100) NULL,
    vinesearch_synced_task_id VARCHAR(100) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    churned_at DATETIME NULL,
    rrt_status TINYINT(1) NULL DEFAULT 0,
    is_search_synced TINYINT(1) NULL DEFAULT 0,
    is_app_fee_paid TINYINT(1) NULL DEFAULT 0,
    is_presales_distributed TINYINT(1) NULL DEFAULT 0,
    search_synced_status VARCHAR(100) NULL,
    search_synced_task_id VARCHAR(100) NULL,
    source_of_funding VARCHAR(50) NULL,
    is_merger_indexed INT NOT NULL DEFAULT 0,
    is_common_indexed TINYINT NOT NULL DEFAULT 0,

    INDEX idx_lead_uuid (lead_uuid),
    INDEX idx_user_id (user_id),
    UNIQUE KEY uk_contact_id (contact_id),
    INDEX idx_lead_status (lead_status),
    INDEX idx_lead_sub_status (lead_sub_status),
    INDEX idx_rrt_status (rrt_status),
    INDEX idx_is_search_synced (is_search_synced),
    INDEX idx_search_synced_status (search_synced_status),
    INDEX idx_search_synced_task_id (search_synced_task_id),
    INDEX idx_created_at (created_at)
);
`;

async function migrateContacts() {
  const sourceConnection = await sourcePool.getConnection();
  const targetConnection = await targetPool.getConnection();

  try {
    console.log("Starting migration...");

    // ------------------------------------------------
    // 1. Create target table if it doesn't exist
    // ------------------------------------------------

    console.log("Checking target table...");

    await targetConnection.query(LEADS_TARGET_SCHEMA);

    console.log("Target table is ready.");

    // ------------------------------------------------
    // 2. Get matching columns
    // ------------------------------------------------

    const [sourceColumns] = await sourceConnection.query(`
        SHOW COLUMNS FROM merger_retail.dr_leads
    `);

    const [targetColumns] = await targetConnection.query(`
        SHOW COLUMNS FROM retail_pre_prod.dr_leads_V2
    `);

    const sourceColumnNames = sourceColumns.map((column) => column.Field);

    const targetColumnNames = targetColumns.map((column) => column.Field);

    // Only columns existing in BOTH tables
    const commonColumns = sourceColumnNames.filter((column) =>
      targetColumnNames.includes(column),
    );

    console.log("Common columns:");
    console.log(commonColumns);

    // ------------------------------------------------
    // 3. Build column list
    // ------------------------------------------------

    const columnList = commonColumns
      .map((column) => `\`${column}\``)
      .join(", ");

    // ------------------------------------------------
    // 4. Find minimum source ID for last 4 months
    // ------------------------------------------------

    const [minIdResult] = await sourceConnection.query(`
        SELECT MIN(id) AS min_id
        FROM merger_retail.dr_leads
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 4 MONTH)
    `);

    const minId = minIdResult[0].min_id;

    if (minId === null) {
      return {
        success: true,
        message: "No contacts found in the last 4 months.",
        migratedRows: 0,
      };
    }

    console.log("Starting from ID:", minId);

    // ------------------------------------------------
    // 5. Batch migration
    // ------------------------------------------------

    let lastId = minId - 1;
    let migratedRows = 0;

    while (true) {
        const [rows] = await sourceConnection.query(
          `
          SELECT ${columnList}
          FROM merger_retail.dr_leads
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 4 MONTH)
            AND id > ?
          ORDER BY id ASC
          LIMIT ?
          `,
          [lastId, BATCH_SIZE]
        );

      // const [rows] = await sourceConnection.query(
      //   `
      //       SELECT ${columnList}
      //       FROM merger_retail.dr_contacts
      //       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 4 MONTH)
      //       ORDER BY id ASC
      //       LIMIT ?
      //       `,
      //   [100000],
      // );

      if (rows.length === 0) {
        break;
      }

      // ----------------------------------------------
      // Create placeholders
      // ----------------------------------------------

      const placeholders = rows
        .map(() => `(${commonColumns.map(() => "?").join(", ")})`)
        .join(", ");

      // ----------------------------------------------
      // Flatten values
      // ----------------------------------------------

      const values = [];

      for (const row of rows) {
        for (const column of commonColumns) {
          values.push(row[column]);
        }
      }

      // ----------------------------------------------
      // Insert into target
      // ----------------------------------------------

      const insertQuery = `
        INSERT INTO retail_pre_prod.dr_leads_V2
        (${columnList})
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
        id = VALUES(id)
      `;

      await targetConnection.query(insertQuery, values);

      migratedRows += rows.length;

      lastId = rows[rows.length - 1].id;

      console.log(`Migrated ${migratedRows} rows. Last ID: ${lastId}`);
    }

    console.log("Migration completed.");

    return {
      success: true,
      message: "Contacts migrated successfully.",
      migratedRows,
      period: "Last 4 months",
    };
  } catch (error) {
    console.error("Migration failed:", error);

    throw error;
  } finally {
    sourceConnection.release();
    targetConnection.release();
  }
}

export { migrateContacts };
