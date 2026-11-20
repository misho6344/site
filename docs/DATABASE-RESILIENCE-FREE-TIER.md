# NoAdFrame database resilience — free-tier plan

## Current verified constraints

- The production website and Admin Panel still run from their `main` branches. No production database URL was changed by this work.
- The TiDB Cloud cluster is Starter in AWS Frankfurt. TiDB Cloud Starter does not provide Changefeed or Data Migration.
- The application currently creates one MySQL pool from `DATABASE_URL`. It has limited transient read retries, but no safe primary/secondary promotion or failback controller.
- The Enzonic database must not be assumed to be a hot standby. Its replication, external-write, availability, and separate-node guarantees have not been verified.

## Safe free-tier operating model

1. Keep one authoritative writer at a time. Never dual-write to both databases.
2. Keep TiDB as the intended primary only after a complete, verified migration and explicit production cutover.
3. Until continuous replication is available, treat Enzonic as a recovery copy, not an automatically promotable replica.
4. Use scheduled, encrypted, off-site backups and periodically test restores. Do not treat a successful backup job as proof of recoverability.
5. Before any promotion, fence the old writer, record the recovery point, verify the backup/replica, and explicitly switch the application to maintenance/read-only mode if consistency cannot be proven.
6. Do not automatically fail back. Reconcile changes made during the incident, verify schema and row-level checksums, then perform a controlled cutback.
7. Monitor both database connectivity and application-level read/write health. A successful TCP connection alone is not sufficient.
8. Keep backup credentials and encryption keys in secret storage; never commit connection strings, dumps, or private user data to Git.

## Data migration scope — approval required

The full source inventory must be reviewed before copying data. The following were previously excluded by the owner and must not be silently re-included:
- user accounts/password hashes
- comments
- AI feedback

The owner has since asked for a complete move except for old history in SEO status, system logs, and security/IP history. Confirm whether the earlier exclusions are still excluded. Future records for SEO status, system logs, and security/IP must be supported after cutover, even though their old history is not migrated.

Preserve the movie catalogue, banner images/binary data, homepage sections, and all other approved application data. Never drop or overwrite existing target data as a migration shortcut.

## Read-only inventory

Run:

```sh
SOURCE_DATABASE_URL='mysql://...' RESTORE_DATABASE_URL='mysql://...' node scripts/inventory-full-database.js
```

The script accepts only an Enzonic source on port 3306 and TiDB Cloud target on port 4000, enforces TLS certificate verification, and only queries metadata and row counts. It reports tables, columns, indexes, primary keys, foreign keys, views, triggers, routines, and events. It does not copy, create, update, or delete database objects or rows.

## Cutover gates

Do not change production `DATABASE_URL` until all gates pass:

- complete read-only inventory reviewed and migration scope confirmed;
- schema compatibility reviewed, including indexes, keys, foreign keys, defaults, binary columns, and auto-increment behavior;
- full snapshot exported and encrypted outside the application repository;
- target load completed without destructive operations;
- row counts and deterministic per-row hashes match for all in-scope tables;
- banner image bytes and homepage section configuration verified;
- application and Admin Panel staging tests pass against TiDB;
- backup restore drill succeeds;
- a written incident runbook defines writer fencing, promotion, reconciliation, and failback;
- explicit owner approval for production cutover.

## Failover guarantee

With TiDB Starter and no continuous changefeed, a free solution cannot honestly promise transparent automatic failover with zero data loss. A scheduled backup can reduce the recovery point, but there will be a non-zero data-loss window. If the site must accept writes during an outage, safe promotion requires a tested replication/reconciliation mechanism and a single-writer fence. Until that exists, fail closed or use read-only/maintenance mode rather than risk split-brain.
