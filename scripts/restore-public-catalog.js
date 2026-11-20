"use strict";

// Rebuild only the public movie catalogue from the repository's reviewed seed list.
// This script is intentionally restricted to TiDB Cloud and never deletes or overwrites
// existing movie rows. It cannot recover private users, password hashes, comments or logs.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { upsertMovie } = require("../lib/movies");

function getTargetConfig() {
  const raw = process.env.RESTORE_DATABASE_URL;
  if (!raw) throw new Error("Set RESTORE_DATABASE_URL to the NEW TiDB database. Production DATABASE_URL is not used.");
  const url = new URL(raw);
  if (!["mysql:", "mysql2:"].includes(url.protocol)) throw new Error("RESTORE_DATABASE_URL must use mysql://.");
  if (!url.hostname.endsWith("tidbcloud.com") || Number(url.port || 3306) !== 4000) {
    throw new Error("Safety stop: restore target must be a TiDB Cloud endpoint on port 4000.");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== "noadframe") throw new Error("Safety stop: expected the dedicated TiDB database named noadframe.");
  return {
    uri: raw,
    ssl: {},
    connectTimeout: 20000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true
  };
}

async function main() {
  if (!process.env.OMDB_API_KEY) throw new Error("OMDB_API_KEY is required to fetch factual movie metadata.");
  const connection = await mysql.createConnection(getTargetConfig());
  let added = 0;
  let skipped = 0;
  let failed = 0;
  try {
    const schema = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
    for (const statement of schema.split(";").map(s => s.trim()).filter(Boolean)) { {
      await connection.query(statement); // CREATE TABLE IF NOT EXISTS only; no DROP/TRUNCATE.
    }

    const items = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "movies.json"), "utf8"));
    console.log("[RESTORE] Connected to TiDB. Existing rows will be preserved.");
    for (const item of items) {
      try {
        const [existing] = await connection.query("SELECT id FROM movies WHERE imdb_id = ? LIMIT 1", [item.imdbId]);
        if (existing.length) {
          skipped += 1;
          console.log("[SKIP] Existing movie preserved: " + item.imdbId);
          continue;
        }
        // Do not restore unverified third-party video links. Only metadata/title data is rebuilt.
        const safeItem = {
          imdbId: item.imdbId,
          titleKa: item.titleKa || null,
          description: item.description || null,
          videoUrl: null,
          videoType: "movie"
        };
        const movie = await upsertMovie({ query: connection.query.bind(connection) }, safeItem);
        added += 1;
        console.log("[ADDED] " + movie.imdb_id + " — " + movie.title_en);
      } catch (error) {
        failed += 1;
        console.error("[FAILED] " + item.imdbId + ": " + error.message);
      }
    }
  } finally {
    await connection.end();
  }
  console.log(JSON.stringify({ added, skipped, failed, source: "repository seed/movies.json", target: "TiDB Cloud / noadframe" }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error("[RESTORE] Stopped safely:", error.message);
  process.exitCode = 1;
});
