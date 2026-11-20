const test = require("node:test");
const assert = require("node:assert/strict");
const { createFailoverRouter, isReadOnlySql } = require("../lib/database-failover");

const offline = () => Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
const quietLogger = { info() {}, warn() {}, error() {} };

function fixture({ primaryFails = false, primaryError = null, backupFresh = true, backupFails = false } = {}) {
  const calls = { primary: [], backup: [], modes: [] };
  const primaryPool = {
    async query(sql, ...args) {
      calls.primary.push({ sql, args });
      if (primaryError) throw primaryError;
      if (primaryFails) throw offline();
      return [{ source: "primary" }];
    },
    async end() {}
  };
  const backupPool = {
    async query(sql, ...args) {
      calls.backup.push({ sql, args });
      if (backupFails) throw offline();
      return [{ source: "backup" }];
    },
    async end() {}
  };
  const router = createFailoverRouter({
    primaryPool,
    backupPool,
    isTransientDbFailure: error => error?.code === "ECONNRESET",
    isBackupSnapshotFresh: async () => backupFresh,
    onModeChange: mode => calls.modes.push(mode),
    logger: quietLogger
  });
  return { router, calls };
}

test("recognizes read-only statements and rejects locking reads", () => {
  assert.equal(isReadOnlySql("SELECT * FROM movies"), true);
  assert.equal(isReadOnlySql({ sql: "SHOW TABLES" }), true);
  assert.equal(isReadOnlySql("SELECT * FROM movies FOR UPDATE"), false);
  assert.equal(isReadOnlySql("UPDATE movies SET title = 'x'"), false);
  assert.equal(isReadOnlySql("INSERT INTO movies(id) VALUES (1)"), false);
  assert.equal(isReadOnlySql("DELETE FROM movies"), false);
});

test("uses primary for normal reads and writes", async () => {
  const { router, calls } = fixture();
  assert.deepEqual(await router.query("SELECT 1"), [{ source: "primary" }]);
  assert.deepEqual(await router.query("UPDATE movies SET title = ?", "x"), [{ source: "primary" }]);
  assert.equal(calls.backup.length, 0);
  assert.equal(router.mode, "primary");
});

test("routes transient read-only query to fresh backup", async () => {
  const { router, calls } = fixture({ primaryFails: true, backupFresh: true });
  assert.deepEqual(await router.query("SELECT * FROM movies WHERE id = ?", 7), [{ source: "backup" }]);
  assert.equal(calls.backup.length, 1);
  assert.equal(calls.backup[0].args[0], 7);
  assert.equal(router.mode, "backup-read-only");
});

test("never routes writes or locking reads to backup", async () => {
  const { router, calls } = fixture({ primaryFails: true });
  await assert.rejects(router.query("UPDATE movies SET title = ?", "x"), { code: "ECONNRESET" });
  await assert.rejects(router.query("SELECT * FROM movies FOR UPDATE"), { code: "ECONNRESET" });
  assert.equal(calls.backup.length, 0);
});

test("refuses fallback when snapshot is stale", async () => {
  const { router, calls } = fixture({ primaryFails: true, backupFresh: false });
  await assert.rejects(router.query("SELECT * FROM movies"), { code: "ECONNRESET" });
  assert.equal(calls.backup.length, 0);
  assert.equal(router.mode, "unavailable");
});

test("returns to primary after recovery and allows writes there", async () => {
  let primaryFails = true;
  const calls = { primary: [], backup: [], modes: [] };
  const primaryPool = {
    async query(sql) {
      calls.primary.push(sql);
      if (primaryFails) throw offline();
      return [{ source: "primary" }];
    },
    async end() {}
  };
  const backupPool = {
    async query(sql) {
      calls.backup.push(sql);
      return [{ source: "backup" }];
    },
    async end() {}
  };
  const router = createFailoverRouter({
    primaryPool, backupPool,
    isTransientDbFailure: error => error?.code === "ECONNRESET",
    isBackupSnapshotFresh: async () => true,
    onModeChange: mode => calls.modes.push(mode),
    logger: quietLogger
  });

  assert.deepEqual(await router.query("SELECT 1"), [{ source: "backup" }]);
  assert.equal(router.mode, "backup-read-only");

  primaryFails = false;
  assert.deepEqual(await router.query("UPDATE movies SET title = 'recovered'"), [{ source: "primary" }]);
  assert.equal(router.mode, "primary");
  assert.deepEqual(calls.modes, ["backup-read-only", "primary"]);
  assert.equal(calls.backup.length, 1);
});

test("does not fallback on non-connection SQL errors", async () => {
  const sqlError = Object.assign(new Error("bad SQL"), { code: "ER_PARSE_ERROR" });
  const { router, calls } = fixture({ primaryError: sqlError });
  await assert.rejects(router.query("SELECT broken"), { code: "ER_PARSE_ERROR" });
  assert.equal(calls.backup.length, 0);
});
