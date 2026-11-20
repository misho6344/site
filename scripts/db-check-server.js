require("dotenv").config();

const express = require("express");
const { checkDatabaseConnection } = require("../lib/db");

const app = express();
const port = Number(process.env.PORT || 3000);
let checkStatus = "pending";

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, mode: "read-only-db-connection-test", checkStatus });
});

const server = app.listen(port, () => {
  console.log("[DB TEST] Isolated connection-test service started. No schema initialization or data writes will run.");
  checkDatabaseConnection()
    .then(result => {
      checkStatus = "passed";
      console.log("[DB TEST] Connection successful.");
      console.log("[DB TEST] Database:", result.databaseName || "unknown");
      console.log("[DB TEST] Server version:", result.serverVersion || "unknown");
    })
    .catch(error => {
      checkStatus = "failed";
      console.error("[DB TEST] Connection failed:", error.code || error.message);
    });
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
