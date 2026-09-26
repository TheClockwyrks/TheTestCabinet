---
title: Backups
---

Published runs are the data worth protecting: the records, reviews, and the links
to each run's source and playable build. This page covers what needs backing up,
how to back it up while the backend runs on SQLite, and what changes on managed
PostgreSQL.

## Data at risk

The backend keeps several things on disk, and only one of them is
irreplaceable. The rest are regenerated from a source you still have, or already
stored durably elsewhere.

| Data                                                            | Where it lives                                                                           | Recoverable without a backup?        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| Published run records, reviews, links                           | The backend's database (`TCAB_BACKEND_DATABASE_URL`)                                     | No. This is the system of record     |
| User accounts (usernames, password hashes, display names)       | The [auth service](/components/auth/overview/)'s own database (`TCAB_AUTH_DATABASE_URL`) | No. Accounts cannot be reconstructed |
| Test-case definition store (`TCAB_BACKEND_STORE`)               | On disk                                                                                  | Yes, re-ingested from the repository |
| Ingest checkout (`TCAB_BACKEND_CHECKOUT`)                       | On disk                                                                                  | Yes, it is a git checkout            |
| The [public snapshot](/components/backend/snapshot/)            | Cloudflare R2                                                                            | Yes, regenerated from the database   |
| Run outputs (produced code, playable builds)                    | Per-run GitHub repos and Cloudflare Pages                                                | Yes, already hosted there            |
| Run media (proof images/videos, produced asset images and logs) | The artifact service volume, and once published the R2 snapshot under `media/runs/`      | Yes, from the published copy in R2   |

Backing up the runs therefore reduces to continuously backing up two small
databases: the backend's records and the auth service's accounts. Both take the
same approach below. The accounts database is smaller and changes rarely, and
losing it leaves every review pointing at reviewer ids with no identity behind
them.

### The snapshot as defense in depth

The backend stores each run record as verbatim JSON and re-emits it into the
[public snapshot](/components/backend/snapshot/) without reserialization drift,
so the snapshot in R2 is a secondary copy of the records and reviews. It is the
public view and only as fresh as the last upload, so the worst case from losing
the database is losing what changed since then. Treat it as defense in depth
rather than as the backup.

### Recreating a cluster

If the whole cluster is deleted and recreated while the database survives, an
external managed PostgreSQL or a restored SQLite file, the on-cluster volumes do
not come back with it. The backend's definition store and the
[artifact service](/components/artifacts/overview/)'s media both sit on
per-cluster `PersistentVolumeClaim`s that a full delete destroys. A claim
survives an ordinary pod reschedule, which is what it is for, and it ends with
the cluster its disk belongs to. The database still holds every published run, so
recovery is about refilling those volumes before the next publish regenerates the
snapshot from them.

1. Definition store. Re-ingested by the in-pod ingest sidecar on backend start,
   or on demand with `scripts/reingest-cluster.sh --env <env>`. This restores
   case metadata, reference baselines, and seeded specs.
2. Run media. The proof and asset bytes are gone from both wiped volumes, and
   the previous snapshot still holds them in R2. Re-seed them with
   `scripts/recover-run-media-from-snapshot.sh`, passing `--env <env>`,
   `--source-prefix <prefix>`, and `--apply`; it copies each run's media from
   that prior snapshot back into the store and triggers one refresh. Without
   `--apply` it reports what it would copy and changes nothing. Once the media
   lands under the content-stable `media/runs/` prefix, later publishes
   reference it without the wiped volumes.

Do this before relying on any publish. A refresh that runs against empty volumes
re-exports every run with empty media and cuts the live gallery over to it. The
media bytes still exist in the prior R2 prefix, and the live snapshot stops
pointing at them until you recover.

## Backup strategy per store

How the database is backed up depends on which store it runs, and that pairs with
the two backend-hosting shapes.

| Store                | Backend host                                                  | Backup strategy                                                                                             |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SQLite (the default) | A single-replica `StatefulSet` with a `PersistentVolumeClaim` | [Litestream](#sqlite-litestream) streaming to object storage, or [scheduled dumps](#sqlite-scheduled-dumps) |
| Managed PostgreSQL   | A stateless `Deployment`                                      | [Provider backups and point-in-time restore](#managed-postgresql)                                           |

The backend defaults to a single embedded SQLite file, so the SQLite paths below
apply as-is. PostgreSQL is selected by pointing `TCAB_BACKEND_DATABASE_URL` at a
`postgres://` instance.

## SQLite: Litestream

[Litestream](https://litestream.io/) continuously replicates a SQLite database to
object storage by streaming its write-ahead log, giving point-in-time restore for
the cost of one extra process. The backend's database is single-writer, low
volume, and already in WAL mode, which Litestream requires.

- It replicates to any S3-compatible bucket, including the Cloudflare R2 the
  snapshot already uses.
- Litestream needs the database on local disk rather than a network share. A
  `ReadWriteOnce` `PersistentVolumeClaim` backed by a block volume mounts as a
  real device in the pod and satisfies this; avoid an NFS or SMB-backed claim for
  the SQLite file.
- Run `litestream replicate` as a sidecar container in the backend pod, sharing
  the database `PersistentVolumeClaim` and pointed at the SQLite file in
  `TCAB_BACKEND_DATABASE_URL`. An example configuration is in
  `deployments/backups/litestream.yml`.
- Restore with `litestream restore -o <db-path> <replica-url>` before starting
  the backend. Rehearse it; see [Restore rehearsal](#restore-rehearsal).

## SQLite: scheduled dumps

A filesystem-agnostic option, and a fine complement to Litestream, is a periodic
clean copy pushed to object storage:

```sh
# DB = the SQLite file path from TCAB_BACKEND_DATABASE_URL (sqlite://<path>?…).
# A consistent copy while the backend is running, then upload it.
sqlite3 "$DB" "VACUUM INTO '/tmp/tcab-$(date +%F-%H%M).sqlite'"
# ...then `aws s3 cp` (R2) or your provider's CLI uploads the file, with a
# lifecycle/retention policy on the bucket to age old copies out.
```

`VACUUM INTO` takes a safe, defragmented snapshot without stopping the service.
Run it from a Kubernetes `CronJob` that mounts the backend's database
`PersistentVolumeClaim`. The trade against Litestream is a coarser recovery
point, up to one interval rather than seconds, in exchange for running no
streaming sidecar and working when the database sits on a network share.

## Managed PostgreSQL

With the record store on a managed PostgreSQL instance, the provider takes
automated daily backups with configurable retention and point-in-time restore,
and restore is a portal or CLI operation. This also makes the backend a plain
stateless `Deployment`; see
[PostgreSQL](/deployment/kubernetes/postgres/).

Selecting the store is a configuration change. The backend talks to its store
through SeaORM, so the same binary runs on either store depending only on
`TCAB_BACKEND_DATABASE_URL`, and the schema migrates itself on first start. The
records-only blast radius and the two SQLite paths above hold whichever store you
run.

## Restore rehearsal

Whichever path you choose, rehearse recovery into a throwaway location and bring
a backend up against it:

1. Restore the database (`litestream restore`, a downloaded dump, or a
   point-in-time restore to a new Postgres instance) to a scratch path.
2. Point a backend at it with `TCAB_BACKEND_DATABASE_URL` and call
   `GET /healthz` and `GET /runs` to confirm the records are intact.
3. Note the recovery point (how much data the method can lose) and the recovery
   time (how long the restore takes), so each environment's guarantee is known.
   Run the drill on a schedule.

The definition store and checkout need no restoring. Re-ingest them from the
repository once the database is back.
