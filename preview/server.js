/* NoAdFrame PREVIEW mode: runs the real frontend with demo data. No database, no API keys, no npm install needed.
   Usage: npm run preview  ->  http://localhost:3100 */
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PREVIEW_PORT || 3100;
const PUB = path.join(__dirname, "..", "public"), IMG = path.join(__dirname, "img");

const T = [
  ["tt12299608", "მაიკი 17", "Mickey 17", 2025, "Adventure, Comedy, Sci-Fi", "Bong Joon Ho", "Robert Pattinson, Naomi Ackie, Steven Yeun", "https://archive.org/details/mickey-17-2025-1080p-web-dl-hevc-x-265-5.1-bone-ge-dubbed"],
  ["tt14849194","ჩარჩენილები","The Holdovers",2023,"Comedy, Drama","Alexander Payne","Paul Giamatti, Da'Vine Joy Randolph, Dominic Sessa","https://archive.org/details/the.-holdovers.-2023.1080p.-webrip.-1600-mb.-dd-5.1.x-264-galaxy-rg-ge-dubbed"],
  ["tt0017136", "მეტროპოლისი", "Metropolis", 1927, "Drama, Sci-Fi", "Fritz Lang", "Alfred Abel, Brigitte Helm, Gustav Fröhlich", null],
  ["tt0013442", "ნოსფერატუ", "Nosferatu", 1922, "Fantasy, Horror", "F.W. Murnau", "Max Schreck, Greta Schröder", null],
  ["tt1727587", "სინტელი", "Sintel", 2010, "Animation, Fantasy", "Colin Levy", "Halina Reijn, Thom Hoffman", null],
  ["tt1254207", "დიდი ბაკ ბანი", "Big Buck Bunny", 2008, "Animation, Comedy", "Sacha Goedegebure", "Jan Morgenstern",null],
  ["tt0056923", "შარადა", "Charade", 1963, "Comedy, Crime, Mystery", "Stanley Donen", "Cary Grant, Audrey Hepburn", null],
  ["tt0017925", "გენერალი", "The General", 1926, "Action, Comedy", "Clyde Bruckman, Buster Keaton", "Buster Keaton, Marion Mack", null]
];
const RATING = [6.9, 7.8, 8.3, 7.9, 7.5, 6.4, 7.9, 8.1]; // DEMO placeholders, not real IMDb data
const movies = (host) => T.map((t, i) => ({
  id: i + 1, imdb_id: t[0], title_ka: t[1], title_en: t[2], release_year: t[3], imdb_rating: RATING[i], genre: t[4], director: t[5], actors: t[6],
  poster_url: `http://${host}/preview-img/p${i + 1}.jpg`, backdrop_url: `http://${host}/preview-img/b${i + 1}.jpg`, video_url: t[7], views: 120 - i * 9,
  description: "Demo description for the preview. On the real site this text comes from OMDb."
}));
let comments = [
  { id: 1, movie_id: 1, user_id: 99, author: "nino_k", comment: "Can't wait to watch this one!", created_at: new Date(Date.now() - 3600e3 * 5).toISOString() },
  { id: 2, movie_id: 1, user_id: 98, author: "giorgi", comment: "ტრეილერი ძალიან კარგია.", created_at: new Date(Date.now() - 3600e3 * 30).toISOString() }
];
let nextId = 10;
const me = { id: 1, username: "demo_user", email: "demo@noadframe.local", created_at: new Date().toISOString() };

