function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const RIGHTS_BASES = new Set([
  "original",
  "written_permission",
  "public_domain",
  "cc_by_3",
  "cc_by_4",
  "cc_by_sa",
  "commercial_license",
  "official_embed"
]);

const isHttpUrl = (value) => {
  try { return ["http:", "https:"].includes(new URL(String(value)).protocol); } catch { return false; }
};
const clean = (value) => (!value || value === "N/A" ? null : String(value).trim());

function validateRights(asset, url, basis, evidence, licenseUrl) {
  if (!url) return;
  if (!basis || !RIGHTS_BASES.has(basis)) {
    throw httpError(400, `${asset} needs a recognized rights basis before it can be published.`);
  }
  if (!evidence || String(evidence).trim().length < 8) {
    throw httpError(400, `${asset} needs a record of the permission, licence or public-domain research.`);
  }
  if (licenseUrl && !isHttpUrl(licenseUrl)) {
    throw httpError(400, `${asset} license URL must use http or https.`);
  }
  if (basis.startsWith("cc_by") && !licenseUrl) {
    throw httpError(400, `${asset} under a Creative Commons licence needs its license URL.`);
  }
  if (basis === "official_embed" && !licenseUrl) {
    throw httpError(400, `${asset} official embed needs a link to the provider's embedding terms or authorization.`);
  }
}

/* Fetch factual film metadata from OMDb. OMDb's poster and plot are not assumed to be licensed for reuse. */
async function fetchOmdb(imdbId) {
  const key = process.env.OMDB_API_KEY;
  if (!key) throw httpError(503, "OMDb API key is not configured (OMDB_API_KEY).");
  if (!/^tt\\d{6,10}$/.test(imdbId)) throw httpError(400, "Invalid IMDb ID. Example: tt0111161");
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

/*
 * A media URL is stored only together with a declared rights basis and an evidence record.
 * The evidence record may be a public license/source URL or an internal agreement reference.
 * The operator must verify the evidence; this code cannot authenticate a copyright license.
 */
async function upsertMovie(pool, input) {
  const {
    imdbId, titleKa,
    posterUrl, posterRightsBasis, posterRightsEvidence, posterLicenseUrl, posterAttribution,
    backdropUrl, backdropRightsBasis, backdropRightsEvidence, backdropLicenseUrl, backdropAttribution,
    videoUrl, videoRightsBasis, videoRightsEvidence, videoLicenseUrl, videoAttribution,
    description, descriptionRightsBasis, descriptionRightsEvidence
  } = input;

  for (const [label, value] of [["posterUrl", posterUrl], ["backdropUrl", backdropUrl], ["videoUrl", videoUrl]]) {
    if (value && !isHttpUrl(value)) throw httpError(400, `${label} must be an http(s) URL.`);
  }
  validateRights("Poster", posterUrl, posterRightsBasis, posterRightsEvidence, posterLicenseUrl);
  validateRights("Backdrop", backdropUrl, backdropRightsBasis, backdropRightsEvidence, backdropLicenseUrl);
  validateRights("Video", videoUrl, videoRightsBasis, videoRightsEvidence, videoLicenseUrl);
  if (description && (!descriptionRightsBasis || !RIGHTS_BASES.has(descriptionRightsBasis) || !descriptionRightsEvidence)) {
    throw httpError(400, "Description needs an original/permission/license basis and an evidence record.");
  }

  const d = await fetchOmdb(imdbId);
  const year = parseInt(String(d.Year || "").slice(0, 4), 10);
  const rating = parseFloat(d.imdbRating);
  await pool.query(
    `INSERT INTO movies (
       imdb_id, title_en, title_ka, release_year, imdb_rating, genre, director, actors,
       poster_url, backdrop_url, video_url, description,
       poster_rights_basis, poster_rights_evidence, poster_license_url, poster_attribution,
       backdrop_rights_basis, backdrop_rights_evidence, backdrop_license_url, backdrop_attribution,
       video_rights_basis, video_rights_evidence, video_license_url, video_attribution,
       description_rights_basis, description_rights_evidence
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title_en = VALUES(title_en), release_year = VALUES(release_year), imdb_rating = VALUES(imdb_rating),
       genre = VALUES(genre), director = VALUES(director), actors = VALUES(actors),
       title_ka = COALESCE(VALUES(title_ka), title_ka),
       poster_url = COALESCE(VALUES(poster_url), poster_url),
       backdrop_url = COALESCE(VALUES(backdrop_url), backdrop_url),
       video_url = COALESCE(VALUES(video_url), video_url),
       description = COALESCE(VALUES(description), description),
       poster_rights_basis = COALESCE(VALUES(poster_rights_basis), poster_rights_basis),
       poster_rights_evidence = COALESCE(VALUES(poster_rights_evidence), poster_rights_evidence),
       poster_license_url = COALESCE(VALUES(poster_license_url), poster_license_url),
       poster_attribution = COALESCE(VALUES(poster_attribution), poster_attribution),
       backdrop_rights_basis = COALESCE(VALUES(backdrop_rights_basis), backdrop_rights_basis),
       backdrop_rights_evidence = COALESCE(VALUES(backdrop_rights_evidence), backdrop_rights_evidence),
       backdrop_license_url = COALESCE(VALUES(backdrop_license_url), backdrop_license_url),
       backdrop_attribution = COALESCE(VALUES(backdrop_attribution), backdrop_attribution),
       video_rights_basis = COALESCE(VALUES(video_rights_basis), video_rights_basis),
       video_rights_evidence = COALESCE(VALUES(video_rights_evidence), video_rights_evidence),
       video_license_url = COALESCE(VALUES(video_license_url), video_license_url),
       video_attribution = COALESCE(VALUES(video_attribution), video_attribution),
       description_rights_basis = COALESCE(VALUES(description_rights_basis), description_rights_basis),
       description_rights_evidence = COALESCE(VALUES(description_rights_evidence), description_rights_evidence)`,
    [
      d.imdbID, d.Title, titleKa || null, Number.isFinite(year) ? year : null, Number.isFinite(rating) ? rating : null,
      clean(d.Genre), clean(d.Director), clean(d.Actors),
      posterUrl || null, backdropUrl || null, videoUrl || null, clean(description),
      posterRightsBasis || null, posterRightsEvidence || null, posterLicenseUrl || null, clean(posterAttribution),
      backdropRightsBasis || null, backdropRightsEvidence || null, backdropLicenseUrl || null, clean(backdropAttribution),
      videoRightsBasis || null, videoRightsEvidence || null, videoLicenseUrl || null, clean(videoAttribution),
      descriptionRightsBasis || null, descriptionRightsEvidence || null
    ]
  );
  const [rows] = await pool.query("SELECT * FROM movies WHERE imdb_id = ?", [d.imdbID]);
  return rows[0];
}

module.exports = { httpError, isHttpUrl, upsertMovie, RIGHTS_BASES };
