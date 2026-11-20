const mysql = require("mysql2/promise");

function connectionConfig() {
  const rawUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("SOURCE_DATABASE_URL (or DATABASE_URL) is required. Set it in the Render Cron service environment.");
  }

  const url = new URL(rawUrl);
  if (!["mysql:", "mysql2:"].includes(url.protocol)) {
    throw new Error("Source database URL must use mysql://.");
  }

  const useSsl = String(process.env.SOURCE_DB_SSL || process.env.DB_SSL || "true").toLowerCase() !== "false";
  const sslCa = String(process.env.SOURCE_DB_SSL_CA || process.env.DB_SSL_CA || "").trim();

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: useSsl ? { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) } : undefined,
    connectTimeout: 15000
  };
}

async function main() {
  let connection;
  try {
    connection = await mysql.createConnection(connectionConfig());
    const [rows] = await connection.query(
      "SELECT DATABASE() AS databaseName, VERSION() AS serverVersion"
    );
    const result = rows[0] || {};
    console.log("[ENZONIC MONITOR] CONNECTION_OK", {
      database: result.databaseName,
      serverVersion: result.serverVersion,
      checkedAt: new Date().toISOString()
    });
    console.log("[ENZONIC MONITOR] Read-only check completed. No tables or data were modified.");
  } catch (error) {
    console.error("[ENZONIC MONITOR] CONNECTION_FAILED", {
      code: error.code || "UNKNOWN",
      message: error.message,
      checkedAt: new Date().toISOString()
    });
    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (error) {
        console.error("[ENZONIC MONITOR] Connection close warning:", error.message);
      }
    }
  }
}

main();
