# NoAdFrame recovery from repository/public sources

This recovery path is for the case where the original Enzonic database cannot be reached.

## What can be rebuilt

- Public movie catalogue entries present in `seed/movies.json`.
- Factual title metadata (English title, year, IMDb rating, genre, director, cast) fetched afresh from OMDb using each stored IMDb ID.
- Georgian titles and any curated descriptions already stored in the repository seed file.

## What cannot be reconstructed from the repository

- User accounts and password hashes.
- User comments.
- AI feedback conversations.
- Admin security event history, IP/email hashes, and prior login records.
- Custom uploaded banner image bytes, homepage section selections, view counters, or other records that existed only in the unavailable database.

Do not fabricate these records. Search provider backups, database exports, prior local downloads, and Enzonic support recovery options separately.

## Safe TiDB-only catalogue rebuild

1. Use the isolated TiDB Cloud database named `noadframe`; do not point this script at Enzonic or the live production service.
2. Set `RESTORE_DATABASE_URL` to the TiDB Cloud connection URL and `OMDB_API_KEY` in the execution environment. Do not commit either secret.
3. Run `npm ci`, then `npm run restore:public-catalog`.
4. The script refuses non-TiDB hosts, non-4000 ports, and database names other than `noadframe`. It creates only missing schema tables with `CREATE TABLE IF NOT EXISTS`, adds only seed movie IDs not already present, and never deletes, truncates, or overwrites existing movie rows.
5. Third-party video URLs from the seed file are deliberately not restored; they must be checked for rights and availability separately.
6. Review the script summary and compare the target table inventory before any production deployment.

The script does not restore private user/admin data and is not a complete production migration. Production connection strings remain unchanged until a verified backup, full data reconciliation, and explicit cutover approval exist.
