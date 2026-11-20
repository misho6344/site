"use strict";

// READ-ONLY full database inventory for migration planning.
// Does not read application row contents and never creates, updates, or deletes data.
const mysql = require("mysql2/promise");

function connectionConfig(envName, allowedHostSuffix, expectedPort) {
  const raw = process.env[envName];
  if (!raw) throw new Error("Missing required environment variable: " + envName);
  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error(envName + " must use mysql://");
  if (!url.hostname.endsWith(allowedHostSuffix)) {
    throw new Error("Safety stop: " + envName + " is not an approved database host.");
  }
  if (Number(url.port || 3306) !== expectedPort) {
    throw new Error("Safety stop: unexpected port in " + envName + ".");
  }
  const sslMode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (!["REQUIRED", "VERIFY_IDENTITY"].includes(sslMode)) {
    throw new Error("Safety stop: TLS must be required for " + envName + ".");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(envName + " must include a database name.");
  return {
    host: url.hostname,
    port: expectedPort,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 20000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true
  };
}

function quoteId(value) {
  return "`" + String(value).replaceAll("`", "``") + "`";
}

async function inspect(label, config) {
  const db = await mysql.createConnection(config);
  try {
    const [tables] = await db.query(
      "SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS estimatedRows, TABLE_TYPE AS type " +
      "FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_TYPE, TABLE_NAME"
    );
    const [views] = await db.query(
      "SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition " +
      "FROM information_schema.views WHERE table_schema = DATABASE() ORDER BY TABLE_NAME"
    );
    const [triggers] = await db.query(
      "SELECT TRIGGER_NAME AS name, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS tableName, ACTION_TIMING AS timing " +
      "FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME"
    );
    const [foreignKeys] = await db.query(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName, " +
      "REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn " +
      "FROM information_schema.key_column_usage WHERE table_schema = DATABASE() " +
      "AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION"
    );
    const report = {
      label,
      database: config.database,
      tableCount: tables.filter(t => t.type === "BASE TABLE").length,
      viewCount: views.length,
      triggerCount: triggers.length,
      tables: [],
      views: views.map(v => ({ name: v.name, hasDefinition: Boolean(v.definition) })),
      triggers,
      foreignKeys
    };

    for (const item of tables) {
      if (item.type !== "BASE TABLE") continue;
      const table = item.name;
      const [countRows] = await db.query("SELECT COUNT(*) AS rowCount FROM " + quoteId(table));
      const [columns] = await db.query(
        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, " +
        "COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, ORDINAL_POSITION AS position " +
        "FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
        [table]
      );
      const [indexes] = await db.query(
        "SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, " +
        "COLUMN_NAME AS columnName, SUB_PART AS prefixLength " +
        "FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? " +
        "ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        [table]
      );
      report.tables.push({
        name: table,
        engine: item.engine,
        rowCount: String(countRows[0].rowCount),
        columns,
        indexes
      });
    }
    return report;
  } finally {
    await db.end();
  }
}

async function main() {
  const sourceConfig = connectionConfig("SOURCE_DATABASE_URL", ".db.enzonic.com", 3306);
  const targetConfig = connectionConfig("RESTORE_DATABASE_URL", ".tidbcloud.com", 4000);
  if (sourceConfig.host === targetConfig.host &&
      sourceConfig.port === targetConfig.port &&
      sourceConfig.database === targetConfig.database) {
    throw new Error("Safety stop: source and target resolve to the same database.");
  }
  console.log("[READ-ONLY] Full inventory starting. No application records will be read or changed.");
  const [source, target] = await Promise.all([
    inspect("ENZONIC_SOURCE", sourceConfig),
    inspect("TIDB_TARGET", targetConfig)
  ]);
  console.log(JSON.stringify({ source, target }, null, 2));
  console.log("[READ-ONLY] Inventory completed. No rows or schema objects were modified.");
}

main().catch(error => {
  console.error("[INVENTORY FAILED]", error.message);
  process.exitCode = 1;
});
