---
format: nyxsis-issue
version: 2
id: ajb3chy5zoadat06kzyc16z3
zone: BACK
number: 3
title: Recover pending backend work on restart and clean ingest staging
type: generic
state: done
created: 2026-10-19T00:38:47.245068723Z
done: 2026-10-19T20:47:19.708035569Z
---

Some work the backend owns lives only in its process. A snapshot refresh
queued by ingest, a model change or a price change is held in memory
(`Publisher::queue_refresh` in `crates/backend/src/publisher.rs`) and lost on
restart. Startup fails every `running` model probe
(`fail_running_model_probes` in `crates/backend/src/lib.rs`). Ingest's
staging directories under the store's `.tcab/staging/` are never removed when
a pass stops part way.

The documentation has this work survive a restart:

- `apps/docs/src/content/docs/components/backend/overview.md`, "Restarts",
  "Test case definitions" and "Replicas"
- `apps/docs/src/content/docs/components/backend/api.md`, "Model probes"

## What is missing

- `queue_refresh` setting the snapshot state's `dirty` flag in the database for
  every caller before it queues, and startup queuing a refresh when the flag is
  set.
- A lease on a running probe's row, renewed while the probe runs, and a running
  backend resuming a probe whose lease has lapsed by issuing only the calls with
  no stored item, in place of failing it at startup.
- Launch-pass claims held as leases, with startup releasing only lapsed ones.
- Startup emptying the store's staging area before it serves or ingests.

## Verify

- A test queues a refresh from ingest, rebuilds the backend over the same
  database, and sees the refresh run.
- A test leaves a probe `running` with some items stored and a lapsed lease,
  starts a backend, and sees the probe complete with only the missing calls
  issued.
- A test leaves a directory under the staging area, starts a backend, and finds
  it removed.
- `make gate` passes in the backend checkout.
