# Task 3 — `tcab-publisher` crate (the per-publish Job binary)

**Status:** ⬜ Not started. Depends on task-1 (result/stream endpoints) and task-4
(`tree.tar` download). Mirror the **driver** crate's shape (`crates/driver`).

## Goal

A new binary crate `crates/publisher` (package `tcab-publisher`) that runs as the
per-publish Job: download the run's implementation tree, perform the GitHub +
Cloudflare Pages release via `BackendPublisher`, and report progress + the terminal
result back to the backend (over the publish-job token).

## Shape

Mirror `crates/driver/src/main.rs` (env-configured, no server, telemetry init,
do-work, report terminal status, exit). Add to the workspace `Cargo.toml` members.

### Config (env, from the Job built in task-2)

`TCAB_BACKEND_URL`, `TCAB_PUBLISH_JOB_ID`, `TCAB_PUBLISH_JOB_TOKEN`,
`TCAB_PUBLISH_RUN_ID`, `TCAB_ARTIFACTS_URL`, plus `TCAB_GITHUB_ORG` /
`TCAB_PAGES_PROJECT` (read by `PublishConfig::from_env`, `crates/core/src/publish.rs:190`).
`GH_TOKEN` + `CLOUDFLARE_API_TOKEN` arrive via `envFrom` (used by `gh`/`wrangler`
directly — the binary doesn't parse them).

### Steps

1. **Download the run tree** from the artifact service: `GET
   {TCAB_ARTIFACTS_URL}/runs/{run_id}/tree.tar` authed with the publish-job token
   (task-4 defines the auth). Untar into a temp dir → `run-record.json` +
   `implementation/` + `events.jsonl`. (No download client exists today; write a
   small `reqwest` GET + `tar`/`flate2` untar, or a thin client in this crate.
   `crates/driver/src/artifacts.rs:73` is the upload analogue to mirror.)
2. **Build the `PushRequest`** (`crates/core/src/publish.rs:31`):
   `record` = parse `run-record.json`; `artifacts` = `ArtifactCollection {
   repo_path: <impl dir> }`; `build_dir` = `find_build_output` over the impl dir
   (`crates/core/src/playable.rs`); `events` = `read_event_log` (`publish.rs:56`).
3. **Construct `BackendPublisher`** with `SystemCommandRunner` and a `BackendClient`
   (the `B` type param). NOTE: `release_code` + `release_playable_build` do **not**
   use the backend client — pass `HttpBackendClient` (or a no-op) to satisfy the
   type; **do not** call `push`/`push_run` (those POST `/runs` with an account
   token the publisher doesn't have).
4. **Release:** call `release_code` (gh/git → repo URL or `None`) then
   `release_playable_build` (wrangler → build URL or `None`). Stream a progress line
   to `POST /publish-jobs/{id}/events` before/after each step (optional for v1 but
   cheap, and the reason we chose streaming — see context.md).
5. **Report terminal result:** `POST /publish-jobs/{id}/result` with
   `PublishResult { state: Succeeded, source_repo, playable_build, detail: None }`
   (`core::publish_job_api`). On any error, report `Failed` with the reason, then
   exit non-zero.

## Notes

- Secret scrubbing is already inside `release_code`/`release_playable_build`
  (`SecretScrubber`), so leaked keys are redacted before the push — keep using
  those methods rather than re-implementing.
- Keep the binary slim; the heavy lifting is in `core`.

## Tests

- Unit-test the result/progress reporting client against a stub server, and the
  tree-download/untar against a fixture tar. The release orchestration itself is
  already covered by `BackendPublisher`'s tests (`publish.test.rs`).

## Out of scope

The image (task-5) and the `tree.tar` server route (task-4).
