"use strict";

const INCREMENT_SCRIPT = [
  "local hits = redis.call('INCR', KEYS[1])",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "if hits == 1 or ttl < 0 then",
  "  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
  "  ttl = tonumber(ARGV[1])",
  "end",
  "return { hits, ttl }"
].join("\n");

const DECREMENT_SCRIPT = [
  "local hits = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if hits <= 0 then return 0 end",
  "return redis.call('DECR', KEYS[1])"
].join("\n");

/**
 * Shared express-rate-limit store using Upstash Redis REST.
 * Each increment is atomic (one short Lua script), so counters are shared
 * across app instances without adding a native Redis client dependency.
 */
class UpstashRateLimitStore {
  constructor({ url, token, prefix = "noadframe:rate-limit:", timeoutMs = 2500 }) {
    if (!url || !token) throw new Error("Upstash REST URL and token are required.");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("UPSTASH_REDIS_REST_URL must be a clean HTTPS URL.");
    }

    this.url = parsed.toString().replace(/\/$/, "");
    this.token = token;
    this.prefix = prefix;
    this.timeoutMs = timeoutMs;
    this.windowMs = 0;
  }

  init(options) {
    this.windowMs = Number(options.windowMs);
    if (!Number.isSafeInteger(this.windowMs) || this.windowMs < 1) {
      throw new Error("Rate-limit windowMs must be a positive integer.");
    }
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Upstash rate-limit store returned an invalid response.");
    }
    if (!response.ok || payload?.error !== undefined) {
      throw new Error(`Upstash rate-limit store failed (HTTP ${response.status}).`);
    }
    return payload.result;
  }

  async increment(key) {
    if (!this.windowMs) throw new Error("Upstash rate-limit store was not initialized.");
    const result = await this.command([
      "EVAL",
      INCREMENT_SCRIPT,
      "1",
      `${this.prefix}${key}`,
      String(this.windowMs)
    ]);
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error("Upstash rate-limit store returned an invalid counter.");
    }

    const totalHits = Number(result[0]);
    const ttl = Number(result[1]);
    if (!Number.isSafeInteger(totalHits) || totalHits < 1 || !Number.isFinite(ttl) || ttl < 0) {
      throw new Error("Upstash rate-limit store returned invalid counter values.");
    }
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key) {
    await this.command(["EVAL", DECREMENT_SCRIPT, "1", `${this.prefix}${key}`]);
  }

  async resetKey(key) {
    await this.command(["DEL", `${this.prefix}${key}`]);
  }
}

module.exports = { UpstashRateLimitStore };
