/* Small stale-while-revalidate cache for public catalog GET endpoints. */
(() => {
  "use strict";
  const PREFIX = "noadframe_api_cache_v3:";
  // Remove the previous catalog cache so stale ordering/data cannot survive the release.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("noadframe_api_cache_v2:")) localStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable; the new cache namespace still bypasses old entries. */ }
  const TTL_MS = 10 * 60 * 1000;
  const originalFetch = window.fetch.bind(window);
  const refreshing = new Map();
  const cacheable = new Set(["/api/movies/categories", "/api/genres"]);

  function cacheKey(url) {
    if (cacheable.has(url.pathname)) return PREFIX + url.pathname + url.search;
    if (url.pathname === "/api/movies") return PREFIX + url.pathname + url.search;
    if (/^\/api\/movies\/\d+$/.test(url.pathname)) return PREFIX + url.pathname;
    return null;
  }
  function read(key) {
    try {
      const item = JSON.parse(localStorage.getItem(key) || "null");
      return item && item.data && Number.isFinite(item.savedAt) ? item : null;
    } catch { return null; }
  }
  function save(key, data) {
    try {
      const serialized = JSON.stringify({ savedAt: Date.now(), data });
      if (serialized.length < 1_500_000) localStorage.setItem(key, serialized);
    } catch { /* Storage can be disabled or full; network requests still work. */ }
  }
  async function fetchAndStore(key, input, init) {
    const response = await originalFetch(input, init);
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      if (data && typeof data === "object") save(key, data);
    }
    return response;
  }
  window.fetch = async function cachedFetch(input, init = {}) {
    let url;
    try { url = new URL(input instanceof Request ? input.url : input, location.href); }
    catch { return originalFetch(input, init); }
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const key = url.origin === location.origin && method === "GET" ? cacheKey(url) : null;
    if (!key) return originalFetch(input, init);

    const cached = read(key);
    if (cached) {
      if (!refreshing.has(key)) {
        const task = fetchAndStore(key, input, init).catch(() => {}).finally(() => refreshing.delete(key));
        refreshing.set(key, task);
      }
      // Return the cached catalog immediately; network refresh updates the next visit.
      // Expired data is still useful as an offline fallback.
      const headers = new Headers({ "Content-Type": "application/json", "X-NoAdFrame-Cache": Date.now() - cached.savedAt < TTL_MS ? "HIT" : "STALE" });
      return new Response(JSON.stringify(cached.data), { status: 200, headers });
    }
    return fetchAndStore(key, input, init);
  };
})();
