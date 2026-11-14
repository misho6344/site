const crypto = require("crypto");

const SESSION_COOKIE = "noadframe_session";
const CSRF_COOKIE = "noadframe_csrf";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return null;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { return [key, decodeURIComponent(value)]; } catch { return [key, value]; }
  }).filter(Boolean));
}
function cookieOptions(production, maxAge = SESSION_MAX_AGE) {
  return { httpOnly: true, secure: !!production, sameSite: "Lax", path: "/", maxAge };
}
function createResetToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashResetToken(token) };
}
function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
function isResetTokenValid(expiresAt, now = Date.now()) {
  const expiry = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now;
}
function csrfMatches(cookieToken, headerToken) {
  if (typeof cookieToken !== "string" || typeof headerToken !== "string" || !cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken); const b = Buffer.from(headerToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validPassword(password) {
  return typeof password === "string" && password.length >= 10 && password.length <= 72 && /[a-z]/i.test(password) && /[0-9]/.test(password);
}
module.exports = { SESSION_COOKIE, CSRF_COOKIE, SESSION_MAX_AGE, parseCookies, cookieOptions, createResetToken, hashResetToken, isResetTokenValid, csrfMatches, validPassword };