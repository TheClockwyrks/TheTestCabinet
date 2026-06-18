---
title: Overview
---

The worker is an [Axum](https://github.com/tokio-rs/axum) server that exposes
The Test Cabinet's run functionality over an HTTP API. It is effectively the
[CLI](/components/cli/overview/) — or a headless [Tauri](/components/tauri/overview/)
instance — with a web API in front of it instead of a command line: the same
[core](/components/core/overview/) functionality, reached over the network rather
than from a shell.

Its purpose is to let test cases be invoked on a **remote** machine. A run needs
a container runtime and meaningful compute; the worker lets that machine be
separate from wherever a person is driving things, so runs can be launched on a
dedicated host (or several) instead of on a laptop.

## Relationship to the Core

Like every other runner, the worker re-implements none of a run's behavior. It
translates HTTP requests into core calls and streams the results back:

- It accepts a request to run a test case — a version, a
  [variant](/components/core/test-cases/#variants), a
  [harness](/components/core/harnesses/), and a model — and drives the run
  through the core.
- It surfaces the run's live [harness events](/components/core/events/) over the
  API so a caller can render progress remotely, exactly as the CLI prints them
  locally.
- It produces the same [run record](/components/core/run-records/) a local run
  would, and can [publish](/components/core/results/) on the same terms.

Because it is a [runner](/components/architecture/#runners-and-reporters), the
worker's host needs a supported container runtime, and it resolves test case
definitions from, and publishes results to, the
[backend](/components/backend/overview/). Like the backend, it is intended to
live on the private network rather than be exposed publicly.

## Status

The worker is implemented as the `test-cabinet-worker` crate (`crates/worker`),
an [Axum](https://github.com/tokio-rs/axum) server that drives runs through the
core and streams their live events back.

Because a run can last up to an hour, the worker uses an **async job model**
rather than holding one request open for the whole run:

- `POST /runs` — submit a run (`testCase`, `version`, `variant`, `harness`,
  `model`, optional `maxRuntimeSeconds`). Returns a **job id** immediately
  (`202 Accepted`) along with the status and events URLs. Request schema:
  [`worker-api/submit-run-request.schema.json`](https://docs.testcabinet.ai/schema/worker-api/submit-run-request.schema.json);
  response schema:
  [`worker-api/submit-run-ack.schema.json`](https://docs.testcabinet.ai/schema/worker-api/submit-run-ack.schema.json).
- `GET /runs` — list the runs this worker has **produced**: every
  [run record](/components/core/run-records/) it has written to its output
  directory, newest first by finish time, each paired with a null review (a
  worker keeps no review store — a run gains one only when published). The
  consoles read this to surface produced-but-unpublished runs in the gallery.
  Response schema:
  [`worker-api/produced-runs.schema.json`](https://docs.testcabinet.ai/schema/worker-api/produced-runs.schema.json).
- `GET /runs/{job}` — the job's current status (`running` | `succeeded` |
  `failed`), and the produced [run record](/components/core/run-records/) once it
  has finished (or the failure `detail`). `404` for an unknown job id. Schema:
  [`worker-api/job-status.schema.json`](https://docs.testcabinet.ai/schema/worker-api/job-status.schema.json).
- `GET /runs/{job}/events` — the live [harness events](/components/core/events/)
  as NDJSON, one normalized event per line. A subscriber that connects after
  submit is first replayed every event so far, then receives new events as the
  harness produces them; the stream closes when the run reaches a terminal state.
  Each line is a [`HarnessEvent`](/components/core/events/); the event taxonomy is
  documented there rather than as a published JSON schema.
- `GET /runs/{id}/events.jsonl` and `GET /runs/{id}/raw.jsonl` — a **finished**
  run's recorded streams, served verbatim from its output directory as NDJSON and
  keyed by run-record id (unlike the live `/{job}/events` stream above, which is
  keyed by job id and only exists while the job is in memory). The first is the
  normalized event log, the second the raw harness output it was mapped from;
  together they back the run-detail Events tab after a run finishes. `404` when
  the run or that stream is absent.
- `POST /publish` — [publish](/components/core/results/) a finished run on the
  same terms a local `tcab publish` does (release the source repo, deploy the
  build, submit the record + review + links to the
  [backend](/components/backend/overview/)). A worker keeps no review store, so
  the review (`rating`, `writeup`, `checklist`) is sent inline with the run id.
  Request schema:
  [`worker-api/publish-run-request.schema.json`](https://docs.testcabinet.ai/schema/worker-api/publish-run-request.schema.json);
  response schema:
  [`worker-api/publish-run-ack.schema.json`](https://docs.testcabinet.ai/schema/worker-api/publish-run-ack.schema.json).
- `GET /healthz` — liveness/readiness and identity (the backend this worker is
  bound to, for the UI's backend-consistency check). Schema:
  [`worker-api/health.schema.json`](https://docs.testcabinet.ai/schema/worker-api/health.schema.json).

On failure every endpoint returns the same `{ "error": { "code", "message" } }`
envelope the backend uses, paired with an appropriate status. Schema:
[`backend-api/error.schema.json`](https://docs.testcabinet.ai/schema/backend-api/error.schema.json).

It resolves test-case definitions from, and publishes results to, the backend
(`TCAB_BACKEND_URL`); it has no local
checkout. Configuration is by environment variable (`TCAB_WORKER_BIND`,
`TCAB_BACKEND_URL`, `TCAB_WORKER_OUT_DIR`, `TCAB_WORK_DIR`). Like the backend,
there is **no
app-level auth** — bind it to a private-network interface and let reachability be
the access control.
