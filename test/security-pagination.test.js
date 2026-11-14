const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parsePagination, paginationMeta, DEFAULT_LIMIT, MAX_LIMIT } = require("../lib/pagination");
const { SESSION_COOKIE, CSRF_COOKIE, parseCookies, cookieOptions, createResetToken, hashResetToken, isResetTokenValid, csrfMatches, validPassword } = require("../lib/auth-security");

const root = path.join(__dirname, "..");
function javascriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "node_modules" || entry.name === ".git") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return javascriptFiles(full);
    return entry.isFile() && full.endsWith(".js") ? [full] : [];
  });
}
test("all repository JavaScript files parse", () => {
  const files = javascriptFiles(root);
  assert.ok(files.length >= 5);
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, path.relative(root, file) + ": " + (result.stderr || result.stdout));
  }
});
test("pagination defaults and clamps limit safely", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: DEFAULT_LIMIT, offset: 0 });
  assert.deepEqual(parsePagination({ page: "3", limit: "500" }), { page: 3, limit: MAX_LIMIT, offset: 200 });
});
test("pagination rejects malformed, zero, negative, repeated and unsafe integers", () => {
  const invalid = [{ page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "x" }, { page: ["1", "2"] }, { limit: "0" }, { limit: "9007199254740992" }];
  for (const query of invalid) assert.throws(() => parsePagination(query), error => error.status === 400);
});
test("pagination response metadata covers multiple and zero result edge cases", () => {
  assert.deepEqual(paginationMeta(2, 24, 49), { page: 2, limit: 24, total: 49, totalPages: 3 });
  assert.deepEqual(paginationMeta(1, 24, 0), { page: 1, limit: 24, total: 0, totalPages: 0 });
});
test("session cookie is HttpOnly, SameSite=Lax and Secure only in production", () => {
  assert.equal(parseCookies(SESSION_COOKIE + "=abc; " + CSRF_COOKIE + "=xyz")[SESSION_COOKIE], "abc");
  assert.equal(cookieOptions(true).httpOnly, true);
  assert.equal(cookieOptions(true).secure, true);
  assert.equal(cookieOptions(false).secure, false);
  assert.equal(cookieOptions(true).sameSite, "Lax");
});
test("CSRF double-submit comparison rejects missing and mismatched tokens", () => {
  assert.equal(csrfMatches("abc", "abc"), true);
  assert.equal(csrfMatches("abc", "abd"), false);
  assert.equal(csrfMatches("abc", undefined), false);
});
test("reset tokens are random, hashed, expire and enforce password policy", () => {
  const reset = createResetToken();
  assert.ok(reset.token.length >= 40);
  assert.equal(reset.hash, hashResetToken(reset.token));
  assert.notEqual(reset.hash, reset.token);
  assert.equal(isResetTokenValid(new Date(Date.now() + 60000)), true);
  assert.equal(isResetTokenValid(new Date(Date.now() - 1)), false);
  assert.equal(validPassword("StrongerPass123"), true);
  assert.equal(validPassword("short1"), false);
});
test("reset endpoint atomically requires unexpired token and clears it after use", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(source.includes("password_reset_expires_at > UTC_TIMESTAMP()"));
  assert.ok(source.includes("password_reset_token_hash = NULL, password_reset_expires_at = NULL"));
});
test("catalogue endpoint combines title search, filters, count, sort and SQL pagination", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  for (const fragment of ["req.query.q ?? req.query.title", "SELECT COUNT(*) AS total FROM movies m WHERE", "m.genre LIKE ?", "m.release_year = ?", "m.imdb_rating >= ?", "LIMIT ? OFFSET ?", "paginationMeta(safePage, limit, total)"]) assert.ok(source.includes(fragment), fragment);
});
test("browser client does not read or write auth tokens in localStorage", () => {
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.ok(!app.includes("localStorage.getItem(\"noadframe_token\""));
  assert.ok(!app.includes("localStorage.setItem(\"noadframe_user\""));
  assert.ok(app.includes("X-CSRF-Token"));
  assert.ok(app.includes("credentials: \"same-origin\""));
});
test("database schema and migration add password reset hash and expiry columns", () => {
  const schema = fs.readFileSync(path.join(root, "sql/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(root, "lib/migrate.js"), "utf8");
  for (const source of [schema, migration]) {
    assert.ok(source.includes("password_reset_token_hash"));
    assert.ok(source.includes("password_reset_expires_at"));
  }
});
test("server reads cookie sessions and validates CSRF for cookie-auth requests", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(source.includes("req.cookies?.[SESSION_COOKIE]"));
  assert.ok(source.includes("jwt.verify(token, process.env.JWT_SECRET)"));
  assert.ok(source.includes("clearSessionCookie(res)"));
  assert.ok(source.includes("csrfMatches(req.cookies[CSRF_COOKIE], csrf)"));
});
test("catalogue cache key varies on the full query string including page and filters", () => {
  const cache = fs.readFileSync(path.join(root, "public/cache.js"), "utf8");
  assert.ok(cache.includes("PREFIX + url.pathname + url.search"));
  assert.ok(cache.includes('url.pathname === "/api/movies"'));
});
test("catalogue UI renders previous/next/page numbers and resets after filters", () => {
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.ok(app.includes("function renderPagination()"));
  assert.ok(app.includes("Previous"));
  assert.ok(app.includes("Next"));
  assert.ok(app.includes("state.page = 1;"));
});
test("forgot-password always returns the same generic response without account lookup disclosure", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const start = source.indexOf('app.post("/api/auth/forgot-password"');
  const end = source.indexOf('app.post("/api/auth/reset-password"');
  const handler = source.slice(start, end);
  assert.equal((handler.match(/res[.]json[(]/g) || []).length, 1);
  assert.ok(handler.includes("If an account exists for that email"));
});
test("GitHub Actions runs npm ci and npm test with read-only repository permissions", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/test.yml"), "utf8");
  assert.ok(workflow.includes("pull_request:"));
  assert.ok(workflow.includes("branches: [main]"));
  assert.ok(workflow.includes("contents: read"));
  assert.ok(workflow.includes("run: npm ci"));
  assert.ok(workflow.includes("run: npm test"));
});


