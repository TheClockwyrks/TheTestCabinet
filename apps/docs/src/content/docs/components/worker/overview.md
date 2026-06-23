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
somewhere to start containers and meaningful compute; the worker lets that be
separate from wherever a person is driving things, so runs can be launched on a
dedicated host (or several) instead of on a laptop. How it starts each run's
container is selected by `TCAB_WORKER_RUNTIME`: `cli` (the default) shells out to
a host Docker/Podman, the shape used for local development; `kubernetes` creates a
**run pod per run via the Kubernetes API**, the shape used in a
[cluster deployment](/deployment/kubernetes/).

## Relationship to the Core

Like every other runner, the worker re-implements none of a run's behavior. It
translates HTTP requests into core calls and streams the results back:

- It accepts a request to run a test case — a version, a
  [variant](/testing/end-to-end/overview/#variants), a
  [harness](/components/core/harnesses/), and a model — and drives the run
  through the core.
- It surfaces the run's live [harness events](/components/core/events/) over the
  API so a caller can render progress remotely, exactly as the CLI prints them
  locally.
- It produces the same [run record](/components/core/run-records/) a local run
  would, and can [push, review, and publish](/components/core/results/#lifecycle)
  on the same terms.

Because it is a [runner](/components/architecture/#runners-and-reporters), the
worker needs somewhere to start run containers — a host container runtime
(`cli`), or RBAC to manage pods in a namespace (`kubernetes`) — and it resolves
test case definitions from, and publishes results to, the
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
  directory, newest first by finish time, each paired with no reviews (a
  worker keeps no review store — reviews live on the backend, attributed to the
  account that wrote them). The consoles read this to surface
  produced-but-unpushed runs in the gallery.
  Response schema:
  [`worker-api/produced-runs.schema.json`](https://docs.testcabinet.ai/schema/worker-api/produced-runs.schema.json).
- `GET /runs/active` — the runs this worker is **currently executing**, each by
  the launch identity captured at submit (`runId`, `testCaseSlug`, `variant`,
  `harnessSlug`, `modelId`). A job that reaches a terminal state drops out of this
  list (it is then a produced run). The consoles seed their in-progress list from
  it so a run being watched survives a page reload. Response schema:
  [`worker-api/active-runs.schema.json`](https://docs.testcabinet.ai/schema/worker-api/active-runs.schema.json).
- `GET /runs/{job}` — the job's current status (`running` | `succeeded` |
  `failed`), and the produced [run record](/components/core/run-records/) once it
  has finished (or the failure `detail`). `404` for an unknown job id. Schema:
  [`worker-api/job-status.schema.json`](https://docs.testcabinet.ai/schema/worker-api/job-status.schema.json).
- `GET /runs/{job}/events` — the live [harness events](/components/core/events/)
  as NDJSON, one normalized event per line. A subscriber that connects after
  submit is first replayed every event so far, then receives new events as the
  harness produces them; the stream closes when the run reaches a terminal state.
  Each line is a [`HarnessEvent`](/components/core/events/); the event taxonomy is
  documented there rather than as a published JSON schema. An **asset-generation**
  run also interleaves live drawing frames on this same stream as the model draws
  — lines tagged `"type": "asset_preview"` carrying the
  [preview frame](/testing/asset-generation/binaries/#live-preview) (frame index,
  operation count, and the frame's base64 PNG). A subscriber tells them apart by
  that `type` (no `HarnessEvent` uses it) and renders them as the live sprite; they
  are **not** recorded, so the latest frame per index is replayed on reconnect but
  none appear in `events.jsonl`. Other run types emit none.
- `GET /runs/{id}/events.jsonl` and `GET /runs/{id}/raw.jsonl` — a **finished**
  run's recorded streams, served verbatim from its output directory as NDJSON and
  keyed by run-record id (unlike the live `/{job}/events` stream above, which is
  keyed by job id and only exists while the job is in memory). The first is the
  normalized event log, the second the raw harness output it was mapped from;
  together they back the run-detail Events tab after a run finishes. `404` when
  the run or that stream is absent.
- `GET /runs/{id}/build`, `GET /runs/{id}/build/`, and `GET /runs/{id}/build/{path}`
  — serve a **produced** run's playable static build directly from disk (the build
  output collected beside its implementation), so a reviewer can play it *before*
  it is published. The bare/trailing-slash roots serve the build's `index.html`
  relocated under this per-run base path; the wildcard serves the assets it
  references. A produced run with a build advertises this root as its
  `playableBuild` link in `GET /runs` (root-relative, against the worker's own
  origin), since publishing — which deploys the build and fills in a public URL —
  has not happened yet. `404` for an unknown run, a run with no build, or a path
  that does not resolve inside it.
- `GET /runs/{id}/asset/{file}` — an
  [asset-generation](/testing/asset-generation/overview/) run's media, resolved
  from the produced run record's `validation.asset` (`{file}` is
  `regenerated.png`, `preview.png`, `target.png`, or `actions.json`). This lets a
  reviewer see the regenerated/target/preview side-by-side on a **produced** run
  *before* it is published — the same artifacts the desktop core serves over its
  `tcab-asset://` scheme and the backend exposes for published runs. `404` for an
  unknown run, a non-asset-generation run, or an unrecognized file.
- `GET /notifications` — a worker-wide [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
  stream of run completions, one event per run reaching a terminal state (`kind`
  `run-completed`). Distinct from `/runs/{job}/events` (a single run's events):
  the console subscribes here once to raise a completion alert without polling
  and without holding a per-run subscription open. The stream is **live-only** —
  it replays no backlog, so a completion that occurs while no client is connected
  is not delivered (the run still surfaces via `/runs` and drops out of
  `/runs/active`). Each event's `data` is a
  [`worker-api/notification.schema.json`](https://docs.testcabinet.ai/schema/worker-api/notification.schema.json).
- `POST /auth/register` and `POST /auth/login` — the worker **proxies** these to
  the [auth service](/components/auth/overview/) so the consoles have a single
  origin to talk to. Register creates an [account](/components/backend/overview/#accounts);
  login returns the `{ token, account }` the console then presents on push, review,
  and publish. The worker does not store the token — it just forwards the user's
  bearer token onward to the backend on each mutating call below.
- `POST /push` — the **release** half of the
  [lifecycle](/components/core/results/#lifecycle): release a finished run's source
  and build and store its record on the [backend](/components/backend/overview/)
  **without** a review (`{ runId }`). The run is private but its build is playable
  for review. The worker forwards the caller's bearer token to the backend.
- `POST /review` — submit a [review](/components/core/results/#reviews) for a
  pushed run (`{ runId, ratings, writeup, checklist }`); a worker keeps no review
  store, so the review is sent inline and forwarded — with the caller's bearer
  token, which attributes it to the account — to the backend's
  `POST /runs/{id}/reviews`. Request schema:
  [`worker-api/publish-run-request.schema.json`](https://docs.testcabinet.ai/schema/worker-api/publish-run-request.schema.json).
- `POST /publish` — flip a pushed, reviewed run **public** (`{ runId }`),
  forwarding the bearer token to the backend's `POST /runs/{id}/publish`. The
  backend refuses a run with no review. Response schema:
  [`worker-api/publish-run-ack.schema.json`](https://docs.testcabinet.ai/schema/worker-api/publish-run-ack.schema.json).
  Each of `push`, `review`, and `publish` requires a bearer token (`401` without).
- `GET /healthz` — liveness/readiness and identity: the service `status`, the
  contract `version`, a `role` of `worker`, and the `backendUrl` this worker is
  bound to (so the UI can check a worker shares the backend it is itself pointed
  at). Schema:
  [`worker-api/health.schema.json`](https://docs.testcabinet.ai/schema/worker-api/health.schema.json).

On failure every endpoint returns the same `{ "error": { "code", "message" } }`
envelope the backend uses, paired with an appropriate status. Schema:
[`backend-api/error.schema.json`](https://docs.testcabinet.ai/schema/backend-api/error.schema.json).

It resolves test-case definitions from, and pushes/reviews/publishes results to,
the backend (`TCAB_BACKEND_URL`); it has no local checkout. It proxies account
register/login to, and forwards bearer tokens against, the
[auth service](/components/auth/overview/) (`TCAB_AUTH_URL`). Configuration is by
environment variable (`TCAB_WORKER_BIND` — `8788` by default,`TCAB_BACKEND_URL`,
`TCAB_AUTH_URL`, `TCAB_WORKER_OUT_DIR`, `TCAB_WORK_DIR`, and — when
`TCAB_WORKER_RUNTIME=kubernetes` — the `TCAB_K8S_*` run-pod settings documented in
[Kubernetes: staging & prod](/deployment/kubernetes/#worker)). Like the backend, the
worker has no accounts of its own and stays on the private network; the bearer
tokens it forwards are an identity layer carried *through* it to the backend, not
a login the worker itself performs. Bind it to a private-network interface and let
reachability remain the first line of access control.
