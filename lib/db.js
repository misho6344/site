const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { migrateLegacy } = require("./migrate");

const TRANSIENT_CONNECTION_ERRORS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"
]);
// Keep failed reads responsive; a sleeping database gets time to wake via the
// connection timeout instead of stacking a long series of query retries.
const READ_RETRY_DELAYS_MS = [500];

function getTransientConnectionCode(error) {
  const code = String(error?.code || "").toUpperCase();
  if (TRANSIENT_CONNECTION_ERRORS.has(code)) return code;
  if ([2006, 2013, 2055].includes(Number(error?.errno))) {
    return "PROTOCOL_CONNECTION_LOST";
  }
  if (/database unavailable|database is still starting/i.test(String(error?.message || ""))) {
    return "PROTOCOL_CONNECTION_LOST";
  }
  return code;
}

function getSqlText(sql) {
  if (typeof sql === "string") return sql.trimStart();
  if (sql && typeof sql.sql === "string") return sql.sql.trimStart();
  return "";
}

function isSafeReadQuery(sql) {
  const statement = getSqlText(sql);
  if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(statement)) return false;
  if (/\bFOR\s+(UPDATE|SHARE)\b/i.test(statement)) return false;
  return true;
}

function addReadRetry(pool) {
  const originalQuery = pool.query.bind(pool);

  pool.query = async function queryWithTransientRetry(sql, ...args) {
    const canRetry = isSafeReadQuery(sql);
    const maxRetries = canRetry ? READ_RETRY_DELAYS_MS.length : 0;

    for (let retry = 0; ; retry += 1) {
      try {
        return await originalQuery(sql, ...args);
      } catch (error) {
        const code = getTransientConnectionCode(error);
        const retryable = canRetry && TRANSIENT_CONNECTION_ERRORS.has(code);
        if (!retryable || retry >= maxRetries) throw error;

        const delayMs = READ_RETRY_DELAYS_MS[retry];
        console.warn("[DB] Transient read connection failure; retrying.", {
          code,
          retry: retry + 1,
          delayMs
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  };

  return pool;
}

// Retry only the idempotent schema/bootstrap sequence after transient network disconnects.
const DATABASE_STARTUP_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

async function withDatabaseRetry(operation, label = "database initialization") {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = getTransientConnectionCode(error);
      const retryable = TRANSIENT_CONNECTION_ERRORS.has(code);
      if (!retryable || attempt >= DATABASE_STARTUP_RETRY_DELAYS_MS.length) throw error;

      const delayMs = DATABASE_STARTUP_RETRY_DELAYS_MS[attempt];
      console.warn("[DB] " + label + " interrupted by a transient connection error; retrying.", {
        code,
        retry: attempt + 1,
        delayMs
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Copy .env.example to .env and fill it in.");
  }

  const useSsl = String(process.env.DB_SSL || "true").toLowerCase() !== "false";
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    idleTimeout: 30_000,
    connectTimeout: 30_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    ssl: useSsl ? {} : undefined
  });

  addReadRetry(pool);
  return pool;
}

async function initSchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  // Ensure the database session supports writes.
  await pool.query("SET SESSION TRANSACTION READ WRITE");
  await migrateLegacy(pool);
}

module.exports = { createPool, initSchema, withDatabaseRetry, getTransientConnectionCode };
