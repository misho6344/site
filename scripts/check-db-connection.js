require("dotenv").config();

const { checkDatabaseConnection } = require("../lib/db");

async function main() {
  const result = await checkDatabaseConnection();
  console.log("[DB CHECK] Connection successful.");
  console.log("[DB CHECK] Database:", result.databaseName || "unknown");
  console.log("[DB CHECK] Server version:", result.serverVersion || "unknown");
}

main().catch(error => {
  console.error("[DB CHECK] Connection failed:", error.code || error.message);
  process.exitCode = 1;
});
