# Task 3 — Phase 5: console rewire to the backend (+ contract codegen)

**Status:** not started. **Depends on:** Phase 2 (endpoints exist). Can proceed
largely in parallel with task-1/2. **Blocks:** task-4 (worker removal).

## Goal

The web console talks to **one backend URL only**. The worker connection concept
(per-pod registration, the Connections drawer's worker list) is removed, and run
execution is re-pointed at the backend's `/jobs` endpoints.

## Steps

1. **Transport** — fold `apps/web/src/transport/httpWorker.ts` into
   `httpBackend.ts`:
   - `launchRun(config)` → `POST /jobs` (was the worker's `POST /runs`); returns
     `{ jobId }`.
   - `subscribeToRun(id)` → `GET /jobs/{id}/live` (NDJSON — the same parser the
     worker's `/runs/{id}/events` used).
   - `listActiveRuns()` → `GET /jobs/active`.
   - `subscribeToNotifications()` → `GET /notifications` (SSE — unchanged shape).
   - Drop the worker's `POST /push` (the driver pushes the record itself now).
2. **Connections** — `apps/web/src/state/useConnections.ts` + the Connections
   drawer: remove the worker list / per-pod registration / `tcab.web.workers`
   storage; keep the single backend URL. The "worker bound to same backend" check
   goes away.
3. **Data provider** — `packages/ui/src/app/data/galleryContext.tsx`
   (`GalleryDataProvider`, `canExecute`) and `packages/ui/src/client/types.ts`:
   re-point execution at the backend; adopt the regenerated bindings. The desktop
   app (`apps/desktop`) keeps its local `cli` execution path untouched.

## Contract codegen (do it here, in one pass)

`crates/contract-codegen/src/main.rs` currently generates `worker-api.ts` from
`wjobs`/`wnotify`/`wapi`. Replace that with the backend job-API types:
- the shared types now in `core::job_api` (`LaunchBody`, `ClaimedJob`,
  `StatusUpdate`, `DriverState`) and the backend's job output types
  (`JobState`, `JobStatusOut`, `ActiveJobOut`, `LaunchAck`) + the relay's
  `JobSummary`, `Notification`, `NotificationKind`, `NotificationOutcome`.
- emit a `jobs-api.ts` TS module + the matching JSON schemas; remove the
  `worker-api.ts` module and the worker imports (the worker crate is deleted in
  task-4, so this and that deletion should land together or in close sequence).
- the UI consumes the regenerated bindings.

## Verification

- `npm run gen:contract` (regenerate) — drift CI green.
- `vite build` + typecheck for `apps/web` and `packages/ui` (the SCSS-token build
  gotcha only surfaces under `vite build`, not typecheck).
- Manual: launch a run from the console against a backend, watch the live stream,
  see it complete and become reviewable.

## Note on sequencing with task-4

The contract-codegen change here removes the worker imports, which only compiles
once `crates/worker` is gone (task-4). Land the worker deletion (task-4) and this
codegen swap together, or do this task's UI/transport work first and the codegen
swap as part of task-4.
