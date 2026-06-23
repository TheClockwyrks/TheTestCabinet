# Task 1 — Phase 3: the per-run driver crate

**Status:** not started. **Depends on:** Phase 2 (committed). **Blocks:** task-2, task-4.

## Goal

A new one-shot binary, `tcab-driver` (`crates/driver`), that executes exactly one
run and streams its progress to the backend, then exits. It is the worker's drive
logic minus the HTTP server and in-memory job registry, with the in-process event
sinks swapped for backend-streaming ones.

## Background (the code it absorbs)

- `crates/worker/src/runner.rs` — `drive_run → run_inner → drive_engine`: creates
  scratch dirs, `materialize_version`s the definition from the backend, selects a
  `ContainerRuntime`, assembles `RunEngine`, calls
  `run_resolved(request, test_case, &mut events, Some(preview))`. On `Ok` →
  record; on `Err` → `write_failed_record`. **This is the driver's body.**
- `crates/worker/src/jobs.rs` — `JobEventSink`/`JobPreviewSink` (the sinks to
  replace). `EventSink::emit(&mut self, &HarnessEvent)` and
  `PreviewSink::preview(&self, AssetPreview)` are **synchronous**.
- `crates/worker/src/kubernetes.rs` — `KubernetesContainerRuntime` /
  `KubernetesArtifactCollector` / `KubernetesConfig` (the sandbox-pod runtime).
- Core seams already exported: `CliContainerRuntime`, `CliArtifactCollector`,
  `HttpBackendClient`, `materialize_version`, `RunEngine`, `EventSink`,
  `PreviewSink`, `write_failed_record`.

## Steps

1. **Move the shared job-API wire types into `core`** (`crates/core/src/job_api.rs`,
   re-exported from `lib.rs`): `LaunchBody`, `ClaimedJob`, `StatusUpdate`,
   `DriverState` (currently in `crates/backend/src/api/jobs.rs`). Update the
   backend to import them from core. Rationale: the driver and dispatcher are
   clients of the backend's job API and must share these types without depending
   on the heavy backend crate. Keep the contract `cfg_attr` derives.

2. **Create `crates/driver`** (bin `tcab-driver`): `Cargo.toml` (deps:
   `test-cabinet-core`, `test-cabinet-telemetry`, `reqwest`, `serde`,
   `serde_json`, `tokio`, `time`, `tracing`, `anyhow`/`thiserror`; the k8s deps
   `kube`/`k8s-openapi` when the Kubernetes arm lands), register in the workspace
   `Cargo.toml`, add `[lints] workspace = true`.

3. **Config** (env, resolved in `config.rs`): `TCAB_BACKEND_URL`, `TCAB_JOB_ID`,
   `TCAB_JOB_TOKEN`, `TCAB_RUN_REQUEST` (the `LaunchBody` JSON the dispatcher
   passes), `TCAB_DRIVER_RUNTIME` (`cli` | `kubernetes`, default `cli`),
   `TCAB_WORK_DIR`/scratch (ephemeral), plus the `TCAB_K8S_*` set for the
   Kubernetes arm. The driver builds a `RunRequest` from the `LaunchBody` exactly
   as `worker submit` does (`OrchestratorSelection`, `ONE_SHOT_SLUG` default).

4. **Backend job client** (`client.rs`, `reqwest`): `post_status(running)`,
   `post_events(&[HarnessEvent])`, `post_preview(&AssetPreview)`,
   `post_status(succeeded, record)` / `post_status(failed, detail, record?)`. All
   send `Authorization: Bearer <job_token>`.

5. **Backend-streaming sinks** (`sink.rs`): the sinks are synchronous but sending
   is async, so push into a `tokio::mpsc::unbounded` channel and drain it on a
   background task. `enum Outbound { Event(HarnessEvent), Preview(AssetPreview) }`;
   `BackendEventSink`/`BackendPreviewSink` just `tx.send(...)`. A `relay_task`
   drains the channel, **batching** events into one `post_events` per drain and
   posting previews individually, until the channel closes.

6. **Drive** (`main.rs` + `run.rs`): `post_status(running)` → build engine with
   the selected runtime → `run_resolved` with the streaming sinks → drop the sinks
   and **await the relay task** (so the backlog is fully flushed before the record
   is persisted) → on `Ok(record)` `post_status(succeeded, record)`; on
   `Err(failure)` build a failed record via `write_failed_record` and
   `post_status(failed, detail, Some(record))` with the **specific** reason.

7. **Port `kubernetes.rs`** into the driver (duplicate from the worker; the worker
   keeps its copy until Phase 6's clean cut) and wire the `kubernetes` arm of the
   runtime match. The driver pod is the trusted pod that creates the untrusted
   sandbox; `TCAB_K8S_POD_IP` (downward API) routes the preview hostAlias to the
   driver's own pod IP. (Can land as step 7 after the CLI path is proven.)

## Out of scope here

Artifact upload (generated source/build/media) — that is `task-5.md`. The driver's
record/event/status streaming does not depend on it.

## Verification

- `cargo build -p test-cabinet-driver`, `cargo clippy -p test-cabinet-driver`
  (warnings denied), workspace still builds.
- Unit test the streaming relay: feed events/previews through the sinks and assert
  the relay task batches and posts them (a stub HTTP server, or assert on the
  channel-drain/batch logic directly).
- Full runtime verification (CLI runtime locally; Kubernetes runtime on the user's
  cluster) happens with the dispatcher in task-2 / the k3d e2e in task-4.
