"use strict";

// READ-ONLY full inventory of Enzonic (source) and TiDB Cloud (target).
// No application rows, schema objects, or database settings are modified.

require("dotenv").config();
const mysql = require("mysql2/promise");

function parseConfig(envName, expectedHostSuffix, expectedPort) {
  const raw = process.env[envName];
  if (!raw) throw new Error(`Missing required environment variable: ${envName}`);

  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error(`${envName} must use mysql://`);
  if (!url.hostname.endsWith(expectedHostSuffix)) {
    throw new Error(`Safety stop: ${envName} must point to ${expectedHostSuffix}`);
  }
  if (Number(url.port || 3306) !== expectedPort) {
    throw new Error(`Safety stop: unexpected port in ${envName}`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\\//, ""));
  if (!database) throw new Error(`${envName} must include a database name`);

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

async function inspect(label, config) {
  const connection = await mysql.createConnection(config);
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const [tables] = await connection.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY TABLE_NAME`
    );
    const [views] = await connection.query(
      `SELECT TABLE_NAME AS name
       FROM information_schema.views
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME`
    );
    const [triggers] = await connection.query(
      `SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName,
              EVENT_MANIPULATION AS event, ACTION_TIMING AS timing
       FROM information_schema.triggers
       WHERE TRIGGER_SCHEMA = DATABASE()
       ORDER BY TRIGGER_NAME`
    );
    const [routines] = await connection.query(
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM information_schema.routines
       WHERE ROUTINE_SCHEMA = DATABASE()
       ORDER BY ROUTINE_NAME`
    );
    const [events] = await connection.query(
      `SELECT EVENT_NAME AS name, STATUS AS status
       FROM information_schema.events
       WHERE EVENT_SCHEMA = DATABASE()
       ORDER BY EVENT_NAME`
    );

    const report = {
      database: config.database,
      tableCount: tables.filter(t => t.type === "BASE TABLE").length,
      viewCount: views.length,
      triggerCount: triggers.length,
      routineCount: routines.length,
      eventCount: events.length,
      tables: [],
      views: views.map(v => v.name),
      triggers,
      routines,
      events
    };

    for (const table of tables.filter(t => t.type === "BASE TABLE")) {
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, ORDINAL_POSITION AS position
         FROM information_schema.columns
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [table.name]
      );
      const [indexes] = await connection.query(
        `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
                SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName
         FROM information_schema.statistics
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [table.name]
      );
      const [foreignKeys] = await connection.query(
        `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
                REFERENCED_TABLE_NAME AS referencedTable,
                REFERENCED_COLUMN_NAME AS referencedColumn
         FROM information_schema.key_column_usage
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
           AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
        [table.name]
      );

      const [[countRow]] = await connection.query(
        `SELECT COUNT(*) AS rowCount FROM ${mysql.escapeId(table.name)}`
      );
      report.tables.push({
        name: table.name,
        engine: table.engine,
        rowCount: String(countRow.rowCount),
        primaryKey: indexes.filter(i => i.name === "PRIMARY").map(i => i.columnName),
        columns,
        indexes,
        foreignKeys
      });
    }

    return report;
  } finally {
    try { await connection.query("ROLLBACK"); } catch {}
    await connection.end();
  }
}

async function main() {
  const sourceConfig = parseConfig("SOURCE_DATABASE_URL", ".db.enzonic.com", 3306);
  const targetConfig = parseConfig("RESTORE_DATABASE_URL", ".tidbcloud.com", 4000);

  if (sourceConfig.host === targetConfig.host &&
      sourceConfig.port === targetConfig.port &&
      sourceConfig.database === targetConfig.database) {
    throw new Error("Safety stop: source and target resolve to the same database");
  }

  console.log("[READ-ONLY] Full database inventory starting.");
  const [source, target] = await Promise.all([
    inspect("ENZONIC", sourceConfig),
    inspect("TIDB", targetConfig)
  ]);

  const sourceNames = new Set(source.tables.map(t => t.name));
  const targetNames = new Set(target.tables.map(t => t.name));
  const onlySource = [...sourceNames].filter(name => !targetNames.has(name)).sort();
  const onlyTarget = [...targetNames].filter(name => !sourceNames.has(name)).sort();

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    source: { ...source, host: sourceConfig.host },
    target: { ...target, host: targetConfig.host },
    comparison: { tablesOnlyOnEnzonic: onlySource, tablesOnlyOnTiDB: onlyTarget }
  }, null, 2));
  console.log("[READ-ONLY] Inventory complete. No database changes were made.");
}

main().catch(error => {
  console.error("[READ-ONLY INVENTORY FAILED]", error.message);
  process.exitCode = 1;
});
