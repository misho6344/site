const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { migrateLegacy } = require("./migrate");

function createPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing. Copy .env.example to .env and fill it in.");
  
  const useSsl = String(process.env.DB_SSL || "true").toLowerCase() !== "false";
  
  // ვუზრუნველყოფთ, რომ კავშირის URL-ს ბოლოში ჰქონდეს ჩაწერის (readwrite) უფლება, 
  // ან ვუთითებთ პარამეტრებს პირდაპირ პულს.
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl.includes("readonly=")) {
    dbUrl += (dbUrl.includes("?") ? "&" : "?") + "readonly=0";
  }

  return mysql.createPool({
    uri: dbUrl,
    waitForConnections: true,
    connectionLimit: 8,
    ssl: useSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined
  });
}

async function initSchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  await migrateLegacy(pool);
}

module.exports = { createPool, initSchema };
