---
title: Backups
---

Published runs are the data worth protecting — the records, reviews, and the
links to each run's source and playable build. This page covers what actually
needs backing up (less than you might think), how to back it up while the backend
stays on SQLite, and what changes if you graduate to managed PostgreSQL.

## What is actually at risk

The backend keeps several things on disk, but only one of them is irreplaceable.
The rest are either regenerated from a source you still have, or already stored
durably somewhere else.

| Data | Where it lives | Recoverable without a backup? |
| ---- | -------------- | ----------------------------- |
| **Published run records, reviews, links** | The backend's SQLite database (`TCAB_BACKEND_DB`) | **No — this is the system of record.** |
| Test-case definition store (`TCAB_BACKEND_STORE`) | On disk | Yes — re-ingested from the repository (`POST /ingest`) |
| Ingest checkout (`TCAB_BACKEND_CHECKOUT`) | On disk | Yes — it is a git checkout |
| The [public snapshot](/components/backend/snapshot/) | Cloudflare R2 | Yes — regenerated from the database |
| Run **outputs** (produced code, playable builds) | Per-run GitHub repos + Cloudflare Pages | Yes — already hosted and replicated there |

So "back up the runs" reduces to "continuously back up one small SQLite file."
Everything else is reproducible from the repository or already lives in a durable
service.

### A built-in safety net

The backend stores each run record as **verbatim JSON** and re-emits it into the
[public snapshot](/components/backend/snapshot/) without reserialization drift, so
the snapshot in R2 is effectively a secondary copy of the records and reviews. It
is not a substitute for real backups — it is the *public* view and only as fresh
as the last upload — but it means the worst case from losing the database is
"lose what changed since the last snapshot," not "lose everything." Treat it as
defense in depth, not your backup.

## The database choice is linked to where the backend runs

How you back the database up depends on which store you run, and that pairs
naturally with the two backend-hosting shapes from
[Azure: staging & prod](/deployment/azure/):

| Store | Backend host | Backup strategy |
| ----- | ------------ | --------------- |
| **SQLite** (today) | A VM with local disk | [Litestream](#sqlite-litestream) streaming to object storage, or [scheduled dumps](#sqlite-scheduled-dumps) |
| **Managed PostgreSQL** (a graduation) | Stateless on Container Apps | [Provider-managed backups + PITR](#managed-postgresql) — nothing to operate |

The backend ships with SQLite (`rusqlite`, a single embedded file — see the
[backend overview](/components/backend/overview/)), so the SQLite paths below
apply as-is. PostgreSQL is a deliberate, code-level change discussed at the end.

## SQLite: Litestream

[Litestream](https://litestream.io/) continuously replicates a SQLite database to
object storage by streaming its write-ahead log, giving **point-in-time restore**
with a footprint of one extra process. It fits this backend exactly: the database
is single-writer and low-volume (a publish at a time, coalesced), and it already
runs in [WAL mode](/components/backend/overview/), which Litestream requires.

- It replicates to any S3-compatible bucket — including the **Cloudflare R2** you
  already use for snapshots — or to Azure Blob Storage. Reuse the same bucket
  provider to keep credentials and familiarity in one place.
- Litestream wants the database on **local disk**, not a network share, which is
  why this path pairs with running the backend on a **VM** (the simpler
  backend-hosting option) rather than on Container Apps over Azure Files.
- Run `litestream replicate` alongside the backend (a systemd service next to
  `tcab-backend`, pointed at `TCAB_BACKEND_DB`). An example configuration is in
  [`deployments/backups/litestream.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/backups/litestream.yml).
- **Restore** with `litestream restore -o <db-path> <replica-url>` before
  starting the backend. Practice this — see [Test your restore](#test-your-restore).

## SQLite: scheduled dumps

A simpler, filesystem-agnostic option (and a fine complement to Litestream) is a
periodic clean copy pushed to object storage:

```sh
# A consistent copy while the backend is running, then upload it.
sqlite3 "$TCAB_BACKEND_DB" "VACUUM INTO '/tmp/tcab-$(date +%F-%H%M).sqlite'"
# ...then `az storage blob upload` or `aws s3 cp` (R2) the file, with a
# lifecycle/retention policy on the bucket to age old copies out.
```

`VACUUM INTO` takes a safe, defragmented snapshot without stopping the service.
Run it from a cron job or systemd timer. The trade versus Litestream is a coarser
recovery point — you lose up to one interval rather than seconds — in exchange for
not running a streaming daemon, and it works even when the database is on a
network share. If the backend ever runs on Container Apps over Azure Files, this
is the path to use.

## Managed PostgreSQL

If you move the backend's record store to managed PostgreSQL (for example
**Azure Database for PostgreSQL Flexible Server**), backups stop being something
you build: the provider takes automated daily backups with configurable retention
and **point-in-time restore**, and restore is a portal/CLI operation. This also
makes the backend stateless on Container Apps, removing the persistent-volume and
single-replica caveats in [Azure: staging & prod](/deployment/azure/#backend-on-azure-container-apps).

This is the natural graduation when you want managed durability and a stateless
backend, but it is a **code change**, not configuration: the backend uses
`rusqlite` directly, so a Postgres store means an async driver and a storage layer
that supports both (SQLite for local and tests, Postgres for the deployed
environments). It is bounded — the database access is isolated in one module —
but it is real work and revises the storage contract, so it is deferred here
rather than assumed. The records-only blast radius and the two SQLite paths above
hold regardless of whether you take it.

## Test your restore

A backup you have never restored is a hope, not a backup. Whichever path you
choose, rehearse recovery into a throwaway location and bring a backend up against
it:

1. Restore the database (`litestream restore`, a downloaded dump, or a PITR to a
   new Postgres instance) to a scratch path.
2. Point a backend at it with `TCAB_BACKEND_DB` (or the connection string) and hit
   `GET /healthz` and `GET /runs` to confirm the records are intact.
3. Note the **recovery point** (how much data the method can lose) and **recovery
   time** (how long the restore takes) so you know what each environment's backup
   actually guarantees. Run the drill on a schedule, not once.

The definition store and checkout do not need restoring — re-ingest them from the
repository with `POST /ingest` after the database is back.
