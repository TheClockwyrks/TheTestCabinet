# Per-run-Job refactor — working context

A handoff document for the refactor of how runs execute. The refactor itself —
replacing the long-lived worker pool with per-run Kubernetes Jobs — is **complete
and committed** (see Status below). Self-contained so it survives a fresh session.

The completed phase files (task-1 … task-5) have been **removed**; the companion
files that remain hold the **follow-up work** the refactor surfaced or deferred:

- `task-7.md` — **subscription harness auth** in the service flow. ✅ **DONE**
  (2026-06-23, uncommitted): operator-provided subscription Secret → dispatcher
  mounts it into each driver Job → driver builds `ContainerSpec.files` from the
  mount with no host-fs read. Antigravity (subscription-only) is now console-runnable.
  One **deferred follow-up remains**: the per-account credential vault (option 2 in
  the file) — a real multi-tenant build, not started.
- `task-8.md` — **adversarial arena execution** (quick matches + tournaments).
  ✅ **DONE** (2026-06-23, uncommitted): restored as a **new standalone
  `tcab-arena` service** (the `tcab-artifacts`-style split, *diverging* from the
  file's in-backend recommendation — operator chose the isolated service). The
  console reaches it via a `/config`-exposed URL; reads stay on the backend.
- `task-6.md` — ✅ **DONE** (2026-06-23, uncommitted): publish & score failures as
  first-class results, on the **backend-driven path**. Four-tier `RunState`
  (`completed | catastrophic | timed_out | infrastructure`); catastrophic &
  timed-out publish manually with no reviews, infra never publishable/excluded
  from stats; `state=failures` listing + console "Publish failures" page +
  leaderboard reliability stats. Desktop failure publishing split out to `task-9`.
- `task-9.md` — **deferred** (new, 2026-06-23): unify desktop run execution onto
  the k3d/backend path (one execution path instead of the desktop in-process
  `RunEngine`). Surfaced by task-6; unblocks desktop-produced failure publishing.

## Objective

Replace the long-lived **worker pool** with **per-run Kubernetes Jobs**, and make
the **backend** the control plane for runs. A console enqueues a run; a thin
**dispatcher** claims it and creates one **driver** Job; the driver executes the
run (creating an untrusted sandbox pod), streams progress to the backend, and
pushes the produced record. Local development runs the same manifests on **k3d**.

Why: operational tidiness (no per-pod registration, no hand-scaled worker pool),
concurrency that scales with the cluster (the benchmark is moving toward bigger,
heavier test cases), and local/deploy parity (one way runs are handled, not two).

## Target architecture

```
console ──HTTP──> backend (control plane)
                    ├─ job queue (`job` table: queued→dispatched→running→terminal)
                    ├─ live relay: ingests events/preview/status from drivers,
                    │   fans out to the console (NDJSON live stream + SSE notifications)
                    ├─ run records + reviews + definitions (existing SQLite + store)
                    └─ auth (accounts) + per-job tokens + a dispatcher service token
                         ▲ claims jobs / streams progress back
                    dispatcher (thin) ──k8s API──> one Job per queued run
                                                     │
                                       DRIVER pod (trusted; SA can create pods)
                                                     │ creates + execs into
                                       SANDBOX pod (untrusted; no API token) ← unchanged trust model

artifacts (blobs)   driver ──upload──> tcab-artifacts ◀──read── console
                                         (own binary; control-plane backend
                                          is NOT in the artifact path)
```

- No worker `StatefulSet`, no headless Service, no per-pod console registration.
- The console talks to **one backend URL only**.
- Asset preview is preserved: the in-container TCP `LivePreview` mechanism is
  unchanged; the **driver** pod hosts the listener (sandbox connects to the
  driver's pod IP), and the driver forwards frames to the backend, which relays.
- The **CLI `ContainerRuntime` stays** — the Tauri desktop app drives runs
  in-process with it. This refactor is only about the *server* topology;
  `RunEngine` (in `crates/core`) stays shared by both.

## Status (branch `v0.3.x`)

**Done + committed:**
- `37670f4` — Phase 1: k3d local overlay (`deployments/k8s/overlays/local/`) +
  `deployments/local/Makefile` (`local-up/down/rebuild/forward/ingest`) + docs.
  Brings up backend + auth on a local k3d cluster from the same manifests.
- `6094b9c` — Phase 2: backend run queue + live relay. `job` table + entity +
  `Db` queue ops; `relay.rs` (event/preview broadcast fed by HTTP ingestion +
  completion notifier); `/jobs` endpoints (enqueue, claim, events/preview/status
  ingestion, NDJSON live stream, active list, SSE `/notifications`); per-job
  driver token + `ServiceAuth` extractor for the dispatcher.
- `4a80f99` — Retain every produced record regardless of outcome, with a specific
  diagnostic `detail` on failure; interim `completed`-only publish guard.
- `51eab83` — Phase 3 (task-1): the per-run `tcab-driver` crate (`crates/driver`).
  Moved `LaunchBody`/`ClaimedJob`/`StatusUpdate`/`DriverState` into
  `core::job_api`; backend-streaming sinks (mpsc + batching relay task); ported
  the kubernetes sandbox runtime.
- `266f2f2` — Phase 4 (task-2): the `tcab-dispatcher` crate (`crates/dispatcher`).
  Claims queued jobs and creates one driver Job each; bounds concurrency from the
  live cluster; watches Jobs and reports k8s-derived infra-failure detail.
- `099148b` — Phase 5 (task-5): the `tcab-artifacts` service (`crates/artifacts`)
  + driver upload. `ArtifactStore`/`LocalFsStore`; per-job-token upload verified
  via a new backend `POST /jobs/{id}/verify-token`; account-token reads reuse the
  core serve resolvers; backend exposes the artifact base URL via `GET /config`.
- `c60ca5b` — Phase 5 (task-3): console rewired to the backend (`/jobs` + relay +
  `/config`); worker-connection concept removed; contract-codegen swapped from the
  worker types to `jobs-api.ts` (worker dep dropped).
- `3e7e86e` — Phase 6 (task-4): cutover. Kustomize base + overlays/{prod,staging,
  local}; dispatcher/artifacts manifests + driver/dispatcher RBAC; driver/
  dispatcher/artifacts Dockerfiles + GHCR matrix; **`crates/worker` deleted**;
  docs rewritten (driver/dispatcher/artifacts pages replace the worker page).

**All of tasks 1–5 are complete and committed.** Two follow-up commits landed on
top of the refactor:
- `9f6a104` — the local k3d stack now reads all Secrets (harness API key +
  dispatcher service token) from the host **environment** instead of a tracked
  overlay file (`deployments/local/Makefile` `secrets` target).
- `c0cf565` — task-oriented docs for the service-driven flow: a
  `Run the Local Service Stack` quickstart + a `Running the Local Service Stack`
  guide (the docs were CLI-only before).

**task-7** (subscription auth) and **task-8** (arena execution) are now **done**
(2026-06-23, uncommitted — see each file's status header). What remains: the
still-**deferred task-6**, and the **per-account credential vault** carried over
from task-7 (the multi-tenant successor to the operator-Secret v1).

**Verified here:** whole-workspace `cargo build`/`clippy -D warnings`/`test`
green with the worker gone (52 test binaries); `npm run gen:contract` drift-clean;
`npm run typecheck` + `vite build` for `apps/web` + `apps/desktop`; docs build
(117 pages); all 21 `deployments/k8s/**` YAML files parse.

**Needs the user (no k8s/docker tooling in this dev env):** `kustomize build` for
each overlay; the GHCR image builds; and the k3d end-to-end (`make -C
deployments/local local-up` → enqueue a run → a driver Job + sandbox pod → live
events/preview → record pushed + reviewable). A couple of behavior changes to eye
while testing: the console now reaches the auth service directly (`VITE_AUTH_URL`);
the web adversarial-arena run actions point at backend `/matches`/`/tournaments`
endpoints that don't exist yet (now tracked as **task-8**); and backend-driven runs
only support **API-key** auth, not subscription (now tracked as **task-7**).

**Needs validation on a real machine (no docker/k3d/kubectl in the dev env):**
`make -C deployments/local local-up` — especially the k3d `--volume` → pod
`hostPath: /repo` ingest mount, the empty `secretGenerator`, and k3d/kustomize
versions.

## Key decisions (the load-bearing ones)

- **Per-run Job + thin dispatcher** (not a stateless worker pool). Scaling = queue
  admission + cluster capacity; no KEDA needed.
- **Backend owns the queue; the dispatcher owns all k8s Job creation.** Keeps the
  backend portable (HTTP + SQLite) and isolates RBAC in the dispatcher.
- **`/jobs` namespace for the queue; `POST /runs` push stays** for the
  CLI/desktop local-run path (two writers of finished records, cleanly split).
- **Live stream is NDJSON** (matches the existing console consumer); only
  `/notifications` is SSE.
- **Auth:** account token to enqueue; per-job token (DB-stored, minted at enqueue)
  for the driver's streaming; shared service token for the dispatcher's claim.
- **The driver reports terminal status *with* the record**; the backend persists
  it using the events the relay already accumulated (driver never re-sends them).
- **Retain everything:** every produced record is stored regardless of outcome
  (ephemeral pods lose their disk). Failures carry a specific diagnostic reason.
  An interim `completed`-only publish guard keeps non-completed runs inspectable
  but not yet publishable.
- **Failures-as-publishable-results is deferred** to its own design pass (see
  `task-6.md`) — the refactor only retains the data.
- **Contract TS/JSON bindings for the new job types are deferred** to the console
  rewire (Phase 5), done in one pass when the worker types they replace are
  removed. Drift CI stays green meanwhile (the generator is unchanged).
- **Artifacts live behind their own service** (`tcab-artifacts`), not the backend,
  so artifact bytes never transit the control plane and serving scales
  independently. Its backing store is local disk first, R2 deferrable as an
  internal detail. (Resolved 2026-06-23 — this is why the PVC-vs-R2 question is no
  longer open: it became an internal detail of that binary.) Shipped in `099148b`.

## Remaining work

Remaining (companion files):

- `task-9.md` — **deferred**: unify desktop run execution onto the k3d/backend
  path (removes the desktop in-process `RunEngine` divergence; unblocks
  desktop-produced failure publishing). Not to be tackled immediately.
- **Per-account credential vault** (carried over from `task-7.md`, option 2) —
  the multi-tenant successor to the shipped operator-Secret v1: users upload their
  subscription files, the backend stores them encrypted keyed to the account, and
  the dispatcher mounts a per-job Secret. A real build (secure storage, upload
  UI/CLI, rotation); not started.

Done (companion files keep their status headers):

- `task-6.md` — **publish & score failures as first-class results** (backend-driven
  path; four-tier `RunState`). ✅ 2026-06-23.
- `task-7.md` — **subscription harness auth** (operator-Secret v1). ✅ 2026-06-23.
- `task-8.md` — **adversarial arena execution** (standalone `tcab-arena`). ✅ 2026-06-23.

Completed and committed (phase files removed — kept here as the history):

- Phase 3 — per-run **driver** crate. ✅ `51eab83`.
- Phase 4 — **dispatcher** crate. ✅ `266f2f2`.
- Phase 5 — **console rewire** to the backend (+ contract codegen). ✅ `c60ca5b`.
- Phase 5 — **`tcab-artifacts` service** + driver upload. ✅ `099148b`.
- Phase 6 — **cutover** (manifests, images, worker removal, docs). ✅ `3e7e86e`.

## References (session-local, not in the repo)

- Plan file: `~/.claude/plans/tingly-dreaming-truffle.md`.
- Memory: `failures-as-publishable-results.md` (the deferred design),
  `failed-runs-persisted.md` (the stance it reverses).
