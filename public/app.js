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
const movieCache = new Map();
function rememberMovies(movies = []) {
  for (const movie of movies) {
    if (movie && movie.id != null) movieCache.set(String(movie.id), movie);
  }
}

const $ = (id) => document.getElementById(id);
const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

function movieSlug(title){return String(title||"movie").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"movie";}
function moviePath(movie){return "/movies/"+encodeURIComponent(String(movie.id))+"/"+movieSlug(movie.title_en||movie.title_ka);}
function setMeta(selector,attribute,value){let el=document.head.querySelector(selector);if(!el){el=document.createElement("meta");const m=selector.match(/(?:name|property)=["']([^"']+)["']/);if(m)el.setAttribute(m[0].split("=")[0],m[1]);document.head.appendChild(el);}el.setAttribute(attribute,value);}
function updatePageSeo({title,description,path="/",image="/assets/logo.png",noindex=false,structuredData=null}){
 document.title=title;setMeta('meta[name="description"]',"content",description);
 setMeta('meta[property="og:title"]',"content",title);setMeta('meta[property="og:description"]',"content",description);
 setMeta('meta[property="og:url"]',"content",new URL(path,location.origin).href);setMeta('meta[property="og:image"]',"content",new URL(image,location.origin).href);
 setMeta('meta[name="robots"]',"content",noindex?"noindex, nofollow":"index, follow");
 let c=document.querySelector('link[rel="canonical"]');if(!c){c=document.createElement("link");c.rel="canonical";document.head.appendChild(c);}c.href=new URL(path,location.origin).href;
 let sc=document.getElementById("pageStructuredData");if(structuredData){if(!sc){sc=document.createElement("script");sc.id="pageStructuredData";sc.type="application/ld+json";document.head.appendChild(sc);}sc.textContent=JSON.stringify(structuredData);}else if(sc)sc.remove();
}
function movieStructuredData(m,path){const url=new URL(path,location.origin).href;const movie={"@type":"Movie",name:m.title_en,description:m.description||m.title_en+" — movie details on NoAdFrame.",url};if(m.title_ka)movie.alternateName=m.title_ka;if(m.release_year)movie.datePublished=String(m.release_year);if(m.genre)movie.genre=m.genre.split(",").map(x=>x.trim());if(m.director)movie.director={"@type":"Person",name:m.director};if(m.actors)movie.actor=m.actors.split(",").map(x=>({"@type":"Person","name":x.trim()}));if(safeUrl(m.poster_url))movie.image=m.poster_url;if(/^tt[0-9]{6,10}$/.test(m.imdb_id||""))movie.sameAs="https://www.imdb.com/title/"+m.imdb_id+"/";return {"@context":"https://schema.org","@graph":[movie,{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":location.origin+"/"},{"@type":"ListItem","position":2,"name":"Movies","item":location.origin+"/movies"},{"@type":"ListItem","position":3,"name":m.title_en,"item":url}]}]};}


async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const csrf = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith("noadframe_csrf="));
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(String(options.method || "GET").toUpperCase())) headers["X-CSRF-Token"] = decodeURIComponent(csrf.slice("noadframe_csrf=".length));
  let response;
  try {
    response = await fetch(url, { cache: options.cache || "no-store", ...options, headers, credentials: "same-origin" });
  } catch (error) {
    reportBrowserError("network", error);
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.includes("/auth/login") && !url.includes("/auth/register")) {
    setSession(null);
    if (document.querySelector('[data-view="movie"]:not([hidden])') || document.querySelector('[data-view="profile"]:not([hidden])')) route();
  }
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    reportBrowserError("api-" + response.status, error);
    throw error;
  }
  return data;
}

