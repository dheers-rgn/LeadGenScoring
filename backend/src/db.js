import mysql from "mysql2/promise";

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:") {
    throw new Error(`Unsupported DATABASE_URL protocol: ${url.protocol}`);
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    database: url.pathname?.replace(/^\//, "") || "",
  };
}

export function getDbConfigFromEnv(env = process.env) {
  if (env.DATABASE_URL) return parseDatabaseUrl(env.DATABASE_URL);
  return {
    host: env.DB_HOST || "127.0.0.1",
    port: env.DB_PORT ? Number(env.DB_PORT) : 3306,
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME || "LeadsDB",
  };
}

export function createPool(env = process.env) {
  const cfg = getDbConfigFromEnv(env);
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    charset: "utf8mb4",
  });
}

