# Task 4 — Phase 6: cutover (manifests, images, worker removal, docs)

**Status:** not started. **Depends on:** task-1, task-2, task-3.

## Goal

Cloud and local topology reflect the new design; the worker is removed. After
this, a run is a Kubernetes Job everywhere, locally (k3d) and in the cloud, from
the same manifests.

## Steps

### Manifests (finish the kustomize conversion deferred from Phase 1)
- Introduce the kustomize **base + `overlays/{prod,staging}`** for the cloud
  manifests (Phase 1 only did `overlays/local`, referencing the flat files).
- **Remove** `deployments/k8s/worker.yaml` (StatefulSet + headless Service).
- **Add** `deployments/k8s/dispatcher.yaml` (a `Deployment`, 1 replica, the
  service-token secret) and the **driver/dispatcher RBAC**: rename `tcab-worker`
  SA/Role → a **driver** SA with the same pods/exec/log verbs (it makes the
  sandbox), plus a **dispatcher** SA/Role for `jobs` create/get/list/watch/delete.
- Update `networkpolicy.yaml` selectors (driver pods ← create sandbox pods;
  sandbox pods ← reach the driver for preview) and `ingest-cronjob.yaml` image ref.
- The **`local` overlay** now also deploys the dispatcher → runs schedule as Jobs
  inside the local cluster → full local/deploy parity. Add a
  `TCAB_BACKEND_SERVICE_TOKEN` (dev value) to the local secret so the dispatcher
  can claim.

### Images + CI
- Replace `deployments/images/worker.Dockerfile` with `driver.Dockerfile`
  (the driver binary + whatever the sandbox-creation/preview needs) and
  `dispatcher.Dockerfile`.
- Update `.github/workflows/build-service-images.yml`: drop `tcab-worker`, add
  `tcab-driver` and `tcab-dispatcher`. Update the local Makefile's image build/
  import list to match.

### Remove the worker
- Delete `crates/worker`; remove it from the workspace `Cargo.toml`.
- Remove the worker imports from `crates/contract-codegen` and the `worker-api.ts`
  module (coordinate with task-3's codegen swap).

### Docs
- `deployment/overview.md`, `deployment/kubernetes.md` (topology → dispatcher +
  per-run Jobs, RBAC, no headless service / no per-pod registration).
- `development/running.md` (the host-worker steps → the dispatcher/Jobs model;
  the worker-on-host section goes away).
- `components/worker/overview.md` → retire/replace with driver + dispatcher pages;
  update `components/architecture.md` and `terminology.md`.
- `CLAUDE.md` component table (worker row → driver + dispatcher).

## Verification

- `kustomize build` renders for every overlay (prod/staging/local).
- `cargo build`/`clippy` for the whole workspace with the worker gone.
- **End-to-end on k3d** (user, real cluster): `make local-up` → enqueue a run from
  the console → `kubectl get jobs,pods` shows a driver Job + a sandbox pod → live
  events stream → an asset-gen case shows live preview → run completes, record
  pushed, reviewable/publishable. Scale check: several concurrent runs schedule as
  separate Jobs with no per-worker registration.
- Contract drift CI green.
