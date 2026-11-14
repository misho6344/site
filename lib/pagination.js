const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    const error = new Error("Pagination parameters must be positive integers.");
    error.status = 400;
    throw error;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    const error = new Error("Pagination parameters must be positive integers.");
    error.status = 400;
    throw error;
  }
  return Math.min(number, maximum);
}
function parsePagination(query = {}) {
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / limit) + 1;
  const page = parsePositiveInteger(query.page, 1, maxPage);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    const error = new Error("Pagination offset is too large.");
    error.status = 400;
    throw error;
  }
  return { page, limit, offset };
}
function paginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages };
}
module.exports = { DEFAULT_LIMIT, MAX_LIMIT, parsePagination, paginationMeta };