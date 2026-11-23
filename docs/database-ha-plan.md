# NoAdFrame database high-availability plan

## Non-negotiable data-preservation objective

**No production data may be deleted, overwritten, truncated, or abandoned during migration, replication, failover, or rollback.** Data preservation takes priority over automatic failover and write availability.

A two-database asynchronous design cannot mathematically promise zero data loss if the primary is permanently destroyed while it contains writes not yet replicated. Therefore this project must never label an asynchronous secondary as zero-loss protection. Enzonic may only be promoted after its replication checkpoint proves it has every acknowledged primary transaction. If that cannot be proved, keep writes stopped/read-only and recover the primary or restore from a verified independent backup and change log. Never promote a potentially stale copy just to bring the site online faster.

## Target topology

- **Primary:** TiDB Cloud. The website and Admin Panel read and write here.
- **Secondary:** Enzonic MySQL on a different provider/failure domain. It receives ordered replication from TiDB and is the standby.
- **Single writer:** TiDB is the only normal write target. Do not dual-write application requests to both databases.
- **Independent recovery copies:** maintain encrypted, versioned backups outside both database providers, plus provider-supported point-in-time recovery where available.
- **Failover:** promote Enzonic only after a verifiable zero-lag checkpoint for all acknowledged writes. Never switch back automatically merely because Enzonic is reachable.

## Current state (before cutover)

Both the NoAdFrame website and Admin Panel currently use a single `DATABASE_URL`. This branch is preparation only: it does not change production connection strings, run migrations, copy data, or alter active Render services.

The Enzonic recovery monitor in the separate `geo_dubber` repository only tests connectivity and sends recovery notifications. It is not a backup, replication, or failover mechanism.

## Required Render environment after implementation

| Variable | Purpose |
| --- | --- |
| `PRIMARY_DATABASE_URL` | TiDB Cloud connection string |
| `PRIMARY_DB_SSL` | TLS for TiDB; keep enabled |
| `SECONDARY_DATABASE_URL` | Enzonic MySQL connection string |
| `SECONDARY_DB_SSL` | TLS for Enzonic; keep enabled |
| `DB_REPLICATION_ENABLED` | Explicit switch for the replication worker |

Configure credentials independently in the website and Admin Panel Render services. Never put connection strings in GitHub, source files, logs, or chat. Keep legacy `DATABASE_URL` active until both applications are prepared and deployment is deliberately coordinated.

## Mandatory backup and restore controls

1. Before any schema change, data copy, connection-string switch, or failover, create a fresh full backup of the current authoritative database.
2. Keep at least one encrypted backup/export outside both TiDB and Enzonic. A copy stored only in the same provider/account is not an independent disaster-recovery copy.
3. Enable the providers' available automated backups and point-in-time recovery where supported; record retention windows and test that recovery points can actually be restored.
4. Keep immutable, timestamped backup generations. Never overwrite the only known-good backup with a newer unverified one.
5. Record backup time, source database identity, schema version, table counts, export size, and cryptographic SHA-256 checksum. Keep the matching manifest beside each backup.
6. Perform a restore drill into an isolated test database before relying on a backup. A successful export alone is not proof that it can be restored.
7. Retain the original Enzonic production database untouched and recoverable after cutover for an agreed retention period. Do not delete it after a successful deployment.

No migration or cutover begins unless a fresh backup exists, its checksum is verified, and a restore test has succeeded.

## Replication design requirements

Use a transactional outbox/change-log pattern on the primary. Each application mutation and its corresponding replication event must commit in the same TiDB transaction. A worker applies ordered events to Enzonic.

- Use stable event IDs, ordered sequence/checkpoints, idempotent apply, and delete/tombstone events.
- Record the last committed primary sequence and last successfully applied secondary sequence.
- Track oldest pending event, last success time, replication lag, failures, and queue size; alert before backlog becomes critical.
- Preserve transaction ordering across the website and Admin Panel.
- Cover every write path, including SQL changes made from both applications, admin operations, banner images/blobs, comments, users, security records, settings, and dynamically created tables.
- Apply versioned schema migrations to both databases before enabling code that depends on the new schema.
- Do not make a user request wait for Enzonic in the normal asynchronous design. If Enzonic is unavailable, continue on TiDB only while independent backups/change-log durability and monitored recovery conditions remain satisfied.
- Do not use Enzonic as an automatic read fallback while its lag or schema version is unknown.
- Do not use ad-hoc dual writes, periodic copies without delete tracking, or best-effort secondary queries.

**Critical limitation:** if writes continue on TiDB while Enzonic is offline, those writes exist only on TiDB until replication catches up. If TiDB is then permanently lost before the queue reaches Enzonic, asynchronous replication alone cannot guarantee zero data loss. To uphold strict zero-loss acknowledgement even during a secondary outage, the design must synchronously persist every acknowledged transaction in an independent durable journal/quorum before confirming the write; if that durable copy is unavailable, writes must pause or become read-only. Do not silently weaken this rule.

