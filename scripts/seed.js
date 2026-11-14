/* Imports the titles from seed/movies.json using real OMDb data. Usage: npm run seed */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createPool, initSchema } = require("../lib/db");
const { upsertMovie } = require("../lib/movies");

(async () => {
  const pool = createPool();
  await initSchema(pool);
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "movies.json"), "utf8"));
  for (const item of list) {
    try {
      const movie = await upsertMovie(pool, item);
      console.log(`OK   ${movie.imdb_id}  ${movie.title_en} (${movie.release_year}) IMDb ${movie.imdb_rating ?? "N/A"}`);
    } catch (error) {
      console.error(`FAIL ${item.imdbId}: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  await pool.end();
})();
