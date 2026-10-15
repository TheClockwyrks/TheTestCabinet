---
title: Backups
---

Published runs are the data worth protecting: the records, reviews, and the links
to each run's source and playable build. This page covers what needs backing up,
how to back it up while the backend runs on SQLite, and what changes on managed
PostgreSQL.

## Data at risk

The deployment keeps several things, and only one of them is irreplaceable. The
rest are regenerated from a source you still have, or already stored durably
elsewhere.

| Data                                                   | Where it lives                                                                                                       | Recoverable without a backup?                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Published run records, reviews, links, short codes     | The backend's database (`TCAB_BACKEND_DATABASE_URL`)                                                                 | No. This is the system of record                    |
| Test-case definition store (`TCAB_BACKEND_STORE`)      | On disk                                                                                                              | Yes, re-ingested from the repository                |
| Ingest checkout (`TCAB_BACKEND_CHECKOUT`)              | On disk                                                                                                              | Yes, it is a git checkout                           |
| The [public dataset](/components/backend/snapshot/)    | Cloudflare R2                                                                                                        | Yes, regenerated from the database                  |
| Run outputs (produced code, playable builds)           | Per-run GitHub repos and Cloudflare Pages                                                                            | Yes, already hosted there                           |
| Run trees (proof media, produced assets, builds, logs) | The [artifacts service](/components/artifacts/overview/)'s Blob container, and once published R2 under `media/runs/` | Yes for a published run, from the copy in R2        |
| Run bundles (the implementation as a git repository)   | The [repos service](/components/repos/overview/)'s Blob container                                                    | Yes for a published run, from its GitHub repository |

Backing up the runs therefore reduces to continuously backing up one small
database, the backend's records. The two Blob containers hold what an
unpublished run produced, and are protected by the storage account rather than
by this page: enable soft delete and blob versioning on both containers, so a
deleted or overwritten object can be restored for the retention window.

### The dataset as defense in depth

The backend stores each run record as verbatim JSON and re-emits it into the
public dataset without reserialization drift, so the documents in R2 are a
secondary copy of the records and reviews. They are the public view and only
as fresh as the last publish, so the worst case from losing the database is
losing what changed since then. Treat them as defense in depth rather than as
the backup.

### Recreating a cluster

If the whole cluster is deleted and recreated while the database survives, an
external managed PostgreSQL or a restored SQLite file, the backend's volume
does not come back with it: the definition store and the ingest checkout sit on
a per-cluster `PersistentVolumeClaim` that a full delete destroys. A claim
survives an ordinary pod reschedule, which is what it is for, and it ends with
the cluster its disk belongs to. The run trees and bundles live in the Blob
containers and the public dataset in R2, none of which belong to the cluster,
so they are untouched.

Recovery is one step: the in-pod ingest sidecar re-ingests the definition store
on backend start, or on demand with `tcab ingest --env <env>`, restoring case
metadata, reference baselines, and seeded specs.

## Backup strategy per store

How the database is backed up depends on which store it runs, and that pairs with
the two backend-hosting shapes.

| Store                | Backend host                                                  | Backup strategy                                                                                             |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SQLite (the default) | A single-replica `StatefulSet` with a `PersistentVolumeClaim` | [Litestream](#sqlite-litestream) streaming to object storage, or [scheduled dumps](#sqlite-scheduled-dumps) |
| Managed PostgreSQL   | A stateless `Deployment`                                      | [Provider backups and point-in-time restore](#managed-postgresql)                                           |

The backend defaults to a single embedded SQLite file, and the kustomize base runs
it that way, as does the `local` overlay; the SQLite paths below apply to such a
deployment as-is. PostgreSQL is selected by pointing `TCAB_BACKEND_DATABASE_URL`
at a `postgres://` instance. The two remote overlays, `staging` and `prod`, both
run the managed-PostgreSQL shape (see [PostgreSQL](/deployment/kubernetes/postgres/)),
so no remote environment has a SQLite database to back up; the SQLite
strategies are for a deployment made from the base with an overlay of its own.

## SQLite: Litestream

[Litestream](https://litestream.io/) continuously replicates a SQLite database to
object storage by streaming its write-ahead log, giving point-in-time restore for
the cost of one extra process. The backend's database is single-writer, low
volume, and already in WAL mode, which Litestream requires.

- It replicates to any S3-compatible bucket, including a Cloudflare R2 bucket.
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