## Safe initial migration / cutover sequence after Enzonic recovery

1. Confirm Enzonic is stable over repeated checks; identify the exact source database and make a fresh encrypted backup/export plus manifest.
2. Keep Enzonic as the authoritative source while importing a consistent snapshot into a new/empty TiDB database. Never import over an unverified production dataset.
3. Compare all tables, schemas, primary keys, row counts, and deterministic chunk hashes. Include binary/blob columns and admin settings. Row-count equality alone is not sufficient.
4. Run read-only checks and application smoke tests against TiDB in an isolated/test deployment.
5. Pause all writes briefly. Create a final consistent delta/export, apply it to TiDB, then repeat complete verification. Record source and target checkpoints.
6. Keep the original Enzonic database intact and make it read-only if the provider supports it. Preserve a fresh backup and a tested rollback route.
7. Change both Render services (website and Admin Panel) to TiDB as primary in a coordinated deployment. Never switch only one application.
8. Verify login, registration, password reset, comments, movie catalogue, all admin create/update/delete actions, banners/images, settings, security and report records, and all database-backed endpoints.
9. Keep the old Enzonic source untouched during the observation/rollback window. Do not accept new production writes into it after cutover.
10. Only after TiDB is confirmed authoritative and its backup/restore process works, initialize Enzonic as the secondary from a fresh TiDB snapshot, then start replication at a recorded checkpoint.
11. Verify that the secondary reaches the exact primary checkpoint and run a controlled restore/failover rehearsal. Do not claim standby readiness before that test passes.

## Failover and rollback rules

- Normal operation: TiDB is the only writer; Enzonic is the replicated standby.
- Enzonic outage: continue on TiDB only while the independent durable recovery journal/backups are healthy and lag is monitored. Alert; queue replication safely.
- TiDB outage: stop writes or enter read-only/maintenance mode unless Enzonic is proved to contain every acknowledged transaction. Never promote based only on successful connectivity.
- If replication lag is non-zero or unknown: **do not promote Enzonic**. Recover TiDB or restore from a verified independent backup/change log first.
- Promotion: freeze writes, verify checkpoint equality and schema version, take a fresh recovery copy, explicitly promote Enzonic, then change both applications together.
- Rollback after cutover: do not point applications back at the old pre-cutover Enzonic copy. First reconcile all post-cutover writes back to the intended target, verify them, take a backup, and only then switch both services.
- Return to TiDB after a promotion: resynchronize in the opposite direction from the current authoritative writer; do not simply point applications back at TiDB.

## Verification helper

Run `npm run verify:database-pair` only with `PRIMARY_DATABASE_URL` and `SECONDARY_DATABASE_URL` set in a secure environment. The current helper opens consistent read snapshots, inventories every base table, checks ordered primary-key definitions and column metadata, and computes deterministic SHA-256 hashes over every row and column (including binary/blob values). It fails on missing/extra tables, row-count differences, schema-column differences, primary-key differences, or data-hash differences. Both databases must be quiesced during the comparison so the snapshots represent the same logical point in time.

This helper is read-only. It does not export, import, replicate, compare every secondary index/foreign-key/trigger/routine definition, prove a backup is restorable, or authorize cutover. A successful result is one verification gate only; independent encrypted backup/restore testing and application smoke tests remain mandatory.

The application-owned tables identified in the current code include `users`, `movies`, `comments`, `ai_feedback`, `site_banner`, `site_banners`, `site_home_sections`, and `admin_security_events`. This is an observed inventory, not a hard-coded allowlist: the verifier enumerates all base tables dynamically so newly added tables are not silently skipped.

## Required acceptance gates

The database migration is not complete until all of these pass:

- [ ] Fresh encrypted source backup and independent off-provider copy exist.
- [ ] Backup checksums match and a restore drill succeeds.
- [ ] Every source table, row, primary key, blob and relevant record is verified in TiDB.
- [ ] Final writes are frozen and the last delta is applied before cutover.
- [ ] Both website and Admin Panel point to TiDB together.
- [ ] Login, registration, password reset, comments, movie reads, all admin mutations, settings, images and security workflows pass.
- [ ] Enzonic's post-cutover replica reaches the exact TiDB checkpoint.
- [ ] No promotion is allowed while lag is non-zero or unknown.
- [ ] Failover and rollback drills have been completed without losing acknowledged data.
- [ ] The original Enzonic source and independent backups remain retained under a documented retention policy.

## Not yet completed

This branch is preparation only. It does not yet implement the outbox/change-log, replication worker, independent immutable backup pipeline, hash-based verifier, synchronous zero-loss journal/quorum, failover, or production cutover. No live database has been modified by this preparation branch.
