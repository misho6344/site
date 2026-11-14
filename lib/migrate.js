/* Upgrades tables created by the original starter project (old column names) to the NoAdFrame schema.
   Safe to run on every start: each step only runs if the old column exists / the new one is missing. */
async function hasColumn(pool, table, column) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return rows.length > 0;
}

async function migrateLegacy(pool) {
  const renames = [
    ["users", "name", "username", "`username` VARCHAR(80) NOT NULL"],
    ["users", "password_hash", "password", "`password` VARCHAR(255) NOT NULL"],
    ["movies", "synopsis", "description", "`description` TEXT NULL"],
    ["movies", "ai_art_url", "poster_url", "`poster_url` TEXT NULL"],
    ["comments", "body", "comment", "`comment` VARCHAR(1200) NOT NULL"]
  ];
  for (const [table, oldCol, newCol, definition] of renames) {
    if ((await hasColumn(pool, table, oldCol)) && !(await hasColumn(pool, table, newCol))) {
      await pool.query(`ALTER TABLE \`${table}\` CHANGE \`${oldCol}\` ${definition}`);
    }
  }
  const additions = [
    ["movies", "release_year", "SMALLINT UNSIGNED NULL"],
    ["movies", "backdrop_url", "TEXT NULL"],
    ["movies", "views", "INT UNSIGNED NOT NULL DEFAULT 0"]
  ];
  for (const [table, column, definition] of additions) {
    if (!(await hasColumn(pool, table, column))) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
  if (await hasColumn(pool, "movies", "year")) {
    await pool.query("UPDATE movies SET release_year = CAST(LEFT(`year`, 4) AS UNSIGNED) WHERE release_year IS NULL AND `year` REGEXP '^[0-9]{4}'");
  }
  const [col] = await pool.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'movies' AND column_name = 'title_ka'"
  );
  if (col.length && col[0].is_nullable === "NO") await pool.query("ALTER TABLE movies MODIFY title_ka VARCHAR(255) NULL");
}

module.exports = { migrateLegacy };
