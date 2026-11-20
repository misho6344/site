"use strict";
const mysql = require("mysql2/promise");

function targetConfig() {
  const raw = process.env.RESTORE_DATABASE_URL;
  if (!raw) throw new Error("Missing RESTORE_DATABASE_URL.");
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !url.hostname.endsWith(".tidbcloud.com") || Number(url.port || 3306) !== 4000) {
    throw new Error("Safety stop: target must be the approved TiDB Cloud endpoint.");
  }
  const mode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (!["REQUIRED", "VERIFY_IDENTITY"].includes(mode)) throw new Error("TLS must be required.");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== "noadframe") throw new Error("Safety stop: unexpected target database.");
  return { host:url.hostname, port:4000, user:decodeURIComponent(url.username), password:decodeURIComponent(url.password),
    database, ssl:{rejectUnauthorized:true}, connectTimeout:20000 };
}

// Safe by default. Only missing tables are created; existing tables/rows are untouched.
// Set APPLY_SCHEMA=true only after a verified backup and explicit approval.
const statements = [
["users","CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, username VARCHAR(80) NOT NULL, email VARCHAR(254) NOT NULL, password VARCHAR(255) NOT NULL, password_reset_token_hash CHAR(64) DEFAULT NULL, password_reset_expires_at DATETIME DEFAULT NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY username (username), UNIQUE KEY email (email)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"],
["comments","CREATE TABLE IF NOT EXISTS comments (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id BIGINT UNSIGNED NOT NULL, movie_id BIGINT UNSIGNED NOT NULL, comment VARCHAR(1200) NOT NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_comments_movie (movie_id, created_at), KEY fk_comment_user (user_id), CONSTRAINT fk_comment_movie FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE, CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"],
["ai_feedback","CREATE TABLE IF NOT EXISTS ai_feedback (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id BIGINT UNSIGNED DEFAULT NULL, message VARCHAR(1500) NOT NULL, reply TEXT, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"],
["copyright_reports","CREATE TABLE IF NOT EXISTS copyright_reports (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, notice_type VARCHAR(30) NOT NULL, reporter_name VARCHAR(255) NOT NULL, reporter_identifier VARCHAR(120) NOT NULL, reporter_address TEXT NOT NULL, reporter_phone VARCHAR(80) NOT NULL, reporter_email VARCHAR(254) NOT NULL, work_description TEXT NOT NULL, claim_basis TEXT NOT NULL, reported_urls TEXT NOT NULL, supporting_url TEXT, status VARCHAR(30) NOT NULL DEFAULT 'received', admin_note TEXT, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, handled_at DATETIME DEFAULT NULL, PRIMARY KEY (id), KEY idx_copyright_reports_status (status, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"],
["admin_security_events","CREATE TABLE IF NOT EXISTS admin_security_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, event_type VARCHAR(40) NOT NULL, severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info', ip_address VARCHAR(45) NOT NULL, email_hash CHAR(64) DEFAULT NULL, email_hint VARCHAR(254) DEFAULT NULL, user_agent VARCHAR(512) DEFAULT NULL, details VARCHAR(1000) DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_admin_security_created (created_at), KEY idx_admin_security_type_created (event_type, created_at), KEY idx_admin_security_ip_type_created (ip_address, event_type, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]
];

async function main() {
  const apply = String(process.env.APPLY_SCHEMA || "").toLowerCase() === "true";
  const db = await mysql.createConnection(targetConfig());
  try {
    const [rows] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_TYPE='BASE TABLE'");
    const existing = new Set(rows.map(row => row.name));
    const missing = statements.filter(([name]) => !existing.has(name));
    console.log(JSON.stringify({mode:apply?"APPLY_MISSING_TABLES_ONLY":"DRY_RUN",target:"TiDB Cloud / noadframe",
      existingTablesUntouched:[...existing].sort(),missingTables:missing.map(([name])=>name),historicalAdminSecurityEventsCopied:false},null,2));
    if (!apply) { console.log("DRY RUN ONLY. No schema changes made."); return; }
    for (const [name,sql] of missing) { await db.query(sql); console.log("Created missing table:",name); }
    console.log("Schema step complete. No application rows copied, updated, or deleted.");
  } finally { await db.end(); }
}
main().catch(error=>{console.error("[SCHEMA PREPARATION FAILED]",error.message);process.exitCode=1;});
