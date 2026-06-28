# Task 2 — Dispatcher: claim publish jobs, build the publish Job

**Status:** ⬜ Not started. Depends on task-1 (the `/publish-jobs/next` claim
endpoint + `PublishClaim` wire type) and task-5 (the publisher image reference).

## Goal

Teach the dispatcher to drain the **publish** queue alongside the run queue: poll
`POST /publish-jobs/next`, and turn each `PublishClaim` into one `tcab-publisher`
Kubernetes Job — reusing the dispatcher's existing k8s client, control loop, and
RBAC (it already creates Jobs in-namespace, `deployments/k8s/base/rbac.yaml:59`).

## Changes (`crates/dispatcher`)

1. **`src/job.rs` — `build_publish_job(claim: &PublishClaim, config) -> Job`.**
   Mirror `build_driver_job` (`:97`), but:
   - image = `config.publisher_image` (new), container name e.g. `publisher`,
     `Job` name `tcab-publisher-{job_id}` (mirror `job_name` `:87`).
   - env: `TCAB_BACKEND_URL`, `TCAB_PUBLISH_JOB_ID`, `TCAB_PUBLISH_JOB_TOKEN`,
     `TCAB_PUBLISH_RUN_ID` (from the claim), `TCAB_ARTIFACTS_URL` (forwarded, for
     `tree.tar` download), `TCAB_GITHUB_ORG` / `TCAB_PAGES_PROJECT` (forwarded so
     `PublishConfig::from_env` resolves in the Job).
   - `envFrom` the **publisher** secret(s) (`config.publisher_secrets`, mirrors
     `driver_secrets` `:114`) — these carry `GH_TOKEN` (for `gh`) and the Cloudflare
     API token (`CLOUDFLARE_API_TOKEN`, for `wrangler`).
   - **No** sandbox-pod passthroughs, **no** `TCAB_K8S_POD_IP`, **no** subscription
     volume, **no** special ServiceAccount needing the K8s API — the publisher only
     talks HTTP (give it a minimal SA or the namespace default; it must NOT get the
     driver's pod-create RBAC). Reuse the same labels (`MANAGED_BY`,
     `JOB_ID_LABEL`) so reconciliation/cleanup works, `backoffLimit: 0`,
     `ttlSecondsAfterFinished`.
   - Keep it **pure** and unit-test the manifest (mirror `job.test.rs`).
2. **`src/controller.rs`** — poll both queues each tick. Either claim the run queue
   then the publish queue (`claim_next` / a new `claim_next_publish`), or interleave;
   keep the existing in-flight cap accounting (publish Jobs are cheap and few — a
   simple "also try a publish claim each tick" is fine). On a publish claim, call
   `build_publish_job` + create it (same `create`/error path as driver Jobs; a
   publish Job that dies is reported via the publisher's own result POST, or surfaces
   as a stuck `dispatched` publish_job — keep death-detection parity simple for v1).
3. **`src/config.rs`** — add `publisher_image` (`TCAB_PUBLISHER_IMAGE`) and
   `publisher_secrets` (`TCAB_DISPATCHER_PUBLISHER_SECRETS`, comma-separated,
   mirror `driver_secrets`). Both required only when publishing is enabled; default
   empty/None so a deployment without them simply never builds publish Jobs.

## Manifests

The dispatcher env additions (`TCAB_PUBLISHER_IMAGE`,
`TCAB_DISPATCHER_PUBLISHER_SECRETS`) are wired in task-6 (overlay patch), not here.

## Tests

- `build_publish_job` produces the expected image/env/labels and **no** sandbox
  passthroughs / pod-IP / driver SA (the inverse of the driver Job's extras).
- Config parses the two new env vars (and tolerates them being unset).

## Out of scope

The publisher binary itself (task-3) and the image (task-5).
