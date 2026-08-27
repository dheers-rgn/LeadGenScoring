// helpers/getLastProcessedId.js

export async function getLastProcessedId(pool) {
  const [rows] = await pool.query(`
    SELECT last_contact_id
    FROM aggregation_metadata
    ORDER BY id DESC
    LIMIT 1
  `);

  return rows[0]?.last_contact_id || 0;
}

export async function getLatestContactId(pool) {
  const [rows] = await pool.query(`
    SELECT MAX(id) AS maxId
    FROM dr_contacts_V3
  `);

  return rows[0]?.maxId || 0;
}

export async function saveAggregationMetadata(
  pool,
  aggregateId,
  lastContactId,
) {
  await pool.query(
    `
      INSERT INTO aggregation_metadata
      (aggregate_id, last_contact_id)
      VALUES (?, ?)
    `,
    [aggregateId, lastContactId],
  );
}

 