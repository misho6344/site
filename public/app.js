"use strict";
try {
  localStorage.removeItem("noadframe_token");
  localStorage.removeItem("noadframe_user");
} catch { /* Storage may be disabled; cookie authentication does not depend on it. */ }
const state = {
  user: null,
  filters: { q: "", genre: "", year: "", minRating: "", sort: "newest" },
  page: 1,
  totalPages: 0,
  chat: []
};

const $ = (id) => document.getElementById(id);
const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const csrf = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith("noadframe_csrf="));
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(String(options.method || "GET").toUpperCase())) headers["X-CSRF-Token"] = decodeURIComponent(csrf.slice("noadframe_csrf=".length));
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.includes("/auth/login") && !url.includes("/auth/register")) {
    setSession(null);
    if (document.querySelector('[data-view="movie"]:not([hidden])') || document.querySelector('[data-view="profile"]:not([hidden])')) route();
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ---------- session ---------- */
function setSession(user = null) {
  state.user = user;
  renderAuth();
}
async function restoreSession() {
  try { const data = await api("/api/auth/me"); setSession(data.user); }
  catch { setSession(null); }
}
function renderAuth() {
  $("guestActions").hidden = !!state.user;
  $("userActions").hidden = !state.user;
  if (state.user) $("profileLink").textContent = state.user.username;
}

/* ---------- card helpers ---------- */
function imdbBadge(m) {
  return m.imdb_rating != null ? `<span class="imdb">IMDb ${Number(m.imdb_rating).toFixed(1)}</span>` : `<span class="imdb none">IMDb N/A</span>`;
}
function posterImg(m) {
  const url = safeUrl(m.poster_url);
  return url
    ? `<img src="${esc(url)}" alt="Poster of ${esc(m.title_en)}" loading="lazy" data-fallback>`
    : `<div class="poster-fallback"><img src="/assets/logo.png" alt=""></div>`;
}
function cardHTML(m) {
  return `<a class="card" href="#/movie/${m.id}" aria-label="${esc(m.title_en)}">
    <div class="poster">${posterImg(m)}${imdbBadge(m)}<div class="play"><span>▶</span></div></div>
    <h3>${esc(m.title_en)}</h3>
    <div class="ka">${esc(m.title_ka || "")}</div>
    <div class="year">${esc(m.release_year || "—")}</div>
  </a>`;
}
document.addEventListener("error", (e) => {
  if (e.target.tagName === "IMG" && e.target.hasAttribute("data-fallback")) {
    e.target.removeAttribute("data-fallback");
    e.target.src = "/assets/logo.png";
    e.target.style.cssText = "width:50%;height:auto;opacity:.5;margin:auto";
    e.target.parentElement.style.display = "grid";
    e.target.parentElement.style.placeItems = "center";
  }
}, true);

/* ---------- home ---------- */
async function showHome() {
  $("hero").innerHTML = ""; $("homeRows").innerHTML = "";
  try {
    const data = await api("/api/movies/categories");
    const all = [...(data.featured || []), ...data.topRated, ...data.newReleases, ...data.popular];
    const featuredPool = [...(data.featured || []), ...all];
    const mickey = featuredPool.find(m => /mickey\s*17/i.test(m.title_en || ""));
    const holdovers = featuredPool.find(m => /the holdovers/i.test(m.title_en || ""));
    const featured = [mickey, holdovers].filter((movie, index, list) => movie && list.findIndex(x => x && x.id === movie.id) === index);
    const banners = featured.length ? featured : [all.find(m => safeUrl(m.backdrop_url)) || data.topRated[0] || all[0]].filter(Boolean);
    $("hero").innerHTML = banners.length ? heroHTML(banners) : heroEmptyHTML();
    const heroCarousel = $("hero").querySelector("[data-hero-carousel]");
    if (heroCarousel) heroCarousel.addEventListener("click", (event) => {
      const dot = event.target.closest("[data-hero-index]");
      if (!dot) return;
      const index = Number(dot.dataset.heroIndex);
      heroCarousel.querySelectorAll(".hero-slide").forEach((slide, i) => slide.classList.toggle("active", i === index));
      heroCarousel.querySelectorAll(".hero-dot").forEach((button, i) => button.classList.toggle("active", i === index));
    });
    const rows = [["Popular Movies", data.popular, "popular"], ["Top Rated", data.topRated, "rating"], ["New Releases", data.newReleases, "year"]];
    $("homeRows").innerHTML = rows.filter(r => r[1].length).map(([title, list, sort]) => `
      <section class="row"><div class="row-head"><h2>${title}</h2><a href="#/movies" data-sort="${sort}">See all</a></div>
      <div class="row-track">${list.map(cardHTML).join("")}</div></section>`).join("");
  } catch (error) {
    $("hero").innerHTML = heroEmptyHTML();
    $("homeRows").innerHTML = `<div class="page"><div class="state">${esc(error.message)}</div></div>`;
  }
}
function heroHTML(movies) {
  const list = Array.isArray(movies) ? movies : [movies];
  if (list.length === 1) return heroSlideHTML(list[0]);
  return `<div class="hero-carousel" data-hero-carousel>
    <div class="hero-carousel-slides">${list.map((movie, index) => heroSlideHTML(movie, index === 0)).join("")}</div>
    <div class="hero-carousel-dots" aria-label="Featured movies">${list.map((movie, index) => `<button class="hero-dot${index === 0 ? " active" : ""}" type="button" data-hero-index="${index}" aria-label="Show ${esc(movie.title_en)}"></button>`).join("")}</div>
  </div>`;
}
function heroSlideHTML(m, active = true) {
  // These two films use locally hosted AI-generated banner artwork.
  const title = String(m.title_en || "");
  const aiBanner = /mickey\s*17/i.test(title)
    ? "/assets/hero-mickey17-ai.jpg"
    : (/the holdovers/i.test(title) ? "/assets/hero-holdovers-ai.jpg" : "");
  const bg = aiBanner || safeUrl(m.backdrop_url) || safeUrl(m.poster_url);
  return `<section class="hero hero-slide${active ? " active" : ""}">
    ${bg ? `<img class="hero-bg" src="${esc(bg)}" alt="" data-hero>` : ""}
    <div class="hero-copy">
      <span class="hero-tag">Featured</span>
      <h1>${esc(m.title_ka || m.title_en)}</h1>
      ${m.title_ka ? `<div class="en">${esc(m.title_en)}</div>` : ""}
      <div class="hero-meta">${imdbBadge(m)}<span class="pill">${esc(m.release_year || "—")}</span>${String(m.genre || "").split(",").slice(0, 3).map(g => `<span class="pill">${esc(g.trim())}</span>`).filter(() => m.genre).join("")}</div>
      <p>${esc(m.description || "")}</p>
      <div class="hero-actions"><a class="btn solid" href="#/movie/${m.id}/play">${m.video_type === "trailer" && safeUrl(m.video_url) ? "▶ Watch Trailer" : "▶ Watch Movie"}</a><a class="btn ghost" href="#/movie/${m.id}">Details</a></div>
    </div></section>`;
}

function heroEmptyHTML() {
  return `<section class="hero hero-empty"><img class="big" src="/assets/logo.png" alt="">
    <div class="hero-copy"><span class="hero-tag">Welcome</span><h1>Watch. Enjoy.<br><span class="grad">No Ads.</span></h1>
    <p>The collection is being prepared. Add movies with the seed script or the admin API, then they appear here.</p>
    <div class="hero-actions"><a class="btn solid" href="#/about">About NoAdFrame</a></div></div></section>`;
}

/* ---------- movies catalog ---------- */
let catalogTimer;
async function showMovies() {
  await loadFacets();
  $("fGenre").value = state.filters.genre; $("fYear").value = state.filters.year;
  $("fRating").value = state.filters.minRating; $("fSort").value = state.filters.sort;
  $("searchInput").value = state.filters.q;
  await loadCatalog();
}
let facetsLoaded = false;
async function loadFacets() {
  if (facetsLoaded) return;
  try {
    const { genres, years } = await api("/api/genres");
    $("fGenre").innerHTML = `<option value="">All genres</option>` + genres.map(g => `<option>${esc(g.name)}</option>`).join("");
    $("fYear").innerHTML = `<option value="">Any year</option>` + years.map(y => `<option>${y}</option>`).join("");
    facetsLoaded = true;
  } catch { /* filters just stay minimal */ }
}
async function loadCatalog() {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) if (v) params.set(k, v);
  params.set("page", String(state.page)); params.set("limit", "24");
  $("movieGrid").innerHTML = `<div class="state">Loading...</div>`;
  try {
    const data = await api(`/api/movies?${params}`);
    state.page = data.page; state.totalPages = data.totalPages;
    $("movieCount").textContent = `${data.total} movie${data.total === 1 ? "" : "s"}`;
    $("movieGrid").innerHTML = data.movies.length ? data.movies.map(cardHTML).join("") : `<div class="state">No movies match your search.</div>`;
    renderPagination();
  } catch (error) {
    $("movieGrid").innerHTML = `<div class="state">${esc(error.message)}</div>`;
    $("pagination").innerHTML = "";
  }
}
function renderPagination() {
  const root = $("pagination");
  if (!root || state.totalPages <= 1) { if (root) root.innerHTML = ""; return; }
  const pages = new Set([1, state.totalPages]);
  for (let n = Math.max(1, state.page - 2); n <= Math.min(state.totalPages, state.page + 2); n++) pages.add(n);
  const ordered = [...pages].sort((x, y) => x - y);
  let previous = 0;
  const buttons = ordered.map(n => {
    const gap = previous && n - previous > 1 ? `<span class="page-gap">…</span>` : "";
    previous = n;
    return `${gap}<button type="button" class="page-number${n === state.page ? " active" : ""}" data-page="${n}" ${n === state.page ? 'aria-current="page"' : ""}>${n}</button>`;
  }).join("");
  root.innerHTML = `<button type="button" class="btn ghost small" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>Previous</button>${buttons}<button type="button" class="btn ghost small" data-page="${state.page + 1}" ${state.page >= state.totalPages ? "disabled" : ""}>Next</button>`;
}
$("pagination").addEventListener("click", e => {
  const button = e.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  loadCatalog();
});
function applyFilters(partial, { navigate = true } = {}) {
  Object.assign(state.filters, partial);
  state.page = 1;
  if (navigate && location.hash !== "#/movies") location.hash = "#/movies";
  else if (!document.querySelector('[data-view="movies"]').hidden) { $("searchInput").value = state.filters.q; loadCatalog(); }
}
$("filters").addEventListener("change", () => applyFilters({ genre: $("fGenre").value, year: $("fYear").value, minRating: $("fRating").value, sort: $("fSort").value }, { navigate: false }));
$("fReset").addEventListener("click", () => {
  state.filters = { q: "", genre: "", year: "", minRating: "", sort: "newest" };
  state.page = 1;
  showMovies();
});
$("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const query = $("searchInput").value.trim();
  $("searchForm").classList.remove("is-open");
  applyFilters({ q: query });
});
$("searchForm").addEventListener("click", e => {
  if (!window.matchMedia("(max-width: 700px)").matches || $("searchForm").classList.contains("is-open")) return;
  e.preventDefault();
  $("searchForm").classList.add("is-open");
  $("searchInput").focus({ preventScroll: true });
});
document.addEventListener("click", e => {
  if (window.matchMedia("(max-width: 700px)").matches && !$("searchForm").contains(e.target)) {
    $("searchForm").classList.remove("is-open");
  }
});
$("searchInput").addEventListener("input", () => {
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(() => applyFilters({ q: $("searchInput").value.trim() }), 400);
});

