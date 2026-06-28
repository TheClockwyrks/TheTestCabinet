# Task 1 — Backend: publish queue, async publish, streaming relay

**Status:** ✅ Code-complete, verified 2026-06-27. Depends on the scaffolding in `7cb94bb` (entity, wire
types, migration already exist). This is the spine — do it first.

## Goal

Turn `POST /runs/{id}/publish` into an **async** trigger that enqueues a publish
job, expose the queue to the dispatcher, and let the console/CLI observe the
publish over a **live NDJSON stream** (no polling). When the publisher reports a
terminal success, attach the produced links to the run and flip it published.

## DB methods (`crates/backend/src/db.rs`)

Mirror the run-queue methods (`enqueue_job` `:915`, `claim_next_job` `:939`,
`set_job_state` `:962`, `get_job` `:989`). Add (new `impl Db` block near the job
ops, importing `publish_job` into the `use test_cabinet_entities::{…}` line `:29`):

1. `NewPublishJob { id, run_id, job_token, created_at }` + `enqueue_publish_job` —
   insert `state="queued"`.
2. `claim_next_publish_job(now) -> Option<publish_job::Model>` — txn
   select-oldest-`queued` → flip `dispatched` (copy `claim_next_job` exactly).
3. `get_publish_job(id)`.
4. `set_publish_job_state(id, state, now, detail)` — for the failure path.
5. `complete_publish_job(id, run_id, source_repo, playable_build, now) ->
   PublishRunOutcome` — **one transaction** that:
   - loads the `run` (404 if missing),
   - upserts `run_link` (source_repo/playable_build) exactly like `push` `:262`,
   - patches the `run.record_json` blob's `links` (deserialize `RunRecord`, set
     `record.links`, reserialize) so the blob and `run_link` agree — `RunRecord`/
     `RunLinks` are already imported for `push`,
   - flips `published=true` + stamps `published_at` (preserve an existing one, like
     `publish` `:396`), saving the patched blob too,
   - `set_dirty(&txn)` (snapshot refresh),
   - marks the `publish_job` `succeeded` with the links + `updated_at`.
   Reuse the existing `PublishRunOutcome` struct.
6. `ensure_publishable(run_id) -> Result<()>` — the **gate only** (no flip),
   factored out of `publish` `:361` (`infrastructure` → refuse; `completed` needs
   ≥1 review; `catastrophic`/`timed_out` waived). Call it at enqueue so the user
   gets immediate rejection; `publish`'s own gate can stay for the legacy/desktop
   path or be refactored to call this.

## Streaming relay (mirror `crates/backend/src/relay.rs`)

The console observes the publish over a live stream, **not** polling. Two viable
shapes — pick the lighter:

- **(preferred) Generalize the existing relay** to carry a publish progress item,
  keyed by publish-job id, with a terminal item. Reuse `event_stream`-style NDJSON
  framing (`api/jobs.rs:456`).
- Or a small parallel `publish_relay` with the same broadcast + backlog +
  terminal-close shape.

Define a `PublishProgress` event (a `{ message, … }` line) as the extension point
for future per-step progress. For the first cut the only required items are
optional progress lines + the **terminal** `PublishResult` (already in
`core::publish_job_api`). The terminal item closes the stream.

## Endpoints (`crates/backend/src/api/`)

New module `api/publish_jobs.rs` (mirror `api/jobs.rs`); register routes in
`crates/backend/src/api.rs`.

1. **`POST /runs/{id}/publish`** (modify `api/runs.rs:171`): require the account
   bearer (`AuthUser`), call `ensure_publishable`, mint a publish-job id + token,
   `enqueue_publish_job`, return `202` with the job id (and the live URL
   `/publish-jobs/{id}/live`). **No longer flips published synchronously.** Drop/replace
   the old `db.publish` call + `queue_refresh` here (they move to
   `complete_publish_job` / the result handler).
2. **`POST /publish-jobs/next`** (`ServiceAuth`, mirror `claim` `:184`):
   `claim_next_publish_job` → `PublishClaim { job_id, job_token, run_id }` or `204`.
3. **`GET /publish-jobs/{id}/live`** (NDJSON, mirror `live` `:153` +
   `event_stream`): replay backlog + tail, close on terminal. Open to the account
   (or unauthenticated like `/jobs/{id}/live` — match that endpoint's gating).
4. **`POST /publish-jobs/{id}/events`** (per-job token, mirror `ingest_events`
   `:210`, optional for v1): publisher streams progress lines into the relay.
5. **`POST /publish-jobs/{id}/result`** (per-job token via `authorize_*`): on
   `Succeeded` → `complete_publish_job` + push the terminal item to the relay +
   `state.publisher.queue_refresh()`; on `Failed` → `set_publish_job_state(failed,
   detail)` + terminal item. Authenticate with the publish-job token (mirror
   `authorize_job` `:411`; the artifact service's `verify_token` `:360` pattern is
   the analogue if the publisher needs token verification for `tree.tar`).

## AppState / wiring

- If a parallel relay is used, add it to `AppState` (mirror `relay`).
- Register all routes in `crates/backend/src/api.rs`.

## Tests (`.test.rs`, per the coding skill)

- `enqueue_publish_job` → `claim_next_publish_job` flips `queued`→`dispatched`;
  empty queue → `None`.
- `complete_publish_job` attaches links to `run_link` + blob, flips published,
  preserves an existing `published_at`, marks the job `succeeded`.
- `ensure_publishable` matches the existing gate (reuse `publish`'s test cases).
- A live-stream test: a subscriber sees a progress item then the terminal result.

## Out of scope (other tasks)

Dispatcher (task-2), the publisher binary (task-3), `tree.tar` (task-4), and the
CLI/console stream consumer (task-7). This task only makes the backend enqueue,
serve the queue, stream, and finalize.
