import mysql from "mysql2/promise";

const targetPool = mysql.createPool({
  host: process.env.TARGET_DB_HOST,
  port: Number(process.env.TARGET_DB_PORT),
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: process.env.TARGET_DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

targetPool
  .getConnection()
  .then((connection) => {
    console.log("✅ TARGET DB connected");
    connection.release();
  })
  .catch((error) => {
    console.error("❌ TARGET DB connection failed:", error);
  });

export default targetPool;