/* ---------- genres ---------- */
async function showGenres() {
  $("genreGrid").innerHTML = `<div class="state">Loading...</div>`;
  try {
    const { genres } = await api("/api/genres");
    $("genreGrid").innerHTML = genres.length
      ? genres.map(g => `<button class="genre-tile" data-genre="${esc(g.name)}"><b>${esc(g.name)}</b><span>${g.count} movie${g.count === 1 ? "" : "s"}</span></button>`).join("")
      : `<div class="state">No genres yet.</div>`;
  } catch (error) { $("genreGrid").innerHTML = `<div class="state">${esc(error.message)}</div>`; }
}
$("genreGrid").addEventListener("click", e => {
  const tile = e.target.closest("[data-genre]");
  if (tile) applyFilters({ genre: tile.dataset.genre, q: "" });
});
$("homeRows").addEventListener("click", e => {
  const link = e.target.closest("[data-sort]");
  if (link) { state.filters = { q: "", genre: "", year: "", minRating: "", sort: link.dataset.sort }; state.page = 1; }
});

/* ---------- movie page ---------- */
let currentMovie = null;
let commentSort = "newest";
const playbackPositions = new Map();

function stopActivePlayback() {
  const video = document.querySelector("#player video");
  if (video && currentMovie) {
    try {
      if (Number.isFinite(video.currentTime)) playbackPositions.set(String(currentMovie.id), video.currentTime);
      video.pause();
    } catch { /* player may already be detached */ }
  }
  // Removing an iframe immediately stops its playback. Cross-origin providers do
  // not expose a safe, universal API for reading their current playback position.
  const player = $("player");
  if (player) player.replaceChildren();
}

function embedFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : (u.searchParams.get("v") || u.pathname.split("/").pop());
    return /^[\w-]{6,15}$/.test(id) ? { type: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean).pop();
    return /^\d+$/.test(id) ? { type: "iframe", src: `https://player.vimeo.com/video/${id}?autoplay=1` } : null;
  }
  if (host === "archive.org") {
    const m = u.pathname.match(/^\/(?:embed|details)\/([^/]+)/);
    return m ? { type: "iframe", src: `https://archive.org/embed/${m[1]}` } : null;
  }
  if (/\.(mp4|webm|ogg|m4v)(\?|$)/i.test(u.pathname + u.search)) return { type: "video", src: url };
  return null;
}

function requestMobilePlayerFullscreen(box, media) {
  if (!window.matchMedia("(max-width: 700px), (pointer: coarse)").matches) return;

  // iPhone Safari exposes a native video fullscreen method. Removing playsinline
  // below also lets iOS use its native fullscreen playback behavior.
  if (media && typeof media.webkitEnterFullscreen === "function") {
    try { media.webkitEnterFullscreen(); return; } catch { /* try the container API */ }
  }

  const request = box.requestFullscreen || box.webkitRequestFullscreen;
  if (typeof request !== "function") return;
  try {
    const result = request.call(box);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch { /* the browser may deny fullscreen; native player controls remain available */ }
}

function mountPlayer() {
  const box = $("player");
  const url = currentMovie && safeUrl(currentMovie.video_url);
  const embed = url && embedFor(url);
  if (!embed) { box.innerHTML = `<div class="player-note"><p>${url ? "This video source is not supported by the player." : "Video is not available for this title yet."}</p></div>`; return; }
  box.innerHTML = embed.type === "video"
    ? `<video controls autoplay src="${esc(embed.src)}"></video>`
    : `<iframe src="${esc(embed.src)}" title="${esc(currentMovie.title_en)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>`;
  const video = box.querySelector("video");
  if (video) {
    const resumeAt = playbackPositions.get(String(currentMovie.id));
    if (Number.isFinite(resumeAt) && resumeAt > 0) {
      video.addEventListener("loadedmetadata", () => {
        try { video.currentTime = resumeAt; } catch { /* seek may be unavailable */ }
      }, { once: true });
    }
    video.addEventListener("timeupdate", () => {
      if (Number.isFinite(video.currentTime)) playbackPositions.set(String(currentMovie.id), video.currentTime);
    });
    try {
      const playback = video.play();
      if (playback && typeof playback.catch === "function") playback.catch(() => {});
    } catch { /* playback can still be started from the native controls */ }
    requestMobilePlayerFullscreen(box, video);
  } else {
    requestMobilePlayerFullscreen(box, box.querySelector("iframe"));
  }
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function showMovie(id, autoplay) {
  const view = $("movieView");
  view.innerHTML = `<div class="state">Loading...</div>`;
  try {
    const { movie: m } = await api(`/api/movies/${id}`);
    currentMovie = m;
    document.title = `${m.title_en} — NoAdFrame`;
    const back = safeUrl(m.backdrop_url) || safeUrl(m.poster_url);
    const cover = safeUrl(m.backdrop_url) || safeUrl(m.poster_url);
    view.innerHTML = `
      ${back ? `<div class="detail-back"><img src="${esc(back)}" alt=""></div>` : ""}
      <div class="detail">
        <div class="poster" id="posterPlay" role="button" tabindex="0" aria-label="Play ${esc(m.title_en)}">${posterImg(m)}<div class="play"><span>▶</span></div></div>
        <div class="info">
          <h1>${esc(m.title_ka || m.title_en)}</h1>
          <div class="en">${esc(m.title_en)}</div>
          <div class="chips-row">${imdbBadge(m)}<span class="pill">${esc(m.release_year || "—")}</span>${String(m.genre || "").split(",").filter(g => g.trim()).map(g => `<span class="pill">${esc(g.trim())}</span>`).join("")}</div>
          <div class="facts">
            <div><span>Director</span><b>${esc(m.director || "—")}</b></div>
            <div><span>Cast</span><b>${esc(m.actors || "—")}</b></div>
          </div>
          <p class="desc">${esc(m.description || "No description available.")}</p>
          ${[m.poster_attribution,m.backdrop_attribution,m.video_attribution].filter(Boolean).length ? `<div class="rights-credit"><strong>Content credits</strong><p>${[m.poster_attribution,m.backdrop_attribution,m.video_attribution].filter(Boolean).map(esc).join("<br>")}</p>${m.video_license_url ? `<a href="${esc(safeUrl(m.video_license_url))}" target="_blank" rel="noopener noreferrer">Video licence</a>` : ""}</div>` : ""}
          <button class="btn solid" id="watchBtn" type="button">${m.video_type === "trailer" && safeUrl(m.video_url) ? "▶ Watch Trailer" : "▶ Watch Movie"}</button>
        </div>
      </div>
      <div class="player" id="player">
        <button class="player-cover" id="playerCover" type="button" aria-label="Play">${cover ? `<img src="${esc(cover)}" alt="">` : ""}<span class="big">▶</span></button>
      </div>
      <section class="comments" aria-labelledby="commentsTitle">
        <div class="comments-top"><div><h2 id="commentsTitle">Comments</h2><span class="count" id="commentCount"></span></div>
          <label class="count">Sort <select id="commentSort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
        <form class="comment-form" id="commentForm">
          <textarea id="commentInput" maxlength="1200" placeholder="${state.user ? "Share your thoughts about this film..." : "Login to write a comment"}" ${state.user ? "" : "disabled"} required></textarea>
          <div class="bar"><span>${state.user ? `Posting as ${esc(state.user.username)}` : "Only registered users can comment."}</span>
          ${state.user ? `<button class="btn solid" type="submit">Post comment</button>` : `<button class="btn solid" type="button" data-open-auth="login">Login</button>`}</div>
        </form>
        <div id="commentsList"></div>
      </section>`;
    $("commentSort").value = commentSort;
    const play = () => mountPlayer();
    $("posterPlay").addEventListener("click", play);
    $("posterPlay").addEventListener("keydown", e => { if (e.key === "Enter") play(); });
    $("watchBtn").addEventListener("click", play);
    $("playerCover").addEventListener("click", play);
    $("commentSort").addEventListener("change", e => { commentSort = e.target.value; loadComments(); });
    $("commentForm").addEventListener("submit", postComment);
    if (autoplay) setTimeout(mountPlayer, 150);
    await loadComments();
  } catch (error) {
    view.innerHTML = `<div class="state">${esc(error.message)}</div>`;
  }
}

async function loadComments() {
  if (!currentMovie) return;
  try {
    const { comments } = await api(`/api/movies/${currentMovie.id}/comments?sort=${commentSort}`);
    $("commentCount").textContent = `${comments.length} comment${comments.length === 1 ? "" : "s"}`;
    $("commentsList").innerHTML = comments.length ? comments.map(c => `
      <article class="comment"><header><b>${esc(c.author)}</b><time datetime="${esc(c.created_at)}">${new Date(c.created_at).toLocaleString()}</time>
      ${state.user && state.user.id === c.user_id ? `<button class="btn ghost danger small del" data-del="${c.id}" type="button">Delete</button>` : ""}</header>
      <p>${esc(c.comment)}</p></article>`).join("") : `<div class="state">No comments yet. Be the first!</div>`;
  } catch (error) { $("commentsList").innerHTML = `<div class="state">${esc(error.message)}</div>`; }
}
async function postComment(e) {
  e.preventDefault();
  const input = $("commentInput");
  try {
    await api(`/api/movies/${currentMovie.id}/comments`, { method: "POST", body: JSON.stringify({ comment: input.value }) });
    input.value = "";
    toast("Comment posted.");
    await loadComments();
  } catch (error) { toast(error.message); }
}
$("movieView").addEventListener("click", async e => {
  const del = e.target.closest("[data-del]");
  if (!del || !confirm("Delete this comment?")) return;
  try { await api(`/api/comments/${del.dataset.del}`, { method: "DELETE" }); toast("Comment deleted."); loadComments(); }
  catch (error) { toast(error.message); }
});

/* ---------- profile ---------- */
async function showProfile() {
  if (!state.user) { location.hash = "#/"; openAuth("login"); return; }
  const view = $("profileView");
  view.innerHTML = `<div class="state">Loading...</div>`;
  try {
    const data = await api("/api/auth/me");
    const u = data.user;
    view.innerHTML = `
      <div class="profile-card"><div class="avatar-big">${esc(u.username.charAt(0).toUpperCase())}</div>
        <div><h1>${esc(u.username)}</h1><p>${esc(u.email)}</p><p>Member since ${new Date(u.created_at).toLocaleDateString()} · ${data.stats.comments} comment${data.stats.comments === 1 ? "" : "s"}${data.isAdmin ? " · Administrator" : ""}</p></div></div>
      <div class="panel"><h2>Change password</h2>
        <form class="form" id="pwForm"><label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label>
        <label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="8" maxlength="72" required></label>
        <button class="btn solid" type="submit">Update password</button><p class="form-message" id="pwMessage" role="alert"></p></form></div>
      <div class="panel"><h2>Your recent comments</h2>${data.comments.length ? data.comments.map(c => `
        <article class="comment"><header><a href="#/movie/${c.movie_id}"><b>${esc(c.title_en)}</b></a><time>${new Date(c.created_at).toLocaleString()}</time></header><p>${esc(c.comment)}</p></article>`).join("")
        : `<div class="state">You haven't commented yet.</div>`}</div>`;
    $("pwForm").addEventListener("submit", async ev => {
      ev.preventDefault();
      const msg = $("pwMessage"); msg.className = "form-message";
      try {
        await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(ev.target))) });
        msg.textContent = "Password updated."; msg.classList.add("ok"); ev.target.reset();
      } catch (error) { msg.textContent = error.message; }
    });
  } catch (error) { view.innerHTML = `<div class="state">${esc(error.message)}</div>`; }
}

