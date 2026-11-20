# NoAdFrame database high-availability plan

## Target topology

- **Primary:** TiDB Cloud. The website and Admin Panel will read and write here.
- **Secondary:** Enzonic MySQL, on a separate provider from TiDB. It will receive asynchronous replication from TiDB and remain available for recovery.
- **Single writer:** TiDB is the only write target during normal operation. Do not dual-write application requests to both databases.
- **Failover:** Promote Enzonic only through a deliberate, verified procedure after TiDB is unavailable and replication lag has been checked. Never switch back automatically merely because Enzonic is reachable.

## Current state (before cutover)

Both the NoAdFrame website and Admin Panel currently use a single `DATABASE_URL`. This branch is preparation only: it does not change production connection strings, run migrations, copy data, or alter the active Render services.

The Enzonic recovery monitor in the separate `geo_dubber` repository only tests connectivity and sends recovery notifications. It is not a replication mechanism.

## Required Render environment after implementation

The final application configuration will use:

| Variable | Purpose |
| --- | --- |
| `PRIMARY_DATABASE_URL` | TiDB Cloud connection string |
| `PRIMARY_DB_SSL` | TLS for TiDB; keep enabled |
| `SECONDARY_DATABASE_URL` | Enzonic MySQL connection string |
| `SECONDARY_DB_SSL` | TLS for Enzonic; keep enabled |
| `DB_REPLICATION_ENABLED` | Explicit switch for the replication worker |

Credentials must be configured independently in the website and Admin Panel Render services. Never put connection strings in GitHub, source files, logs, or chat. The legacy `DATABASE_URL` remains in use until the application code and deployment are deliberately switched together.

## Replication design requirements

The implementation must use a transactional outbox on the primary database. Every application data change must commit in the same TiDB transaction as its outbox event. A background worker then applies events to Enzonic in sequence.

- Never make a user request wait for Enzonic to be available.
- If Enzonic is offline, keep events queued on TiDB and retry after it returns.
- Apply each event idempotently so a worker restart cannot duplicate a change.
- Preserve write order across the website and Admin Panel.
- Track last applied event, oldest pending event, last successful replication time, and lag.
- Replicate schema changes through versioned migrations before enabling corresponding application writes.
- Do not replicate passwords or API credentials in plaintext; only the already-hashed account password values that the application stores may be present in normal row changes.
- Do not use Enzonic as an automatic read fallback while its replication lag is unknown.

A generic SQL dual-write, a periodic table copy without delete tracking, or a best-effort second query is not acceptable: each can silently lose or diverge data.

## Cutover sequence after Enzonic recovery

1. Verify Enzonic is stable across repeated connection checks and obtain a fresh backup/export.
2. Keep Enzonic as the source of truth while exporting/importing its current production data into TiDB.
3. Run schema, table-count, and application-level smoke checks against TiDB. Compare important tables such as users, movies, comments, and admin-managed content.
4. Pause writes briefly for the final delta/export, repeat validation, and record a rollback snapshot.
5. Change both Render services (website and Admin Panel) to TiDB as primary in a coordinated deployment. Do not change either service alone.
6. Confirm login, registration, comments, movie catalogue, admin CRUD, uploads/banner management, and other database-backed features.
7. Enable TiDB-to-Enzonic replication only after the secondary schema is prepared and the initial copy is verified.
8. Monitor replication lag and perform a controlled restore/failover rehearsal before treating Enzonic as a usable standby.

## Failover and recovery rules

- Normal operation: TiDB is primary; Enzonic is asynchronous secondary.
- Enzonic outage: keep serving from TiDB; queue replication events; alert on lag.
- TiDB outage: stop or make writes read-only unless a documented promotion procedure proves Enzonic is caught up. Never silently accept writes to both.
- Promotion: freeze writes, inspect the replication checkpoint, reconcile pending events, take a backup, then explicitly promote Enzonic and change both services together.
- Return to TiDB: resynchronize in the opposite direction from the promoted primary; do not simply point the app back at TiDB.

## Verification helper

Run `node scripts/verify-database-pair.js` only after setting `PRIMARY_DATABASE_URL` and `SECONDARY_DATABASE_URL` in the local environment. It performs read-only schema and row-count checks. Passing those checks is necessary but not sufficient to prove full data equality; the final cutover also needs an application smoke test and a consistent backup/delta check.

## Not yet completed

This branch does not yet implement the outbox writer/worker, schema migration replication, automatic failover, or production cutover. Those require coordinated changes to both repositories and a complete audit of every write path. No live database has been modified by this preparation branch.
