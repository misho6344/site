"use strict";

const mysql = require("mysql2/promise");

function connectionConfig(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`Missing required environment variable: ${name}`);
  const url = new URL(raw);
  if (!["mysql:", "mysql2:"].includes(url.protocol)) {
    throw new Error(`${name} must use mysql://`);
  }
  const sslName = name === "PRIMARY_DATABASE_URL" ? "PRIMARY_DB_SSL" : "SECONDARY_DB_SSL";
  const sslEnabled = String(process.env[sslName] || "true").toLowerCase() !== "false";
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: sslEnabled ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };
}

async function inspectDatabase(label, config) {
  const connection = await mysql.createConnection(config);
  try {
    const [tables] = await connection.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const result = new Map();
    for (const { tableName } of tables) {
      const safeName = String(tableName).replace(/`/g, "``");
      const [[count]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${safeName}\``);
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, EXTRA AS extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
        [tableName]
      );
      result.set(tableName, {
        rowCount: Number(count.rowCount),
        columns: columns.map(c => [c.columnName, c.columnType, c.isNullable, c.extra].join("|"))
      });
    }
    console.log(`[${label}] Connected; found ${result.size} tables.`);
    return result;
  } finally {
    await connection.end();
  }
}

async function main() {
  const primaryConfig = connectionConfig("PRIMARY_DATABASE_URL");
  const secondaryConfig = connectionConfig("SECONDARY_DATABASE_URL");
  const [primary, secondary] = await Promise.all([
    inspectDatabase("PRIMARY", primaryConfig),
    inspectDatabase("SECONDARY", secondaryConfig)
  ]);

  const names = [...new Set([...primary.keys(), ...secondary.keys()])].sort();
  const problems = [];
  for (const name of names) {
    const p = primary.get(name);
    const s = secondary.get(name);
    if (!p) {
      problems.push(`Table exists only on SECONDARY: ${name}`);
      continue;
    }
    if (!s) {
      problems.push(`Table missing on SECONDARY: ${name}`);
      continue;
    }
    if (p.rowCount !== s.rowCount) {
      problems.push(`Row-count mismatch ${name}: primary=${p.rowCount}, secondary=${s.rowCount}`);
    }
    if (JSON.stringify(p.columns) !== JSON.stringify(s.columns)) {
      problems.push(`Column-definition mismatch: ${name}`);
    }
  }

  if (problems.length) {
    console.error("\n[DATABASE PAIR] VERIFICATION FAILED");
    for (const problem of problems) console.error("- " + problem);
    process.exitCode = 1;
    return;
  }

  console.log("\n[DATABASE PAIR] Schema and row counts match.");
  console.log("[DATABASE PAIR] This is a read-only structural check, not a full row-by-row data integrity proof.");
}

main().catch(error => {
  console.error("[DATABASE PAIR] Verification failed:", error.message);
  process.exitCode = 1;
});
