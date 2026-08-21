import mysql from "mysql2/promise";

const sourcePool = mysql.createPool({
  host: process.env.SOURCE_DB_HOST,
  port: Number(process.env.SOURCE_DB_PORT),
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

sourcePool
  .getConnection()
  .then((connection) => {
    console.log("✅ SOURCE DB connected");
    connection.release();
  })
  .catch((error) => {
    console.error("❌ SOURCE DB connection failed:", error);
  });

export default sourcePool;