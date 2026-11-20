const READ_ONLY_SQL = /^(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i;

function isReadOnlySql(sql) {
  const statement = typeof sql === "string" ? sql.trimStart() : String(sql?.sql || "").trimStart();
  return READ_ONLY_SQL.test(statement) && !/\bFOR\s+(UPDATE|SHARE)\b/i.test(statement);
}

function createFailoverRouter({
  primaryPool,
  backupPool,
  isTransientDbFailure,
  isBackupSnapshotFresh,
  onModeChange = () => {},
  logger = console
}) {
  let mode = "primary";

  return {
    get mode() {
      return mode;
    },
    async query(sql, ...args) {
      try {
        const result = await primaryPool.query(sql, ...args);
        if (mode !== "primary") {
          mode = "primary";
          onModeChange(mode);
          logger.info("[DB] Primary TiDB connection recovered; writes are enabled again.");
        }
        return result;
      } catch (error) {
        if (!isTransientDbFailure(error) || !backupPool || !isReadOnlySql(sql)) throw error;

        if (!(await isBackupSnapshotFresh())) {
          mode = "unavailable";
          onModeChange(mode);
          logger.error("[DB] TiDB unavailable and Enzonic snapshot is missing or older than 20 minutes; refusing stale fallback.");
          throw error;
        }

        try {
          const result = await backupPool.query(sql, ...args);
          if (mode !== "backup-read-only") {
            mode = "backup-read-only";
            onModeChange(mode);
            logger.warn("[DB] TiDB unavailable. Serving read-only queries from Enzonic; all writes remain blocked.");
          }
          return result;
        } catch (backupError) {
          logger.error("[DB] Both primary and backup databases are unavailable.", {
            primary: error?.code || "PRIMARY_CONNECTION_ERROR",
            backup: backupError?.code || "BACKUP_CONNECTION_ERROR"
          });
          throw error;
        }
      }
    },
    async end() {
      await Promise.allSettled([primaryPool?.end(), backupPool?.end()]);
    }
  };
}

module.exports = { createFailoverRouter, isReadOnlySql };
