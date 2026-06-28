# Task 4 — Artifacts: `tree.tar` source-tree download

**Status:** ⬜ Not started. Small, self-contained. Needed by task-3.

## Goal

Let the publisher Job fetch a run's **implementation source tree** from the
artifact service. Today the service serves the built `build`/proof/asset/events
(`crates/artifacts/src/api.rs`) but offers **no download of the source tree** the
GitHub release needs.

## Change (`crates/artifacts/src/api.rs`)

Add `GET /runs/{id}/tree.tar` that streams a tar of the stored implementation tree
(`{store-root}/{run_id}/implementation/`, plus `run-record.json` and `events.jsonl`
so the publisher has the record + events without extra round-trips — match what
task-3 untars and reads).

- **Auth:** gate it with the **publish-job token**, verified against the backend the
  same way uploads verify the per-run token — the upload path calls the backend's
  `POST /jobs/{id}/verify-token` (`crates/backend/src/api/jobs.rs:360`). Add the
  analogous publish-job verification (a `POST /publish-jobs/{id}/verify-token`, or
  reuse the result endpoint's token check) so the artifact service can authenticate
  the publisher. Mirror the existing artifact auth helper rather than inventing a
  new scheme.
- **Tar:** reuse the driver's tar approach in reverse — the driver tars the run dir
  on upload (`crates/driver/src/artifacts.rs:~169`, `tar_run_dir`); produce the
  equivalent archive on download. Stream it (don't buffer the whole tree) where
  practical.

## Tests

- A stored run's `tree.tar` round-trips: untarring it yields `implementation/` +
  `run-record.json` + `events.jsonl`.
- Auth: a missing/wrong token → 401; unknown run → 404.

## Out of scope

The publisher's consumption of this (task-3).