const json = (res, obj, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise(r => { let b = ""; req.on("data", d => b += d); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };
const badge = `<div style="position:fixed;left:14px;bottom:14px;z-index:99;padding:6px 12px;border-radius:999px;background:#FF8C00;color:#111;font:700 12px sans-serif">PREVIEW MODE · demo data</div>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname, host = req.headers.host, all = movies(host);
  const withCount = (list) => list;
  if (p.startsWith("/preview-img/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return fs.createReadStream(path.join(IMG, path.basename(p))).pipe(res); }
  if (p === "/api/health") return json(res, { status: "preview" });
  if (p === "/api/archive-video") {
    const identifier = u.searchParams.get("identifier") || "";
    if (!/^[a-zA-Z0-9._-]{1,180}$/.test(identifier)) return json(res, { error: "Invalid Archive.org identifier." }, 400);
    try {
      const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
      if (!response.ok) return json(res, { error: "Archive.org metadata could not be loaded." }, 502);
      const metadata = await response.json();
      // Native browser formats only. MKV is deliberately excluded because HTML5 video
  // playback is not consistently supported for Matroska files across browsers.
  const files = (metadata.files || []).filter(f => {
    const name = String(f.name || "");
    const format = String(f.format || "").toLowerCase();
    return name && /\.(mp4|m4v|webm)$/i.test(name) &&
      !name.endsWith("_thumb.jpg") && !name.endsWith("_sample.mp4") &&
      !name.endsWith("_preview.mp4") && !/metadata|thumbnail/.test(format);
  });
      files.sort((a, b) => {
        const score = f => {
      const name = f.name.toLowerCase();
      return (name.includes("ge-dubbed") ? 100 : 0) +
        (name.endsWith(".mp4") ? 30 : name.endsWith(".m4v") ? 20 : 10) +
        (f.source === "original" ? 2 : 0) +
        (Number(f.size) > 0 ? 1 : 0);
    };
        return score(b) - score(a);
      });
      if (!files.length) return json(res, { error: "No browser-compatible MP4, M4V, or WebM video file is available in this Archive.org item." }, 404);
      const name = files[0].name.split("/").map(encodeURIComponent).join("/");
      return json(res, { videoUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${name}` });
    } catch (error) {
      return json(res, { error: "Could not resolve the Archive.org video file." }, 502);
    }
  }
  if (p === "/api/movies/categories") {
    const by = (f) => [...all].sort(f).slice(0, 8);
    const featured = all.filter(m => /mickey\s*17|the holdovers/i.test(m.title_en));
    return json(res, { featured, trending: all.slice(0, 8), popular: by((a, b) => b.views - a.views), topRated: by((a, b) => b.imdb_rating - a.imdb_rating), newReleases: by((a, b) => b.release_year - a.release_year) });
  }
  if (p === "/api/genres") {
    const c = {}; all.forEach(m => m.genre.split(",").forEach(g => { g = g.trim(); c[g] = (c[g] || 0) + 1; }));
    return json(res, { genres: Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)), years: [...new Set(all.map(m => m.release_year))].sort((a, b) => b - a) });
  }
  if (p === "/api/movies") {
    const q = (u.searchParams.get("q") || "").toLowerCase(), g = u.searchParams.get("genre"), y = u.searchParams.get("year"), r = parseFloat(u.searchParams.get("minRating"));
    let list = all.filter(m => (!q || (m.title_en + m.title_ka).toLowerCase().includes(q)) && (!g || m.genre.includes(g)) && (!y || m.release_year == y) && (isNaN(r) || m.imdb_rating >= r));
    const s = u.searchParams.get("sort");
    if (s === "rating") list.sort((a, b) => b.imdb_rating - a.imdb_rating); else if (s === "year") list.sort((a, b) => b.release_year - a.release_year);
    else if (s === "popular") list.sort((a, b) => b.views - a.views); else if (s === "title") list.sort((a, b) => a.title_en.localeCompare(b.title_en));
    return json(res, { movies: list });
  }
  let m = p.match(/^\/api\/movies\/(\d+)$/); if (m) return all[m[1] - 1] ? json(res, { movie: all[m[1] - 1] }) : json(res, { error: "Movie not found." }, 404);
  m = p.match(/^\/api\/movies\/(\d+)\/comments$/);
  if (m && req.method === "GET") { const l = comments.filter(c => c.movie_id == m[1]).sort((a, b) => (u.searchParams.get("sort") === "oldest" ? 1 : -1) * (new Date(a.created_at) - new Date(b.created_at))); return json(res, { comments: l }); }
  if (m && req.method === "POST") { const b = await body(req); comments.push({ id: nextId++, movie_id: +m[1], user_id: me.id, author: me.username, comment: String(b.comment || "").slice(0, 1200), created_at: new Date().toISOString() }); return json(res, { message: "Comment posted." }, 201); }
  m = p.match(/^\/api\/comments\/(\d+)$/); if (m && req.method === "DELETE") { comments = comments.filter(c => !(c.id == m[1] && c.user_id === me.id)); return json(res, { message: "Comment deleted." }); }
  if (p === "/api/auth/login" || p === "/api/auth/register") { const b = await body(req); const user = { ...me, username: b.username || me.username }; return json(res, { token: "preview-token", user }); }
  if (p === "/api/auth/me") return json(res, { user: me, stats: { comments: comments.filter(c => c.user_id === me.id).length }, isAdmin: false, comments: comments.filter(c => c.user_id === me.id).map(c => ({ ...c, title_en: all[c.movie_id - 1].title_en })) });
  if (p === "/api/auth/change-password") return json(res, { message: "Password updated." });
  if (p === "/api/assistant") { await body(req); return json(res, { reply: "Preview mode: the real assistant needs an OpenAI key. In the live version I answer only about NoAdFrame — movies, recommendations, your account and playback problems." }); }
  if (p.startsWith("/api/")) return json(res, { error: "Not available in preview mode." }, 404);
  const file = p === "/" || !fs.existsSync(path.join(PUB, p)) ? "index.html" : p;
  const safe = path.normalize(file).replace(/^(\.\.[\\/])+/, "");
  if (safe.endsWith("index.html")) { res.writeHead(200, { "Content-Type": MIME[".html"] }); return res.end(fs.readFileSync(path.join(PUB, "index.html"), "utf8").replace("</body>", badge + "</body>")); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(safe)] || "application/octet-stream" });
  fs.createReadStream(path.join(PUB, safe)).pipe(res);
}).listen(PORT, () => console.log(`NoAdFrame PREVIEW running on http://localhost:${PORT}  (demo data, no database)`));
