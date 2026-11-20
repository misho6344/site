"use strict";

// Selective guarded restore: referenced movies and homepage banner data only.
// Excludes users, passwords, comments, AI feedback, and admin security events.
const mysql = require("mysql2/promise");
const TABLES = ["movies", "site_banner", "site_banners", "site_home_sections"];
const REQUIRED_CONFIRMATION = "RESTORE_SITE_SETTINGS_TO_TIDB";

function configFromUrl(envName, suffix, port) {
  const raw = process.env[envName];
  if (!raw) throw new Error("Missing GitHub Actions secret: " + envName);
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !url.hostname.endsWith(suffix) || Number(url.port || 3306) !== port) {
    throw new Error("Safety stop: " + envName + " is not an approved database endpoint.");
  }
  const sslMode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (!["REQUIRED", "VERIFY_IDENTITY"].includes(sslMode)) throw new Error("Safety stop: TLS is required for " + envName + ".");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("Missing database name in " + envName + ".");
  return {
    host: url.hostname, port, user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database,
    ssl: { rejectUnauthorized: true }, connectTimeout: 20000,
    supportBigNumbers: true, bigNumberStrings: true, dateStrings: true
  };
}

function quoteId(value) {
  const tick = String.fromCharCode(96);
  return tick + String(value).replaceAll(tick, tick + tick) + tick;
}

function normalize(value) {
  if (Buffer.isBuffer(value)) return { __buffer_base64: value.toString("base64") };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}

function idsFromSection(raw, sectionKey) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Safety stop: section " + sectionKey + " has invalid movie_ids JSON."); }
  if (!Array.isArray(parsed) || parsed.some(id => !(Number.isSafeInteger(id) && id > 0))) {
    throw new Error("Safety stop: section " + sectionKey + " movie_ids must be an array of positive integer IDs.");
  }
  return parsed.map(String);
}

async function tableNames(conn) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  return new Set(rows.map(row => row.name));
}

async function sourceRows(conn, table, where = "", params = []) {
  const order = table === "site_home_sections" ? "section_key" : "id";
  const [rows] = await conn.query("SELECT * FROM " + quoteId(table) + " " + where + " ORDER BY " + order, params);
  return rows;
}

async function insertRows(conn, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const sql = "INSERT INTO " + quoteId(table) + " (" + columns.map(quoteId).join(",") +
    ") VALUES (" + columns.map(() => "?").join(",") + ")";
  for (const row of rows) await conn.query(sql, columns.map(column => row[column]));
}

async function assertSameRows(source, target, table, sourceData) {
  let targetData;
  if (table === "movies") {
    const ids = sourceData.map(row => String(row.id));
    const where = "WHERE id IN (" + (ids.map(() => "?").join(",") || "NULL") + ")";
    targetData = await sourceRows(target, table, where, ids);
  } else {
    targetData = await sourceRows(target, table);
  }
  if (JSON.stringify(normalize(sourceData)) !== JSON.stringify(normalize(targetData))) {
    throw new Error("Verification failed: " + table + " rows differ after restore.");
  }
}

async function main() {
  if (process.env.CONFIRM_RESTORE !== REQUIRED_CONFIRMATION) {
    throw new Error("Safety stop: set CONFIRM_RESTORE exactly to " + REQUIRED_CONFIRMATION + " to authorize writes.");
  }
  const sourceCfg = configFromUrl("SOURCE_DATABASE_URL", ".db.enzonic.com", 3306);
  const targetCfg = configFromUrl("RESTORE_DATABASE_URL", ".tidbcloud.com", 4000);
  if (sourceCfg.host === targetCfg.host && sourceCfg.database === targetCfg.database) {
    throw new Error("Safety stop: source and target are the same database.");
  }

  const source = await mysql.createConnection(sourceCfg);
  const target = await mysql.createConnection(targetCfg);
  let createdTables = [];
  let transactionStarted = false;
  try {
    const [sourceTables, targetTables] = await Promise.all([tableNames(source), tableNames(target)]);
    for (const table of TABLES) {
      if (!sourceTables.has(table)) throw new Error("Source is missing required table: " + table);
      if (targetTables.has(table)) throw new Error("Safety stop: target table " + table + " already exists. No overwrite is allowed.");
    }

    const [bannerRows] = await source.query("SELECT id, movie_id FROM site_banners ORDER BY id");
    const [sections] = await source.query("SELECT section_key, movie_ids FROM site_home_sections ORDER BY section_key");
    const referencedIds = new Set(bannerRows.filter(row => row.movie_id !== null).map(row => String(row.movie_id)));
    for (const section of sections) {
      for (const id of idsFromSection(section.movie_ids, section.section_key)) referencedIds.add(id);
    }
    if (!referencedIds.size) throw new Error("Safety stop: no referenced movies were found.");

    const movieIdList = [...referencedIds];
    const movieRows = await sourceRows(
      source, "movies",
      "WHERE id IN (" + movieIdList.map(() => "?").join(",") + ")",
      movieIdList
    );
    const foundIds = new Set(movieRows.map(row => String(row.id)));
    const missingIds = movieIdList.filter(id => !foundIds.has(id));
    if (missingIds.length) throw new Error("Safety stop: source is missing referenced movie IDs: " + missingIds.join(", "));

    const data = {
      movies: movieRows,
      site_banner: await sourceRows(source, "site_banner"),
      site_banners: await sourceRows(source, "site_banners"),
      site_home_sections: await sourceRows(source, "site_home_sections")
    };
    const ddl = {};
    for (const table of TABLES) {
      const [rows] = await source.query("SHOW CREATE TABLE " + quoteId(table));
      ddl[table] = rows[0] && rows[0]["Create Table"];
      if (!ddl[table]) throw new Error("Could not read source DDL for " + table + ".");
    }

    console.log("[RESTORE] Preflight passed. Creating only the four approved tables.");
    for (const table of TABLES) {
      const compatibleDdl = ddl[table].replace(/utf8mb4_0900_ai_ci/g, "utf8mb4_unicode_ci");
      await target.query(compatibleDdl);
      createdTables.push(table);
    }

    await target.beginTransaction();
    transactionStarted = true;
    for (const table of TABLES) await insertRows(target, table, data[table]);
    for (const table of TABLES) await assertSameRows(source, target, table, data[table]);
    await target.commit();
    transactionStarted = false;

    console.log(JSON.stringify({
      status: "RESTORED_AND_VERIFIED",
      sourceDatabase: sourceCfg.database,
      targetDatabase: targetCfg.database,
      copiedRows: Object.fromEntries(TABLES.map(table => [table, data[table].length])),
      copiedBannerImages: {
        site_banner: data.site_banner.filter(row => row.image_data).length,
        site_banners: data.site_banners.filter(row => row.image_data).length
      },
      copiedMovieIds: movieRows.map(row => String(row.id)),
      verification: "All copied rows compared source-to-target, including binary image contents.",
      excluded: ["users", "comments", "ai_feedback", "admin_security_events"],
      productionCutover: "NOT PERFORMED"
    }, null, 2));
  } catch (error) {
    if (transactionStarted) {
      try { await target.rollback(); } catch {}
      transactionStarted = false;
    }
    for (const table of [...createdTables].reverse()) {
      try {
        const [[count]] = await target.query("SELECT COUNT(*) AS count FROM " + quoteId(table));
        if (String(count.count) === "0") await target.query("DROP TABLE " + quoteId(table));
      } catch {}
    }
    throw error;
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch(error => {
  console.error("[RESTORE FAILED]", error.message);
  process.exitCode = 1;
});
