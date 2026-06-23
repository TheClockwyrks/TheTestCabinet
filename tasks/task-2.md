# Task 2 — Phase 4: the dispatcher crate

**Status:** not started. **Depends on:** task-1 (the driver image must exist).
**Blocks:** task-4.

## Goal

A thin, stateless controller, `tcab-dispatcher` (`crates/dispatcher`), that turns
queued jobs into Kubernetes Jobs. It is the only component that talks to the k8s
API for Job creation; the backend stays k8s-agnostic.

## Design

A loop:

1. **Claim** the oldest queued job — `POST /jobs/next` with the shared service
   token (`ServiceAuth`). `204` → nothing queued, back off briefly; `200` →
   `ClaimedJob { job_id, job_token, request: LaunchBody }`.
2. **Create one k8s `Job`** per claimed run via the `kube` API:
   - pod template: the **driver** image; env `TCAB_BACKEND_URL`, `TCAB_JOB_ID`,
     `TCAB_JOB_TOKEN`, `TCAB_RUN_REQUEST` (the `LaunchBody` JSON),
     `TCAB_DRIVER_RUNTIME=kubernetes`, the `TCAB_K8S_RUN_*` resource requests, and
     `TCAB_K8S_POD_IP` from the downward API (`status.podIP`).
   - the **driver ServiceAccount** (the repurposed `tcab-worker` RBAC: create/exec/
     delete pods — to make the sandbox), `restartPolicy: Never`, `backoffLimit: 0`,
     `ttlSecondsAfterFinished` for auto-cleanup.
3. **Bound concurrency** with a configurable max in-flight (queue admission); no
   durable state of its own — the backend's `job` table is the source of truth.

Reuse the `kube`/`k8s-openapi` client setup and pod-spec helpers ported into the
driver in task-1 (the `Job` template wraps the same pod spec shape).

## Driver-pod-death detection (the infra-failure safety net)

A driver that dies before reporting (OOM, unschedulable, image pull failure on the
*driver* pod itself) never sends a `failed` status, so the job would hang in
`dispatched`/`running`. The dispatcher **watches** the Jobs it created; when a Job
fails terminally without the backend job having reached a terminal state, it
reports `POST /jobs/{id}/status {state: failed, detail: <k8s-derived reason>}` —
pod status / exit code / `pods/log` tail — so the job ends with a **specific**
diagnostic ("couldn't pull container image", "OOMKilled"), never a bare "run
failed". This is required by the "infra failures must record a real reason"
decision.

## Files

- `crates/dispatcher/**` (new): `Cargo.toml` (deps: `kube`, `k8s-openapi`,
  `reqwest`, `serde`/`serde_json`, `tokio`, `test-cabinet-core` for the shared
  job-API types + `test-cabinet-telemetry`), `main.rs`, `config.rs`, the claim
  client, the Job builder, the watch loop. Register in the workspace `Cargo.toml`.

## Verification

- `cargo build`/`clippy` (warnings denied).
- Unit-test the Job-spec builder (env, SA, TTL, resource requests, restart policy)
  from a `ClaimedJob`.
- Runtime verification needs a cluster → folded into the k3d e2e in task-4.
