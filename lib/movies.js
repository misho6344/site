function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const isHttpUrl = (value) => {
  try { return ["http:", "https:"].includes(new URL(String(value)).protocol); } catch { return false; }
};
const clean = (value) => (!value || value === "N/A" ? null : String(value));

/* Fetches real metadata (incl. the real IMDb rating) from OMDb. Nothing is invented here. */
async function fetchOmdb(imdbId) {
  const key = process.env.OMDB_API_KEY;
  if (!key) throw httpError(503, "OMDb API key is not configured (OMDB_API_KEY).");
  if (!/^tt\d{6,10}$/.test(imdbId)) throw httpError(400, "Invalid IMDb ID. Example: tt0111161");
  const url = new URL("https://www.omdbapi.com/");
  url.search = new URLSearchParams({ i: imdbId, plot: "short", apikey: key }).toString();
  let data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    data = await response.json();
  } catch {
    throw httpError(502, "Could not reach OMDb. Try again later.");
  }
  if (data.Response === "False") throw httpError(404, data.Error || "IMDb title not found.");
  return data;
}

/* Insert or update a movie from OMDb. Optional fields only overwrite stored values when provided. */
async function upsertMovie(pool, { imdbId, titleKa, posterUrl, backdropUrl, videoUrl }) {
  for (const [label, value] of [["posterUrl", posterUrl], ["backdropUrl", backdropUrl], ["videoUrl", videoUrl]]) {
    if (value && !isHttpUrl(value)) throw httpError(400, `${label} must be an http(s) URL.`);
  }
  const d = await fetchOmdb(imdbId);
  const year = parseInt(String(d.Year || "").slice(0, 4), 10);
  const rating = parseFloat(d.imdbRating);
  await pool.query(
    `INSERT INTO movies (imdb_id, title_en, title_ka, release_year, imdb_rating, genre, director, actors, poster_url, backdrop_url, video_url, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title_en = VALUES(title_en), release_year = VALUES(release_year), imdb_rating = VALUES(imdb_rating),
       genre = VALUES(genre), director = VALUES(director), actors = VALUES(actors), description = VALUES(description),
       title_ka = COALESCE(VALUES(title_ka), title_ka), poster_url = COALESCE(VALUES(poster_url), poster_url),
       backdrop_url = COALESCE(VALUES(backdrop_url), backdrop_url), video_url = COALESCE(VALUES(video_url), video_url)`,
    [
      d.imdbID, d.Title, titleKa || null, Number.isFinite(year) ? year : null, Number.isFinite(rating) ? rating : null,
      clean(d.Genre), clean(d.Director), clean(d.Actors),
      posterUrl || clean(d.Poster), backdropUrl || null, videoUrl || null, clean(d.Plot)
    ]
  );
  const [rows] = await pool.query("SELECT * FROM movies WHERE imdb_id = ?", [d.imdbID]);
  return rows[0];
}

module.exports = { httpError, isHttpUrl, upsertMovie };