test("Upstash rate-limit store performs an atomic shared increment and returns its expiry", async () => {
  const { UpstashRateLimitStore } = require("../lib/upstash-rate-limit-store");
  const originalFetch = global.fetch;
  let request;
  try {
    global.fetch = async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ result: [4, 45000] }) };
    };
    const store = new UpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "test-token",
      prefix: "test:limit:"
    });
    store.init({ windowMs: 60000 });
    const result = await store.increment("192.0.2.1");
    assert.equal(result.totalHits, 4);
    assert.ok(result.resetTime instanceof Date);
    assert.ok(result.resetTime.getTime() >= Date.now() + 44000);
    assert.equal(request.url, "https://example.upstash.io");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.equal(request.body[0], "EVAL");
    assert.equal(request.body[2], "1");
    assert.equal(request.body[3], "test:limit:192.0.2.1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Upstash rate-limit store fails closed when Redis reports an error", async () => {
  const { UpstashRateLimitStore } = require("../lib/upstash-rate-limit-store");
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid token" }) });
    const store = new UpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "invalid-token"
    });
    store.init({ windowMs: 60000 });
    await assert.rejects(store.increment("192.0.2.2"), /failed \(HTTP 401\)/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("server applies global and API limits before parsing request bodies and configures slow-request timeouts", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(source.includes('const globalLimiter = limiter("global"'));
  assert.ok(source.includes('const apiLimiter = limiter("api"'));
  assert.ok(source.indexOf("app.use(globalLimiter)") < source.indexOf("app.use(express.json"));
  assert.ok(source.includes('app.use("/api", apiLimiter)'));
  assert.ok(source.includes("server.headersTimeout = 10_000"));
  assert.ok(source.includes("server.requestTimeout = 30_000"));
  assert.ok(source.includes("server.maxHeadersCount = 50"));
  assert.ok(source.includes("ORIGIN_ACCESS_TOKEN"));
  assert.ok(source.includes("UPSTASH_REDIS_REST_URL"));
});
