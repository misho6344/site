"use strict";

const crypto = require("node:crypto");
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
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error(`${name} must include a database name.`);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: sslEnabled ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 20000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true
  };
}

function canonicalValue(value) {
  if (value === null) return ["null", null];
  if (Buffer.isBuffer(value)) return ["buffer", value.toString("base64")];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (Array.isArray(value)) return ["array", value.map(canonicalValue)];
  if (typeof value === "object") {
    return ["object", Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])];
  }
  return [typeof value, String(value)];
}

function hashPart(hash, value) {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(encoded.length));
  hash.update(length);
  hash.update(encoded);
}

async function inspectDatabase(label, config) {
  const connection = await mysql.createConnection(config);
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const [tables] = await connection.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );

    const result = new Map();
    for (const { tableName } of tables) {
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, EXTRA AS extra, COLUMN_DEFAULT AS columnDefault FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
        [tableName]
      );
      const [primaryKeyRows] = await connection.query(
        "SELECT COLUMN_NAME AS columnName FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = 'PRIMARY' ORDER BY seq_in_index",
        [tableName]
      );
      const primaryKey = primaryKeyRows.map(row => row.columnName);
      if (!primaryKey.length) {
        throw new Error(`Table ${tableName} has no primary key; deterministic row verification cannot safely continue.`);
      }

      const orderBy = primaryKey.map(column => mysql.escapeId(column)).join(", ");
      const sql = `SELECT * FROM ${mysql.escapeId(tableName)} ORDER BY ${orderBy}`;
      const stream = connection.query({ sql, rowsAsArray: true }).stream({ highWaterMark: 32 });
      const digest = crypto.createHash("sha256");
      let rowCount = 0;

      await new Promise((resolve, reject) => {
        stream.on("data", row => {
          const canonical = row.map(canonicalValue);
          hashPart(digest, canonical);
          rowCount += 1;
        });
        stream.once("end", resolve);
        stream.once("error", reject);
      });

      result.set(tableName, {
        rowCount,
        primaryKey,
        columns: columns.map(c => [
          c.columnName, c.columnType, c.isNullable, c.extra,
          c.columnDefault === null ? null : String(c.columnDefault)
        ]),
        dataSha256: digest.digest("hex")
      });
      console.log(`[${label}] Verified ${tableName}: ${rowCount} rows.`);
    }

    console.log(`[${label}] Snapshot inspected; found ${result.size} tables.`);
    return result;
  } finally {
    try { await connection.query("ROLLBACK"); } catch {}
    await connection.end();
  }
}

async function main() {
  const primaryConfig = connectionConfig("PRIMARY_DATABASE_URL");
  const secondaryConfig = connectionConfig("SECONDARY_DATABASE_URL");
  if (primaryConfig.host === secondaryConfig.host &&
      primaryConfig.port === secondaryConfig.port &&
      primaryConfig.database === secondaryConfig.database) {
    throw new Error("Primary and secondary point to the same database; refusing comparison.");
  }

  console.log("[DATABASE PAIR] Read-only comparison starting.");
  console.log("[DATABASE PAIR] Pause application writes on both databases before running for a comparable cutover snapshot.");

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
    if (JSON.stringify(p.primaryKey) !== JSON.stringify(s.primaryKey)) {
      problems.push(`Primary-key mismatch: ${name}`);
    }
    if (JSON.stringify(p.columns) !== JSON.stringify(s.columns)) {
      problems.push(`Column-definition mismatch: ${name}`);
    }
    if (p.dataSha256 !== s.dataSha256) {
      problems.push(`Data SHA-256 mismatch: ${name}`);
    }
  }

  if (problems.length) {
    console.error("\n[DATABASE PAIR] VERIFICATION FAILED");
    for (const problem of problems) console.error("- " + problem);
    process.exitCode = 1;
    return;
  }

  console.log("\n[DATABASE PAIR] All table schemas, primary keys, row counts and row-content hashes match.");
  console.log("[DATABASE PAIR] This is a read-only verification. It is not a substitute for a verified backup and restore drill.");
}

main().catch(error => {
  console.error("[DATABASE PAIR] Verification failed:", error.message);
  process.exitCode = 1;
});