function reportBrowserError(kind, error) {
  const message = String(error?.message || error || "Unknown browser error").slice(0, 1500);
  const stack = String(error?.stack || "").slice(0, 3000);
  const csrfCookie = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("noadframe_csrf="));
  const headers = { "Content-Type": "application/json" };
  if (csrfCookie) headers["X-CSRF-Token"] = decodeURIComponent(csrfCookie.slice("noadframe_csrf=".length));
  fetch("/api/client-errors", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({ kind, message, stack, page: location.pathname })
  }).catch(() => {});
}
window.addEventListener("error", event => {
  if (event.error || event.message) reportBrowserError("runtime", event.error || event.message);
});
window.addEventListener("unhandledrejection", event => reportBrowserError("unhandled-rejection", event.reason));
for (const [method,kind] of [["error","console-error"],["warn","console-warning"]]) {
  const original=console[method].bind(console);
  console[method]=(...args)=>{
    original(...args);
    try {
      const message=args.map(value=>value instanceof Error?value.message:typeof value==="string"?value:String(value)).join(" ").slice(0,1500);
      reportBrowserError(kind,new Error(message));
    } catch { /* diagnostics must never interrupt the site */ }
  };
}


const countedMovieViews = new Set();
function recordMovieView(movie) {
  const id = String(movie?.id || "");
  if (!/^[1-9]\d*$/.test(id) || countedMovieViews.has(id)) return;
  const storageKey = `noadframe:movie-view:${id}`;
  try {
    if (sessionStorage.getItem(storageKey) === "1") {
      countedMovieViews.add(id);
      return;
    }
    sessionStorage.setItem(storageKey, "1");
  } catch { /* Keep an in-memory guard if session storage is unavailable. */ }
  countedMovieViews.add(id);
  api(`/api/movies/${id}/view`, { method: "POST" }).catch(error => {
    countedMovieViews.delete(id);
    try { sessionStorage.removeItem(storageKey); } catch { /* storage may be disabled */ }
    console.warn("Movie view could not be recorded:", error.message);
  });
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
const LOCAL_VIDEO_ART = {
  "tt12299608": { poster: "/images/p1.jpg", backdrop: "/images/b1.jpg" },
  "tt14849194": { poster: "/images/p2.jpg", backdrop: "/images/b2.jpg" },
  "tt0017136": { poster: "/images/p3.jpg", backdrop: "/images/b3.jpg" },
  "tt0013442": { poster: "/images/p4.jpg", backdrop: "/images/b4.jpg" },
  "tt1727587": { poster: "/images/p5.jpg", backdrop: "/images/b5.jpg" },
  "tt1254207": { poster: "/images/p6.jpg", backdrop: "/images/b6.jpg" },
  "tt0056923": { poster: "/images/p7.jpg", backdrop: "/images/b7.jpg" },
  "tt0017925": { poster: "/images/p8.jpg", backdrop: "/images/b8.jpg" }
};
const LOCAL_VIDEO_ART_IDS = new Set(["tt12299608", "tt14849194"]);
function localVideoArt(movie) {
  const id = String(movie?.imdb_id || "");
  const hasVideo = !!(movie && (movie.has_video_source || safeUrl(movie.video_url)));
  return hasVideo || LOCAL_VIDEO_ART_IDS.has(id) ? LOCAL_VIDEO_ART[id] || null : null;
}
function imdbBadge(m) {
  return m.imdb_rating != null ? `<span class="imdb">IMDb ${Number(m.imdb_rating).toFixed(1)}</span>` : `<span class="imdb none">IMDb N/A</span>`;
}
function posterImg(m) {
  const art = localVideoArt(m);
  const url = art?.poster || safeUrl(m.poster_url);
  return url
    ? `<img src="${esc(url)}" alt="Poster of ${esc(m.title_en)}" loading="lazy" decoding="async" data-fallback>`
    : `<div class="poster-fallback"><img src="/assets/logo.png" alt=""></div>`;
}
function cardHTML(m) {
  // Only mark a card as playable when the public API actually exposes a usable URL.
  const hasVideo = !!safeUrl(m.video_url);
  const href = moviePath(m);
  return `<a class="card${hasVideo ? " has-video" : ""}" href="${href}" aria-label="${esc(m.title_en)}">
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
  const heroRoot=$("hero"),rowsRoot=$("homeRows");
  if(!heroRoot||!rowsRoot)return;
  heroRoot.innerHTML="";
  rowsRoot.innerHTML="";
  try {
    const [data,bannerData] = await Promise.all([
      api("/api/movies/categories"),
      api("/api/site-banners",{cache:"no-store"}).catch(()=>({banners:[]}))
    ]);
    const popular=Array.isArray(data.popular)?data.popular:[];
    const topRated=Array.isArray(data.topRated)?data.topRated:[];
    const newReleases=Array.isArray(data.newReleases)?data.newReleases:[];
    const featured=Array.isArray(data.featured)?data.featured:[];
    const all=[...featured,...topRated,...newReleases,...popular];
    rememberMovies(all);
    warmArchiveVideoSources(all,3);
    const configured=Array.isArray(bannerData.banners)?bannerData.banners:[];
    const customBanners=configured.filter(item=>safeUrl(item.banner_image_url));
    if(customBanners.length){
      heroRoot.innerHTML=heroHTML(customBanners);
    }else{
      const featuredPool=[...featured,...all];
      const mickey=featuredPool.find(m=>/mickey\s*17/i.test(m.title_en||""));
      const holdovers=featuredPool.find(m=>/the holdovers/i.test(m.title_en||""));
      const defaults=[mickey,holdovers].filter((movie,index,list)=>movie&&list.findIndex(x=>x&&x.id===movie.id)===index);
      const fallback=defaults.length?defaults:[all.find(m=>safeUrl(m.backdrop_url))||topRated[0]||all[0]].filter(Boolean);
      heroRoot.innerHTML=fallback.length?heroHTML(fallback):heroEmptyHTML();
    }
    const carousel=heroRoot.querySelector("[data-hero-carousel]");
    if(carousel){
      let activeIndex=0;
      const slides=carousel.querySelectorAll(".hero-slide");
      const dots=carousel.querySelectorAll(".hero-dot");
      const showSlide=index=>{
        activeIndex=(index+slides.length)%slides.length;
        slides.forEach((slide,i)=>slide.classList.toggle("active",i===activeIndex));
        dots.forEach((button,i)=>button.classList.toggle("active",i===activeIndex));
      };
      carousel.addEventListener("click",event=>{
        const control=event.target.closest("[data-hero-nav]");
        if(control){
          showSlide(activeIndex+Number(control.dataset.heroNav));
          return;
        }
        const dot=event.target.closest("[data-hero-index]");
        if(dot)showSlide(Number(dot.dataset.heroIndex));
      });
      if(slides.length>1){
        if(window.homeHeroTimer)clearInterval(window.homeHeroTimer);
        window.homeHeroTimer=setInterval(()=>showSlide(activeIndex+1),6000);
      }
    }
    const sections=[["Popular Movies",popular,"popular"],["Top Rated",topRated,"rating"],["New Releases",newReleases,"year"]];
    rowsRoot.innerHTML=sections.filter(([,list])=>list.length).map(([title,list,sort])=>`
      <section class="row"><div class="row-head"><h2>${title}</h2><a href="#/movies" data-sort="${sort}">See all</a></div>
      <div class="row-track">${list.map(cardHTML).join("")}</div></section>`).join("");
  } catch(error) {
    heroRoot.innerHTML=heroEmptyHTML();
    rowsRoot.innerHTML=`<div class="page"><div class="state">${esc(error.message)}</div></div>`;
  }
}
function heroHTML(movies) {
  const list = Array.isArray(movies) ? movies : [movies];
  if (list.length === 1) return heroSlideHTML(list[0]);
  return `<div class="hero-carousel" data-hero-carousel>
    <div class="hero-carousel-slides">${list.map((movie, index) => heroSlideHTML(movie, index === 0)).join("")}</div>
    <button class="hero-nav hero-nav-prev" type="button" data-hero-nav="-1" aria-label="წინა ბანერი">‹</button>
    <button class="hero-nav hero-nav-next" type="button" data-hero-nav="1" aria-label="შემდეგი ბანერი">›</button>
    <div class="hero-carousel-dots" aria-label="მთავარი ბანერები">${list.map((movie, index) => `<button class="hero-dot${index === 0 ? " active" : ""}" type="button" data-hero-index="${index}" aria-label="${index+1} ბანერი: ${esc(movie.title_en)}"></button>`).join("")}</div>
  </div>`;
}
function heroSlideHTML(m, active = true) {
  const title = String(m.title_en || "");
  const localArt = localVideoArt(m);
  const aiBanner = /mickey\s*17/i.test(title)
    ? "/assets/hero-mickey17-ai.jpg"
    : (/the holdovers/i.test(title) ? "/assets/hero-holdovers-ai.jpg" : "");
  const bg = safeUrl(m.banner_image_url) || localArt?.backdrop || aiBanner || safeUrl(m.backdrop_url) || safeUrl(m.poster_url);
  const playable = !!safeUrl(m.video_url);
  const playHref = playable ? `${moviePath(m)}?play=1` : moviePath(m);
  const playLabel = playable ? (m.video_type === "trailer" ? "▶ Watch Trailer" : "▶ Watch Movie") : "View Details";
  return `<section class="hero hero-slide${active ? " active" : ""}">
    ${bg ? `<img class="hero-bg" src="${esc(bg)}" alt="" data-hero>` : ""}
    <div class="hero-copy">
      <span class="hero-tag">Featured</span>
      <h1>${esc(m.title_ka || m.title_en)}</h1>
      ${m.title_ka ? `<div class="en">${esc(m.title_en)}</div>` : ""}
      <div class="hero-meta">${imdbBadge(m)}<span class="pill">${esc(m.release_year || "—")}</span>${String(m.genre || "").split(",").slice(0, 3).map(g => `<span class="pill">${esc(g.trim())}</span>`).filter(() => m.genre).join("")}</div>
      <p>${esc(m.description || "")}</p>
      <div class="hero-actions"><a class="btn solid" href="${playHref}">${playLabel}</a><a class="btn ghost" href="${moviePath(m)}">Details</a></div>
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
    rememberMovies(data.movies);
    warmArchiveVideoSources(data.movies.slice(0, 8), 2);
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
function handleMobileMovieNavigation(event) {
  if (!window.matchMedia("(max-width: 700px), (pointer: coarse)").matches) return;
  const link = event.target.closest('a[href^="#/movie/"]');
  if (!link) return;
  const target = link.getAttribute("href");
  if (!target || !/^#\/movie\/\d+(?:\/play)?$/.test(target)) return;
  event.preventDefault();
  if (location.hash === target) {
    void route();
  } else {
    location.hash = target;
  }
}

$("homeRows").addEventListener("click", e => {
  const link = e.target.closest("[data-sort]");
  if (link) { state.filters = { q: "", genre: "", year: "", minRating: "", sort: link.dataset.sort }; state.page = 1; }
});
["homeRows", "movieGrid", "hero"].forEach(id => {
  $(id).addEventListener("click", handleMobileMovieNavigation);
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
  if (player) {
    exitMobilePlayerFullscreen(player);
    player.replaceChildren();
  } else {
    document.body.classList.remove("player-open");
  }
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
    return m ? { type: "archive", identifier: m[1], fallbackSrc: `https://archive.org/embed/${encodeURIComponent(m[1])}` } : null;
  }
  if (/\.(mp4|webm|ogg|m4v)(\?|$)/i.test(u.pathname + u.search)) return { type: "video", src: url };
  return null;
}

const archiveVideoRequests = new Map();
const archiveVideoUrls = new Map();
const archiveVideoFallbacks = new Map();
const archiveVideoErrors = new Map();

function isMobilePlayer() {
  return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
}

function resolveArchiveVideo(identifier) {
  if (archiveVideoUrls.has(identifier)) return Promise.resolve(archiveVideoUrls.get(identifier));
  if (!archiveVideoRequests.has(identifier)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const request = api(`/api/archive-video?identifier=${encodeURIComponent(identifier)}`, { signal: controller.signal })
      .then(data => {
        const url = safeUrl(data.videoUrl);
        const fallback = safeUrl(data.archiveEmbedUrl);
        if (url) {
          archiveVideoUrls.set(identifier, url);
          if (fallback) archiveVideoFallbacks.set(identifier, fallback);
          archiveVideoErrors.delete(identifier);
        } else {
          archiveVideoErrors.set(identifier, "The source did not provide a playable video file.");
        }
        return url;
      })
      .catch(error => {
        archiveVideoErrors.set(identifier, error.name === "AbortError"
          ? "Archive.org did not respond in time."
          : error.message || "The video source could not be loaded.");
        return null;
      })
      .finally(() => {
        clearTimeout(timeout);
        archiveVideoRequests.delete(identifier);
      });
    archiveVideoRequests.set(identifier, request);
  }
  return archiveVideoRequests.get(identifier);
}

function showArchiveEmbedFallback(box, movie, identifier) {
  const src = archiveVideoFallbacks.get(identifier) || `https://archive.org/embed/${encodeURIComponent(identifier)}`;
  box.innerHTML = `<iframe class="player-media archive-embed-fallback" loading="eager" src="${esc(src)}" title="${esc(movie.title_en || "Archive.org video")}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen webkitallowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  box.querySelector("iframe")?.addEventListener("error", () => {
    showArchiveVideoError(box, movie, identifier, "Archive.org-ის ჩაშენებული პლეერიც ვერ ჩაიტვირთა. სცადე მოგვიანებით ან სხვა წყარო.");
  }, { once: true });
}
function showArchiveVideoError(box, movie, identifier, message) {
  const sourceUrl = `https://archive.org/details/${encodeURIComponent(identifier || "")}`;
  box.innerHTML = `<div class="player-note player-error">
    <div>
      <h3>ვიდეო ვერ გაეშვა</h3>
      <p>${esc(message || "ვიდეოფაილი ვერ ჩაიტვირთა ან ტელეფონის ბრაუზერი მის კოდეკს ვერ კითხულობს.")}</p>
      <a class="btn ghost" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source on Archive.org</a>
    </div>
  </div>`;
  if (isMobilePlayer()) addMobilePlayerFullscreen(box);
}

function warmArchiveVideoSources(movies, maxCount = 3) {
  const seen = new Set();
  for (const movie of movies || []) {
    const url = safeUrl(movie?.video_url);
    if (!url) continue;
    const embed = embedFor(url);
    if (embed?.type !== "archive" || seen.has(embed.identifier)) continue;
    seen.add(embed.identifier);
    void resolveArchiveVideo(embed.identifier);
    if (seen.size >= maxCount) break;
  }
}

function exitMobilePlayerFullscreen(box = $("player")) {
  if (box) {
    box.classList.remove("player-mobile-fullscreen");
    box.querySelector(".player-fullscreen-close")?.remove();
    box.querySelector(".player-start-overlay")?.remove();
    if (document.fullscreenElement === box && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
  document.body.classList.remove("player-open");
}

function addMobilePlayerFullscreen(box) {
  if (!isMobilePlayer()) return;
  box.classList.add("player-mobile-fullscreen");
  document.body.classList.add("player-open");
  if (box.querySelector(".player-fullscreen-close")) return;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "player-fullscreen-close";
  close.setAttribute("aria-label", "Close fullscreen video");
  close.textContent = "×";
  close.addEventListener("click", () => exitMobilePlayerFullscreen(box));
  box.append(close);
}

function requestMobilePlayerFullscreen(box, media) {
  if (!isMobilePlayer()) return;
  addMobilePlayerFullscreen(box);

  // iPhone Safari uses native fullscreen for HTML video.
  if (media && typeof media.webkitEnterFullscreen === "function") {
    try {
      media.webkitEnterFullscreen();
      return;
    } catch { /* use the standard Fullscreen API if available */ }
  }

  const target = media && typeof media.requestFullscreen === "function" ? media : box;
  const request = target.requestFullscreen || target.webkitRequestFullscreen;
  if (typeof request === "function") {
    try {
      const result = request.call(target);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch { /* fixed full-screen player remains as a fallback */ }
  }
}

function showPlayerStartControl(box, video) {
  box.querySelector(".player-start-overlay")?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "player-start-overlay";
  button.setAttribute("aria-label", "Start video");
  button.innerHTML = '<span class="player-start-icon">▶</span><b>Tap to play</b><small>Your video is ready</small>';
  button.addEventListener("click", () => {
    button.remove();
    startVideoPlayback(box, video);
  }, { once: true });
  box.append(button);
}

function startVideoPlayback(box, video) {
  if (!video) return;
  if (isMobilePlayer()) requestMobilePlayerFullscreen(box, video);
  try {
    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(error => {
        if (error?.name === "NotSupportedError" || video.error) {
          const archiveId = video.dataset.archiveId || "";
          if (archiveId && archiveVideoFallbacks.has(archiveId)) {
            showArchiveEmbedFallback(box, currentMovie || { title_en: "Video" }, archiveId);
          } else {
            showArchiveVideoError(
              box,
              currentMovie || { title_en: "Video" },
              archiveId,
              "ტელეფონის ბრაუზერი ამ ვიდეოფორმატს ვერ უკრავს."
            );
          }
          return;
        }
        showPlayerStartControl(box, video);
        toast("Tap the play control to start the video.");
      });
    }
  } catch {
    showPlayerStartControl(box, video);
  }
}

function renderPlayerSource(box, movie, source, { userInitiated = false, delayed = false } = {}) {
  box.innerHTML = source.type === "video"
    ? `<video class="player-media" controls playsinline webkit-playsinline preload="metadata" src="${esc(source.src)}"></video>`
    : `<iframe class="player-media" loading="eager" src="${esc(source.src)}" title="${esc(movie.title_en)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

  if (isMobilePlayer()) {
    addMobilePlayerFullscreen(box);
  }

  const video = box.querySelector("video");
  if (video) {
    video.addEventListener("play", () => recordMovieView(movie), { once: true });
    if (source.archiveId) video.dataset.archiveId = source.archiveId;
    // Do not replace an unsupported video with an Archive iframe that can
    // remain on an endless spinner. Show the actual playback failure instead.
    if (source.archiveId) {
      video.addEventListener("error", () => {
        if (!box.contains(video)) return;
        if (archiveVideoFallbacks.has(source.archiveId)) {
          showArchiveEmbedFallback(box, movie, source.archiveId);
        } else {
          showArchiveVideoError(
            box,
            movie,
            source.archiveId,
            "ვიდეოფაილი ვერ ჩაიტვირთა. შესაძლოა მისი კოდეკი ტელეფონის ბრაუზერს არ უჭერდეს მხარს."
          );
        }
      }, { once: true });
    }
    const resumeAt = playbackPositions.get(String(movie.id));
    if (Number.isFinite(resumeAt) && resumeAt > 0) {
      video.addEventListener("loadedmetadata", () => {
        try { video.currentTime = resumeAt; } catch { /* seek may be unavailable */ }
      }, { once: true });
    }
    video.addEventListener("timeupdate", () => {
      if (Number.isFinite(video.currentTime)) playbackPositions.set(String(movie.id), video.currentTime);
    });
    if (userInitiated && !delayed) {
      startVideoPlayback(box, video);
    } else if (delayed && isMobilePlayer()) {
      // The network lookup has completed after the original tap; give the user
      // a fresh, explicit play action so mobile Safari/Chrome allows playback.
      showPlayerStartControl(box, video);
    }
  } else {
    // Cross-origin embeds do not expose their playback state to this site.
    // Count an explicit user request to open the external player.
    if (userInitiated) recordMovieView(movie);
    if (userInitiated && isMobilePlayer()) {
      requestMobilePlayerFullscreen(box, box.querySelector("iframe"));
    }
  }

  if (!isMobilePlayer()) box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function mountPlayer({ userInitiated = false } = {}) {
  const box = $("player");
  const movie = currentMovie;
  const url = movie && safeUrl(movie.video_url);
  const embed = url && embedFor(url);
  if (!box || !embed) {
    if (box) box.innerHTML = `<div class="player-note"><p>${url ? "This video source is not supported by the player." : "Video is not available for this title yet."}</p></div>`;
    return;
  }

  document.body.classList.add("player-open");
  if (isMobilePlayer()) addMobilePlayerFullscreen(box);

  if (embed.type === "archive") {
    const cachedUrl = archiveVideoUrls.get(embed.identifier);
    if (cachedUrl) {
      renderPlayerSource(box, movie, { type: "video", src: cachedUrl, archiveId: embed.identifier }, { userInitiated });
      return;
    }

    // Keep the full-screen player visible while resolving the browser-playable file.
    box.innerHTML = '<div class="player-loading"><span></span><p>Preparing video…</p></div>';
    if (isMobilePlayer()) addMobilePlayerFullscreen(box);
    if (userInitiated && isMobilePlayer()) requestMobilePlayerFullscreen(box, null);

    resolveArchiveVideo(embed.identifier).then(videoUrl => {
      if (!currentMovie || String(currentMovie.id) !== String(movie.id) || $("player") !== box) return;
      if (videoUrl) {
        renderPlayerSource(box, movie, { type: "video", src: videoUrl, archiveId: embed.identifier }, {
          userInitiated,
          delayed: true
        });
      } else {
        showArchiveVideoError(
          box,
          movie,
          embed.identifier,
          archiveVideoErrors.get(embed.identifier) || "Archive.org-ს ამ ჩანაწერში ტელეფონთან თავსებადი ვიდეოფაილი არ დაუბრუნებია."
        );
      }
    });
    return;
  }

  renderPlayerSource(box, movie, embed, { userInitiated });
}

async function showMovie(id, autoplay) {
  const view = $("movieView");
  view.innerHTML = `<div class="state">Loading...</div>`;
  try {
    const cachedMovie = movieCache.get(String(id));
    const { movie: m } = cachedMovie ? { movie: cachedMovie } : await api(`/api/movies/${id}`);
    rememberMovies([m]);
    const archiveEmbed = safeUrl(m.video_url) ? embedFor(m.video_url) : null;
    if (archiveEmbed?.type === "archive") void resolveArchiveVideo(archiveEmbed.identifier);
    currentMovie = m;
    const canonicalPath=moviePath(m);
    const playRequested=new URLSearchParams(location.search).get("play")==="1"||autoplay;
    if(location.pathname!==canonicalPath||location.hash)history.replaceState(null,"",canonicalPath+(playRequested?"?play=1":""));
    updatePageSeo({title:(m.title_ka?m.title_ka+" ("+m.title_en+")":m.title_en)+" — NoAdFrame",description:String(m.description||m.title_en+" — discover movie details, cast, genre and IMDb information on NoAdFrame.").replace(/\s+/g," ").slice(0,300),path:canonicalPath,image:safeUrl(m.poster_url)||"/assets/logo.png",structuredData:movieStructuredData(m,canonicalPath)});
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
          <div class="description-block">
            <p id="movieDescription" class="desc is-collapsed">${esc(m.description || "No description available.")}</p>
            <button id="descriptionToggle" class="description-toggle" type="button" aria-controls="movieDescription" aria-expanded="false" hidden>Read more</button>
          </div>
          ${[m.poster_attribution,m.backdrop_attribution,m.video_attribution].filter(Boolean).length ? `<div class="rights-credit"><strong>Content credits</strong><p>${[m.poster_attribution,m.backdrop_attribution,m.video_attribution].filter(Boolean).map(esc).join("<br>")}</p>${m.video_license_url ? `<a href="${esc(safeUrl(m.video_license_url))}" target="_blank" rel="noopener noreferrer">Video licence</a>` : ""}</div>` : ""}
          ${safeUrl(m.video_url) ? `<button class="btn solid" id="watchBtn" type="button">${m.video_type === "trailer" ? "▶ Watch Trailer" : "▶ Watch Movie"}</button>` : ""}

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
    const movieDescription = $("movieDescription");
    const descriptionToggle = $("descriptionToggle");
    if (movieDescription && descriptionToggle) {
      const syncDescriptionToggle = () => {
        const isCollapsed = movieDescription.classList.contains("is-collapsed");
        descriptionToggle.hidden = isCollapsed
          ? movieDescription.scrollHeight <= movieDescription.clientHeight + 2
          : false;
      };
      syncDescriptionToggle();
      descriptionToggle.addEventListener("click", () => {
        const expanded = movieDescription.classList.toggle("is-expanded");
        movieDescription.classList.toggle("is-collapsed", !expanded);
        descriptionToggle.setAttribute("aria-expanded", String(expanded));
        descriptionToggle.textContent = expanded ? "Show less" : "Read more";
        syncDescriptionToggle();
      });
    }
    const seoFallback=$("seoMovieContent");if(seoFallback)seoFallback.remove();const routeFallback=$("seoRouteFallback");if(routeFallback)routeFallback.remove();
    $("commentSort").value = commentSort;
    const play = () => mountPlayer({ userInitiated: true });
    $("posterPlay").addEventListener("click", play);
    $("posterPlay").addEventListener("keydown", e => { if (e.key === "Enter") play(); });
    const watchButton = $("watchBtn");
    if (watchButton) watchButton.addEventListener("click", play);
    $("playerCover").addEventListener("click", play);
    $("commentSort").addEventListener("change", e => { commentSort = e.target.value; loadComments(); });
    $("commentForm").addEventListener("submit", postComment);
    if (autoplay && !isMobilePlayer()) mountPlayer({ userInitiated: false });
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
        <article class="comment"><header><a href="${moviePath({id:c.movie_id,title_en:c.title_en})}"><b>${esc(c.title_en)}</b></a><time>${new Date(c.created_at).toLocaleString()}</time></header><p>${esc(c.comment)}</p></article>`).join("")
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

async function route(){
 stopActivePlayback();
 const path=location.pathname.replace(/\/+$/,"")||"/";
 const match=path.match(/^\/movies\/([1-9][0-9]*)(?:\/[^/]+)?$/);
 let parts=match?["movie",match[1],new URLSearchParams(location.search).get("play")==="1"?"play":""]:location.hash.replace(/^#\/?/,"").split("/").filter(Boolean);
 let view="home";
 if(match||(parts[0]==="movie"&&/^[0-9]+$/.test(parts[1]||"")))view="movie";
 else if(path==="/movies"||parts[0]==="movies")view="movies";
 else if(path==="/genres"||parts[0]==="genres")view="genres";
 else if(path==="/about"||parts[0]==="about")view="about";
 else if(parts[0]==="reset-password")view="reset-password";
 else if(parts[0]==="profile")view="profile";
 const meta={
 home:["NoAdFrame — Watch. Enjoy. No Ads.","NoAdFrame helps you discover movies, IMDb ratings, film details, genres and community conversations.","/"],
 movies:["Browse Movies — NoAdFrame","Browse the NoAdFrame movie catalogue by title, genre, release year and IMDb rating.","/movies"],
 genres:["Movie Genres — NoAdFrame","Explore movie genres on NoAdFrame and discover films by category.","/genres"],
 about:["About NoAdFrame — Watch. Enjoy. No Ads.","Learn about NoAdFrame, a movie discovery website with IMDb ratings, film details and community comments.","/about"],
 profile:["Your Profile — NoAdFrame","Manage your NoAdFrame account.","/",true],
 "reset-password":["Reset Password — NoAdFrame","Reset your NoAdFrame account password.","/",true]
 };
 if(view!=="movie"){const x=meta[view]||meta.home;updatePageSeo({title:x[0],description:x[1],path:x[2],noindex:!!x[3]});}
 if(location.pathname==="/"&&["movies","genres","about"].includes(parts[0]))history.replaceState(null,"","/"+parts[0]);
 document.querySelectorAll(".view").forEach(el=>{el.hidden=el.dataset.view!==view;});
 document.querySelectorAll("[data-nav]").forEach(a=>a.classList.toggle("active",a.dataset.nav===(view==="movie"?"movies":view)));
 window.scrollTo(0,0);if(view!=="movies"&&view!=="movie")$("searchInput").value=state.filters.q;
 try{
 if(view==="home")await showHome();
 else if(view==="movies"){await showMovies();$("seoRouteFallback")?.remove();}
 else if(view==="genres"){await showGenres();$("seoRouteFallback")?.remove();}
 else if(view==="about")$("seoRouteFallback")?.remove();
 else if(view==="profile")await showProfile();
 else if(view==="movie")await showMovie(parts[1],parts[2]==="play"||new URLSearchParams(location.search).get("play")==="1");
 else if(view==="reset-password")showResetPassword();
 }finally{dismissBootScreen();}
}
window.addEventListener("hashchange", route);
window.addEventListener("popstate", route);
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
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    exitMobilePlayerFullscreen();
    closeAuth();
    $("chatPanel").classList.remove("open");
    $("searchForm").classList.remove("is-open");
  }
});
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
