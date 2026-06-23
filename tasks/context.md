# Per-run-Job refactor — working context

A handoff document for the in-progress refactor of how runs execute. Self-contained
so it survives a fresh session. Companion files `task-1.md … task-6.md` hold the
remaining work in (roughly) execution order.

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

**Verified here:** `cargo build`/`clippy`/`test` for `backend`, `entities`,
`migration` (46 backend tests green); YAML + Makefile self-checked.

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
  longer open: it became an internal detail of that binary.) See `task-5.md`.

## Remaining work

- `task-1.md` — Phase 3: the per-run **driver** crate.
- `task-2.md` — Phase 4: the **dispatcher** crate.
- `task-3.md` — Phase 5: **console rewire** to the backend (+ contract codegen).
- `task-4.md` — Phase 6: **cutover** (manifests, images, worker removal, docs).
- `task-5.md` — the **`tcab-artifacts` service** (artifact retention off
  ephemeral pods; local-disk backing first, R2 later).
- `task-6.md` — **deferred**: publish & score failures as first-class results
  (a separate design pass, not part of this refactor).

## References (session-local, not in the repo)

- Plan file: `~/.claude/plans/tingly-dreaming-truffle.md`.
- Memory: `failures-as-publishable-results.md` (the deferred design),
  `failed-runs-persisted.md` (the stance it reverses).