/* ---------- router ---------- */
let bootScreenDismissed = false;
function dismissBootScreen() {
  if (bootScreenDismissed) return;
  bootScreenDismissed = true;
  const screen = $("bootScreen");
  if (!screen) return;
  screen.classList.add("is-hidden");
  window.setTimeout(() => { screen.hidden = true; }, 260);
}

async function route() {
  stopActivePlayback();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let view = "home";
  if (parts[0] === "movies") view = "movies";
  else if (parts[0] === "genres") view = "genres";
  else if (parts[0] === "about") view = "about";
  else if (parts[0] === "reset-password") view = "reset-password";
  else if (parts[0] === "profile") view = "profile";
  else if (parts[0] === "movie" && /^\d+$/.test(parts[1] || "")) view = "movie";
  document.querySelectorAll(".view").forEach(el => { el.hidden = el.dataset.view !== view; });
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === (view === "movie" ? "movies" : view)));
  document.title = "NoAdFrame — Watch. Enjoy. No Ads.";
  window.scrollTo(0, 0);
  if (view !== "movies" && view !== "movie") $("searchInput").value = state.filters.q;
  try {
    if (view === "home") await showHome();
    else if (view === "movies") await showMovies();
    else if (view === "genres") await showGenres();
    else if (view === "profile") await showProfile();
    else if (view === "movie") await showMovie(parts[1], parts[2] === "play");
    else if (view === "reset-password") showResetPassword();
  } finally {
    dismissBootScreen();
  }
}
window.addEventListener("hashchange", route);
window.addEventListener("pagehide", stopActivePlayback);

