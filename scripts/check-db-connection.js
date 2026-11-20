require("dotenv").config();

const mysql = require("mysql2/promise");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const useSsl = String(process.env.DB_SSL || "true").toLowerCase() !== "false";
  const sslCa = String(process.env.DB_SSL_CA || "").trim();
  const ssl = useSsl
    ? { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) }
    : undefined;

  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl,
    connectTimeout: 15000
  });

  try {
    const [rows] = await connection.query(
      "SELECT DATABASE() AS databaseName, VERSION() AS serverVersion"
    );
    const result = rows[0] || {};
    console.log("[DB CHECK] Connection successful.");
    console.log("[DB CHECK] Database:", result.databaseName || "unknown");
    console.log("[DB CHECK] Server version:", result.serverVersion || "unknown");
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error("[DB CHECK] Connection failed:", error.code || error.message);
  process.exitCode = 1;
});
