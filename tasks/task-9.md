# Task 9 — DEFERRED: unify desktop run execution onto the k3d/backend path

**Status:** deferred — documented now, **not** to be tackled immediately. Surfaced
while scoping task-6 (publish & score failures). **Relates to:** task-6 (this
unblocks desktop-produced failure publishing), `context.md` target architecture.

## The idea

Today the Tauri desktop app drives runs **in-process** via `RunEngine` +
`ContainerRuntime` (a deliberate decision in the per-run-Job refactor —
`context.md`: "The CLI `ContainerRuntime` stays — the Tauri desktop app drives
runs in-process with it. This refactor is only about the *server* topology").
That leaves **two** ways a run is executed: the in-process desktop path and the
backend → dispatcher → driver Job path.

This task **reverses that decision**: have the desktop app enqueue runs to a
backend (a local **k3d** stack for developers) and consume the same `/jobs` relay
the web console uses, so there is **one** execution path. The desktop app is a
developer-only tool, so requiring a local k3d cluster is acceptable.

## Why it's its own task (and why task-6 doesn't wait on it)

- It is an architecture change to how the desktop app *runs* a test case, not a
  publish/scoring change — much larger surface than task-6.
- task-6 ships on the **backend-driven path only**, which is the multi-user path
  where outcome-classification integrity matters. The desktop in-process path is
  left untouched by task-6 and keeps its existing `completed`-only push guard
  (`crates/backend/src/api/runs.rs:57`).
- Consequence: **desktop-produced catastrophic/timeout failures are not
  publishable until this task lands.** Only backend-driven runs can publish
  failures after task-6. That's the intended interim state.

## Scope (all deferred)

- Decide the desktop dev UX: spin up / point at a local k3d backend; surface the
  `/jobs` enqueue + NDJSON live relay + `/notifications` already used by the web
  console (`apps/web`); reuse the shared `@test-cabinet/ui` gallery app.
- Retire (or gate behind a dev-only mode) the in-process `RunEngine` execution in
  `crates/desktop`, keeping `RunEngine`/`ContainerRuntime` as a library the driver
  already uses.
- Once unified, desktop runs inherit the driver's outcome classification, so the
  `POST /runs` push path no longer needs a separate desktop classifier — and the
  desktop can publish catastrophic/timeout failures like the console.
- Re-evaluate whether `POST /runs` (the CLI/desktop finished-record push) is still
  needed at all, or whether everything flows through `/jobs`.

## Open questions for when this is picked up

- Does the desktop bundle/launch k3d, or assume the developer ran
  `make -C deployments/local local-up` first?
- Does the CLI (`tcab run`) also move onto the backend path, or stay in-process
  (it has no relay consumer today)?
