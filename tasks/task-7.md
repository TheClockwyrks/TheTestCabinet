# Task 7 — CLI + console: async/streaming publish UX

**Status:** ✅ Code-complete, verified 2026-06-27. Depends on task-1 (the async `/publish` + the
`/publish-jobs/{id}/live` stream). Do this once the backend behavior is in.

## Why

`POST /runs/{id}/publish` is now **asynchronous**: it enqueues a publish job and
returns an ack, instead of synchronously returning `newlyPublished`. The GitHub +
Pages release happens in a `tcab-publisher` Job and is observed over a **live
NDJSON stream** (`GET /publish-jobs/{id}/live`) — explicitly **not** by polling
(operator preference, so future per-step progress is a non-breaking extension).
Both publish clients must be updated or they break.

## CLI (`crates/cli`)

- `crates/cli/src/commands/publish.rs` — `tcab publish` today does
  `submit_review` then `publish_run` and expects an immediate result. Rework so it:
  enqueues the publish (the changed `/publish` ack → a publish-job id), then
  **subscribes to `/publish-jobs/{id}/live`** and prints progress lines until the
  terminal item, surfacing the resulting `sourceRepo`/`playableBuild` (or the
  failure `detail`). Reuse the run path's live-stream consumer if the CLI has one;
  otherwise a simple NDJSON reader over `reqwest` (the dispatcher/driver already
  stream similarly).
- `crates/core/src/backend_client.rs` — `publish_run` (and `PublishAck`) returns
  the old synchronous shape. Add/replace with the enqueue + a stream subscription
  (or expose the publish-job id so the CLI subscribes). Keep `submit_review`
  unchanged.

## Console (`packages/ui` + `apps/web`)

- `packages/ui/src/transport/httpBackend.ts` `publish()` (~`:691`) expects
  `{ newlyPublished }`. Change it to enqueue and then consume
  `/publish-jobs/{id}/live` (the codebase already streams NDJSON for the run live
  monitor — reuse that transport). Surface "Publishing…" with progress and a final
  success (links) / failure state.
- The **Publish failures** page and the normal publish button (`apps/web`) both
  call this path — update their optimistic "published" handling to reflect the
  async result (only mark published when the stream reports success).
- Run `npm run gen:contract` if any shared wire type gains a TS binding. NOTE: the
  publish-queue wire types were deliberately created **without** `contract` derives
  (internal backend↔dispatcher↔publisher). If the console needs a typed shape for
  the stream items, either add the derives to those types (and regenerate) or hand-
  type them in the transport — prefer the latter to keep the queue types internal.

## Verify

- `tcab publish <id>` streams progress and reports the repo + build URLs.
- The console shows live publish progress and lands on the published run.
- `npm run typecheck` + `vite build` for `apps/web` (+ `apps/desktop` if touched);
  workspace `cargo build`/`clippy -D warnings`/`test` green.

## Out of scope

Backend/dispatcher/publisher (tasks 1–6).
