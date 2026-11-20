"use strict";

// READ-ONLY inventory. This script never creates, updates, or deletes database rows.
const mysql = require("mysql2/promise");

function configFromUrl(envName, expectedSuffix, expectedPort) {
  const raw = process.env[envName];
  if (!raw) throw new Error(`Missing GitHub Actions secret: ${envName}`);
  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error(`${envName} must be a mysql:// URL.`);
  if (!url.hostname.endsWith(expectedSuffix)) throw new Error(`Safety stop: ${envName} host is not an approved ${expectedSuffix} host.`);
  if (Number(url.port || 3306) !== expectedPort) throw new Error(`Safety stop: unexpected port in ${envName}.`);
  const sslMode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (sslMode !== "REQUIRED" && sslMode !== "VERIFY_IDENTITY") throw new Error(`Safety stop: TLS must be required for ${envName}.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`${envName} must include a database name.`);
  return {
    host: url.hostname,
    port: expectedPort,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 20000,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true
  };
}

async function inspect(label, db) {
  const connection = await mysql.createConnection(db);
  try {
    const [tables] = await connection.query(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const available = new Set(tables.map(t => t.name));
    const selected = ["site_banner", "site_banners", "site_home_sections"];
    const report = { label, database: db.database, tables: {} };
    for (const table of selected) {
      if (!available.has(table)) {
        report.tables[table] = { exists: false };
        continue;
      }
      const [[count]] = await connection.query(`SELECT COUNT(*) AS count FROM \u0060${table}\u0060`);
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
        [table]
      );
      report.tables[table] = { exists: true, rows: String(count.count), columns: columns.map(c => ({name:c.name,type:c.type})) };
    }
    if (available.has("site_home_sections")) {
      const [sections] = await connection.query("SELECT section_key, CHAR_LENGTH(movie_ids) AS movie_ids_length, updated_at FROM site_home_sections ORDER BY section_key");
      report.homeSections = sections;
    }
    if (available.has("site_banners")) {
      const [banners] = await connection.query("SELECT id, movie_id, (image_data IS NOT NULL) AS has_uploaded_image, OCTET_LENGTH(image_data) AS image_bytes, (image_url IS NOT NULL AND image_url <> '') AS has_image_url, is_active, sort_order FROM site_banners ORDER BY id");
      report.bannerRows = banners;
    }
    return report;
  } finally {
    await connection.end();
  }
}

async function main() {
  const source = configFromUrl("SOURCE_DATABASE_URL", ".db.enzonic.com", 3306);
  const target = configFromUrl("RESTORE_DATABASE_URL", ".tidbcloud.com", 4000);
  if (source.host === target.host && source.database === target.database) {
    throw new Error("Safety stop: source and target resolve to the same database.");
  }
  console.log("[READ-ONLY] Inspecting Enzonic source and TiDB target; no writes will be performed.");
  const [sourceReport, targetReport] = await Promise.all([
    inspect("SOURCE", source),
    inspect("TARGET", target)
  ]);
  console.log(JSON.stringify({ source: sourceReport, target: targetReport }, null, 2));
  console.log("[READ-ONLY] Inventory complete. No rows were modified.");
}

main().catch(error => {
  console.error("[INVENTORY FAILED]", error.message);
  process.exitCode = 1;
});
