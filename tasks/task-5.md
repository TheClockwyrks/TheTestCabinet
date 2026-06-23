# Task 5 — Artifact service (`tcab-artifacts`)

**Status:** decided, not started. **Depends on:** task-1 (the driver, to add the
upload step). **Storage decision: RESOLVED — see below.**

## Goal

A dedicated service that holds and serves a run's artifacts — the generated
**source tree**, the built **playable output**, and **proof/asset media** — so
they survive the ephemeral driver pod. The worker used to serve these off its own
disk (`/runs/{id}/build|proof|asset`); that role moves here, **not** into the
backend.

## Decision (2026-06-23)

Artifacts live behind their **own binary**, `tcab-artifacts`, **not** an
abstraction inside the backend. Rationale: an `ArtifactStore` trait inside the
backend would still funnel every upload and every reviewer's (potentially heavy)
build pull through the single-replica **control-plane** backend. A separate
service takes all artifact bytes off the control plane entirely — the backend
keeps only small, control-shaped traffic (queue, relay, records, reviews,
definitions) — and lets artifact serving scale independently (replicas / cache /
CDN) without touching the backend. This is the same control-plane/data-plane split
the whole refactor is built on: the driver sends *status* to the backend and
*blobs* to the artifact service.

**Backing store: local disk first, R2 deferrable.** The service owns an
`ArtifactStore` trait with a **local-filesystem** impl to start (zero-config on
k3d; fine for the bounded pre-publish working set — artifacts only need to survive
from run-finish until publish-or-discard, since a published run's source goes to a
public git repo and its build to Cloudflare Pages as today). An **R2** impl is
added later when serving load demands it. Because the store is internal to this
service, that swap — and any caching/CDN — never touches the backend or the
clients. The PVC-vs-R2 question is now a deferrable internal detail of this binary.

(Rejected alternative: driver → R2 directly + backend-minted signed URLs, no
service. It offloads everything but spreads R2 write creds into driver pods, needs
signed-URL machinery, and makes local dev worse — MinIO instead of a plain
directory. The service keeps clients dumb and local dev a plain directory.)

## Design

- New crate `crates/artifacts` (bin `tcab-artifacts`), an HTTP service.
- **Backing store:** an `ArtifactStore` trait; `LocalFsStore` impl first (a root
  dir on a PVC), keyed per run id. R2 impl later.
- **Upload (driver → service):** the driver POSTs its collected artifacts after
  the run, authed by the **per-job token**. The service validates the token
  against the backend (the token authority) — add a small backend internal
  verify endpoint, or mint job tokens as an HMAC of the job id under a shared
  secret so the service can verify statelessly (HMAC is the better long-term form;
  a verify call is the simpler v1).
- **Serve (reviewer → service):** `/runs/{id}/build`, `/runs/{id}/build/{*path}`,
  `/runs/{id}/proof/{file}`, `/runs/{id}/asset/{file}` — **reuse the core
  resolvers** the worker + desktop already use (`find_build_output`,
  `serve_build_file`, `serve_proof_file`, `serve_asset_file`), so serving logic
  is not reinvented. Pre-publish artifacts are private, so reads require an
  **account token**, validated against the auth service via `AccountsClient`
  (core) — the same pattern the backend's `AuthUser` uses.

## Touch points elsewhere

- **Driver (extends task-1):** after the run, upload the collected
  implementation/build/media to the artifact service.
- **Backend:** a pre-publish run's record `links.playable_build` should resolve to
  the artifact service (the worker set `/runs/{id}/build/`); the console needs to
  learn the artifact service base URL (e.g. reported via the backend's health/
  config) and resolve build/media links against it. This reintroduces one
  data-plane URL alongside the single backend URL — acceptable (it is explicitly
  the data plane). Plus the internal job-token verify endpoint (or HMAC tokens).
- **Deployment (folds into task-4 / Phase 6):** `artifacts.Dockerfile`, a k8s
  manifest (Deployment + its own PVC for the local-fs store), the CI image, and
  the local k3d overlay wiring. RBAC: none beyond its own SA (it talks HTTP to the
  backend + auth, it does not touch the k8s API).

## Verification

- `cargo build`/`clippy` (warnings denied).
- Upload→serve roundtrip against the `LocalFsStore` (a temp dir): upload a fake
  build, fetch `/runs/{id}/build/index.html`, assert content + base-href rewrite.
- Read auth: a request without a valid account token is rejected; upload without a
  valid job token is rejected.
- End-to-end on k3d (user, folded into task-4): a finished run's build is playable
  in the reviewer UI, served from `tcab-artifacts`, with the backend untouched by
  the artifact traffic.