/* ---------- auth modal ---------- */
function openAuth(tab) {
  setTab(tab);
  $("authModal").hidden = false;
  setTimeout(() => $(tab === "login" ? "loginForm" : "registerForm").querySelector("input").focus(), 30);
}
function closeAuth() { $("authModal").hidden = true; }
function setTab(tab) {
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("selected", b.dataset.tab === tab));
  $("loginForm").hidden = tab !== "login";
  $("registerForm").hidden = tab !== "register";
  $("authTitle").textContent = tab === "login" ? "Welcome back" : "Join NoAdFrame";
  $("authMessage").textContent = "";
}
$("loginBtn").addEventListener("click", () => openAuth("login"));
$("registerBtn").addEventListener("click", () => openAuth("register"));
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("authModal").addEventListener("click", e => { if (e.target === $("authModal") || e.target.hasAttribute("data-close")) closeAuth(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAuth(); $("chatPanel").classList.remove("open"); $("searchForm").classList.remove("is-open"); } });
document.addEventListener("click", e => { const b = e.target.closest("[data-open-auth]"); if (b) openAuth(b.dataset.openAuth); });

async function submitAuth(event, endpoint, welcome) {
  event.preventDefault();
  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    setSession(data.user);
    if (document.querySelector('[data-view="movie"]:not([hidden])') || document.querySelector('[data-view="profile"]:not([hidden])')) route();
    event.target.reset(); closeAuth(); toast(welcome);
  } catch (error) { $("authMessage").textContent = error.message; }
  finally { button.disabled = false; }
}
$("loginForm").addEventListener("submit", e => submitAuth(e, "/api/auth/login", "Welcome back!"));
$("registerForm").addEventListener("submit", e => submitAuth(e, "/api/auth/register", "Your account is ready."));
$("forgotOpen").addEventListener("click", () => { $("forgotForm").hidden = !$("forgotForm").hidden; });
$("forgotForm").addEventListener("submit", async e => {
  e.preventDefault(); const message = $("forgotMessage");
  try { const data = await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: new FormData(e.target).get("email") }) }); message.textContent = data.message; }
  catch (error) { message.textContent = error.message; }
});
function showResetPassword() {
  const token = new URLSearchParams(location.search).get("token") || new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
  $("resetToken").value = token;
  $("resetView").hidden = false;
  $("resetMessage").textContent = token ? "Choose a new password." : "Reset link is missing or invalid.";
}
$("resetForm").addEventListener("submit", async e => {
  e.preventDefault(); const message = $("resetMessage");
  try { const data = await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token: $("resetToken").value, password: e.target.password.value }) }); message.textContent = data.message; e.target.reset(); }
  catch (error) { message.textContent = error.message; }
});
$("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); }
  finally { setSession(null); toast("You have logged out."); if (location.hash.startsWith("#/profile")) location.hash = "#/"; }
});

