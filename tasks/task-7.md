# Task 7 — Subscription-based harness auth in the service flow (CRITICAL)

**Status:** not started. **Priority:** critical. **Depends on:** the driver +
dispatcher (done, tasks 1–2). **Relates to:** the local k3d secrets path
(`deployments/local/Makefile`).

## Goal

Make **subscription** harness authentication work for **backend-driven runs**
(per-run driver Jobs), not just API-key auth. Today the service flow can only run
a harness in **API-key** mode; subscription mode silently isn't an option there.
The CLI/desktop in-process path keeps working unchanged — this is purely about the
driver/cluster path.

## Why this is a gap (and not a regression)

The deleted worker **never** supported subscription auth either — it was API-key
only, because a worker pod has no host filesystem to read credential files from.
So this is a first-time implementation for the server topology, but it is now
**critical**: several harnesses are subscription-capable and
[Antigravity](apps/docs/src/content/docs/harnesses/antigravity/overview.md) is
subscription-**only** (no API-key mode at all), so it cannot run via the console
today.

## How auth works today (the two modes)

- **`crates/core/src/auth.rs`** — `resolve_auth(harness) -> AuthPlan` reads
  `TCAB_AUTH_MODE` / `TCAB_AUTH_MODE_<SLUG>` and returns either:
  - `AuthPlan::ApiKey { container_env, key }` — injected as an env var, **or**
  - `AuthPlan::Subscription { files: Vec<ContainerFile> }` — credential **files**
    copied into the run container.
  - `SubscriptionSpec` / `CredFile` declare each harness's files: a host
    `CredSource` (e.g. `~/.claude/.credentials.json`, `$CODEX_HOME/auth.json`, the
    Antigravity OAuth token), a `container_path`, a `mode` (e.g. `0o600`), and
    `required`.
- The plan is applied in `RunEngine::run_resolved` (`crates/core/src/lib.rs`):
  subscription files become `ContainerSpec.files`, which the runtime materializes —
  `CliContainerRuntime::materialize_files` (`crates/core/src/container.rs`, host
  `docker/podman cp`) and `KubernetesContainerRuntime::materialize_files`
  (`crates/driver/src/kubernetes.rs`, tar-extract into the pod).
- **Crucially:** `resolve_auth` reads the credential files from the **host
  filesystem** with `std::fs`. That works for the CLI/desktop (run on a trusted
  host); it cannot work inside an ephemeral driver pod, which has no such files.

**The materialization mechanism already exists** in both runtimes — the
**missing piece is getting the credential bytes to the driver** so it can populate
`ContainerSpec.files`.

## Not to be conflated

`crates/auth-service` (`tcab-auth-service`) and core `AccountsClient` are the
app's **user accounts** (login/register/review attribution) — unrelated to harness
provider subscriptions. Don't route harness credentials through it without a
deliberate decision (see the per-account option below).

## Design decision to make (the load-bearing one)

Subscription credentials live on a **trusted host**; in the cluster topology there
is no such host in the run path. Where do the files come from? Two shapes:

1. **Operator-provided subscription Secret (recommended v1).** Mirror the API-key
   path: an operator creates a k8s Secret holding the subscription files (the same
   files `CredFile` names), the **dispatcher** mounts it into each driver Job (a
   new `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_*` alongside the existing
   `TCAB_DISPATCHER_DRIVER_SECRETS`), and the **driver** writes them to the paths
   `resolve_auth` expects (or feeds them straight into `ContainerSpec.files`). One
   shared subscription per deployment. Minimal, matches the existing secret model,
   unblocks Antigravity immediately.
2. **Per-account credential vault (larger follow-up).** The user uploads their
   subscription files via the console/CLI; the backend stores them encrypted,
   keyed to the **account** (ties into `tcab-auth-service`); at enqueue the backend
   attaches the credential reference to the job, and the dispatcher mounts a
   per-job Secret. Multi-tenant-correct but a real build (secure storage, upload
   UI/CLI, lifecycle/rotation).

Recommendation: ship **(1)** first to restore parity (and unblock Antigravity),
design **(2)** as the multi-tenant story. Capture whichever is chosen here before
building, the way task-5 fixed its storage decision up front.

## Steps (for option 1)

1. **Driver: resolve subscription files without a host.** Add a driver path that
   builds the subscription `ContainerSpec.files` from credentials handed in via
   env/mounted Secret rather than from `~`. Likely a small seam in
   `crates/core/src/auth.rs` (a `resolve_auth` variant that takes the bytes
   explicitly) so the driver reuses `CredFile`'s `container_path`/`mode` instead of
   duplicating them. New driver config in `crates/driver/src/config.rs`.
2. **Dispatcher: forward the subscription Secret** into each driver Job (env +
   secret mount), analogous to `TCAB_DISPATCHER_DRIVER_SECRETS` in
   `crates/dispatcher` + `deployments/k8s/dispatcher.yaml`.
3. **Auth-mode selection over the wire.** Ensure `TCAB_AUTH_MODE[_SLUG]` reaches
   the driver (via `LaunchBody` or driver env) so a console can request
   subscription mode; default stays API-key.
4. **Local k3d wiring.** Extend `deployments/local/Makefile` + the local overlay
   to create a subscription Secret from the host (read the same credential files
   the CLI uses, e.g. `~/.claude/.credentials.json`) so the local stack can
   exercise subscription mode — keeping the "no secret on disk in a tracked file"
   property the API-key path now has.
5. **Docs.** Update `quickstarts/set-up-authentication.md` and the new
   `guides/running-the-local-service-stack.md` (it currently states subscription
   auth is *not* wired into the local stack — flip that once this lands), plus
   `components/core/harnesses.md` (Authentication) and the affected harness pages.

## Verification

- `cargo build`/`clippy` (warnings denied).
- Unit: the driver builds the correct `ContainerSpec.files` (paths + `0o600`
  modes) from injected credential bytes, with no host filesystem access.
- k3d e2e: a subscription-only harness (**Antigravity**) completes a backend-driven
  run; a Claude subscription run records cost as-is (not OpenRouter fallback).
- API-key runs are unchanged.
