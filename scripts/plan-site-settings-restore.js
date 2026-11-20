"use strict";

// READ-ONLY recovery plan. This script does not create, update, or delete anything.
const mysql = require("mysql2/promise");

function configFromUrl(envName, suffix, port) {
  const raw = process.env[envName];
  if (!raw) throw new Error(`Missing GitHub Actions secret: ${envName}`);
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !url.hostname.endsWith(suffix) || Number(url.port || 3306) !== port) {
    throw new Error(`Safety stop: ${envName} is not an approved database endpoint.`);
  }
  const sslMode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (!["REQUIRED", "VERIFY_IDENTITY"].includes(sslMode)) throw new Error(`Safety stop: TLS is required for ${envName}.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`Missing database name in ${envName}.`);
  return {
    host: url.hostname, port, user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database,
    ssl: { rejectUnauthorized: true }, connectTimeout: 20000,
    supportBigNumbers: true, bigNumberStrings: true, dateStrings: true
  };
}

function collectIds(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, output);
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    output.push(String(value));
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) output.push(trimmed);
    else {
      try { collectIds(JSON.parse(trimmed), output); } catch { /* preserve unparsed source below */ }
    }
  }
  return output;
}

async function tableNames(conn) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  return new Set(rows.map(row => row.name));
}

async function createStatement(conn, table) {
  const [rows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
  return rows[0]?.["Create Table"] || null;
}

async function main() {
  const sourceCfg = configFromUrl("SOURCE_DATABASE_URL", ".db.enzonic.com", 3306);
  const targetCfg = configFromUrl("RESTORE_DATABASE_URL", ".tidbcloud.com", 4000);
  if (sourceCfg.host === targetCfg.host && sourceCfg.database === targetCfg.database) {
    throw new Error("Safety stop: source and target are the same database.");
  }

  const source = await mysql.createConnection(sourceCfg);
  const target = await mysql.createConnection(targetCfg);
  try {
    const [sourceTables, targetTables] = await Promise.all([tableNames(source), tableNames(target)]);
    const required = ["site_banner", "site_banners", "site_home_sections"];
    const missingSource = required.filter(name => !sourceTables.has(name));
    if (missingSource.length) throw new Error(`Source is missing required tables: ${missingSource.join(", ")}`);

    const [bannerRows] = await source.query(
      "SELECT id, legacy_source_id, movie_id, image_url, OCTET_LENGTH(image_data) AS image_bytes, SHA2(image_data, 256) AS image_sha256, mime_type, is_active, sort_order, created_at, updated_at FROM site_banners ORDER BY sort_order, id"
    );
    const [legacyRows] = await source.query(
      "SELECT id, image_url, OCTET_LENGTH(image_data) AS image_bytes, SHA2(image_data, 256) AS image_sha256, mime_type, updated_at FROM site_banner ORDER BY id"
    );
    const [sections] = await source.query(
      "SELECT section_key, movie_ids, updated_at FROM site_home_sections ORDER BY section_key"
    );

    const sectionReport = sections.map(row => ({
      section_key: row.section_key,
      movie_ids_raw: row.movie_ids,
      movie_ids_parsed: (() => { try { return JSON.parse(row.movie_ids); } catch { return null; } })(),
      updated_at: row.updated_at
    }));
    const sourceMovieIds = [...new Set([
      ...bannerRows.map(row => String(row.movie_id)),
      ...sections.flatMap(row => collectIds(row.movie_ids))
    ])];
    const sourceMovies = sourceTables.has("movies")
      ? (await source.query(
          `SELECT id, imdb_id, title_en, title_ka FROM movies WHERE id IN (${sourceMovieIds.map(() => "?").join(",") || "NULL"}) ORDER BY id`,
          sourceMovieIds
        ))[0]
      : [];
    const imdbIds = [...new Set(sourceMovies.map(row => row.imdb_id).filter(Boolean))];
    const targetMovies = targetTables.has("movies") && imdbIds.length
      ? (await target.query(
          `SELECT id, imdb_id, title_en, title_ka FROM movies WHERE imdb_id IN (${imdbIds.map(() => "?").join(",")}) ORDER BY imdb_id`,
          imdbIds
        ))[0]
      : [];

    const sourceDdl = {};
    for (const name of [...required, ...(sourceTables.has("movies") ? ["movies"] : [])]) {
      sourceDdl[name] = await createStatement(source, name);
    }

    const report = {
      mode: "READ_ONLY_DRY_RUN",
      source: {
        database: sourceCfg.database,
        selectedTableRows: { site_banner: legacyRows.length, site_banners: bannerRows.length, site_home_sections: sections.length },
        site_banner: legacyRows,
        site_banners: bannerRows,
        site_home_sections: sectionReport,
        referencedMovies: sourceMovies,
        createTableStatements: sourceDdl
      },
      target: {
        database: targetCfg.database,
        tables: Object.fromEntries([...required, "movies"].map(name => [name, { exists: targetTables.has(name) }])),
        matchingMoviesByImdbId: targetMovies
      },
      dependencyCheck: {
        referencedSourceMovieIds: sourceMovieIds,
        foundSourceMovieIds: sourceMovies.map(row => String(row.id)),
        missingSourceMovieIds: sourceMovieIds.filter(id => !sourceMovies.some(row => String(row.id) === id)),
        missingInTargetImdbIds: imdbIds.filter(id => !targetMovies.some(row => row.imdb_id === id))
      },
      safety: "No writes were performed. Binary image contents were not exported; only byte lengths and SHA-256 hashes were calculated."
    };
    console.log(JSON.stringify(report, null, 2));
    console.log("[READ-ONLY] Recovery dry-run complete. No rows were modified.");
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch(error => {
  console.error("[RECOVERY PLAN FAILED]", error.message);
  process.exitCode = 1;
});