/* Keep the assistant composer above the mobile keyboard. */
function syncChatKeyboardInset() {
  const viewport = window.visualViewport;
  const inset = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
  document.documentElement.style.setProperty("--chat-keyboard-inset", String(Math.round(inset)) + "px");
}
syncChatKeyboardInset();
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncChatKeyboardInset);
  window.visualViewport.addEventListener("scroll", syncChatKeyboardInset);
}
window.addEventListener("resize", syncChatKeyboardInset);

/* ---------- AI assistant ---------- */
function addBubble(role, content) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = content;
  $("chatMessages").appendChild(el);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  return el;
}
async function sendChat(message) {
  addBubble("user", message);
  const waiting = addBubble("bot", "Thinking...");
  $("chatChips").hidden = true;
  try {
    const { reply } = await api("/api/assistant", { method: "POST", body: JSON.stringify({ message, history: state.chat }) });
    waiting.textContent = reply;
    state.chat.push({ role: "user", content: message }, { role: "assistant", content: reply });
    state.chat = state.chat.slice(-10);
  } catch (error) { waiting.textContent = error.message; }
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}
$("chatLauncher").addEventListener("click", () => { $("chatPanel").classList.toggle("open"); $("chatInput").focus(); });
$("chatClose").addEventListener("click", () => $("chatPanel").classList.remove("open"));
$("chatForm").addEventListener("submit", e => {
  e.preventDefault();
  const message = $("chatInput").value.trim();
  if (!message) return;
  $("chatInput").value = "";
  sendChat(message);
});
$("chatChips").addEventListener("click", e => { if (e.target.tagName === "BUTTON") sendChat(e.target.textContent); });

renderAuth();
restoreSession().finally(() => { route(); });
