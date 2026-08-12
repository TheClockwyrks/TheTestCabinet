---
title: Overview
---

The driver is the per-run executor: it runs exactly one test case and exits. The
[dispatcher](/components/dispatcher/overview/) creates one driver `Job` per
claimed run. The driver resolves the definition from the
[backend](/components/backend/overview/), drives the run through the
[core](/components/core/overview/), streams live progress back to the backend,
uploads the produced tree to the [artifact
service](/components/artifacts/overview/), and reports its terminal status
carrying the produced [run record](/components/core/run-records/).

Everything the driver needs arrives in its environment when the dispatcher
creates the `Job`. It binds no socket, takes no flags, and keeps no state beyond
the run.

## Relationship to the core

Like every other [runner](/components/architecture/#runners-and-reporters), the
driver takes a run's behavior from the core. It assembles the same
[`RunEngine`](/components/core/execution/) any other host does and swaps the
in-process sinks for backend-streaming ones.

- It accepts the launch request the dispatcher passed in and drives the run
  through the core. The request names a version, a variant, a
  [harness](/components/core/harnesses/), a model, and an
  [orchestrator](/components/core/orchestrators/).
- It streams the run's live [harness events](/components/core/events/) to the
  backend as they happen, along with the live drawing [preview
  frames](/testing/asset-generation/sprite-binaries/#live-preview) of an
  [asset-generation](/testing/asset-generation/overview/) run. The backend's
  relay fans them out to every watching console.
- It produces the same [run record](/components/core/run-records/) any other
  host would and reports it with the terminal status. The backend persists it
  using the events the relay already accumulated.

The driver reports `starting` before any work, advances the job to `running`
once setup finishes and the harness session is about to begin, and posts its
terminal status once. It waits for the relay to drain first, so every streamed
event has reached the backend before any terminal status is sent.

## Sandbox container runtime

`TCAB_DRIVER_RUNTIME` selects how the run's sandbox container is started.

- `kubernetes`, the shape the dispatcher always sets, makes the driver the
  trusted pod. It creates one untrusted sandbox pod per run through the
  Kubernetes API, waits for it to be `Running`, seeds the working tree and
  `exec`s the harness session into it, copies the produced `/work` tree out, and
  deletes the pod. The sandbox pod gets no ServiceAccount token, so only the
  driver reaches the API.
- `cli`, the default, shells out to a host Docker or Podman for a single-box or
  test setup.

[Asset preview](/components/live-streaming/) works the same under both. The
in-container process connects back to a TCP listener on the driver's own pod IP,
supplied via the downward API as `TCAB_K8S_POD_IP`, and the driver forwards each
frame to the backend.

## Cancellation

A run can be killed while it is in progress from the console's live monitor. The
console asks the backend to cancel the job, the backend moves it to the terminal
`canceled` state and closes its live stream, and every watching monitor reflects
the end at once. The operator's answer is settled immediately and waits on
nothing the run still has to do.

The run itself winds down cooperatively. The driver polls its own job's state
while the run proceeds and, on observing the cancellation, raises the run's
cancellation latch and keeps awaiting the run, bounded by a 20-minute wind-down
grace. The harness is its own process inside the sandbox pod, so dropping the
run future would stop nothing that matters while skipping the stages that turn a
session into a result: collecting the produced tree, folding the accumulated
usage into metrics, and writing the record. The latch is a request to stop at
the next clean boundary, after which the run finishes through its ordinary path.

### gg wind-down

For a [gg](/gg/overview/) run the engine races the session against the latch. On
a kill it writes the cancellation sentinel, a file at the path gg was named in
its invocation document, and keeps draining gg's telemetry stream for up to its
own 10-minute grace so the session's epilogue is ingested.

Every gg agent, the root and every subagent, checks that sentinel at its turn
boundary, next to the run-wide deadline and cost ceilings and on the same terms
(see [Execution limits](/gg/execution-limits/#cancellation)). The turn already
in flight completes, so nothing is abandoned half-applied. The agent ends with
the terminal status `canceled` and no limit breach. The session then runs its
ordinary epilogue: the per-slot rollups, the session summary, the
[session-record](/gg/session-record/) sidecar, and the session-ended event.

The engine therefore gets back a normal harness outcome marked canceled,
carrying the tokens, the cost and the session summary the run accumulated, and
walks its whole post-session path: it collects the produced tree out of the
sandbox, runs the post-run analysis stages, folds the metrics, and assembles the
[run record](/components/core/run-records/).

The one stage a cancellation skips is
[validation](/components/core/validation/). Every other stage reads state the
run already produced, while validation is fresh work that judges output an
operator chose to stop, so a canceled run's validation summary is empty rather
than failed. The record's terminal state is
[`canceled`](/components/core/run-records/#status).

The driver then runs every artifact upload it runs for any other run and posts a
`canceled` status carrying the record. The backend persists it with the events
its relay accumulated and attaches it to the already-canceled job, changing
nothing else: no state change, no completion notification, and no retry.

### Degraded fallbacks

Two paths produce a bare canceled record instead: the session does not wind down
inside the grace, or the run errors on its way out. In both the driver builds
the record itself from what it still holds: state
[`canceled`](/components/core/run-records/#status), the detail
`canceled by operator`, and the resolved case identity and test type when the
definition had materialized. That record carries no produced tree and zero
metrics.

That record anchors the run's streamed data. The run streamed
[events](/components/core/events/) right up to the kill, and those are already
in the backend's hands; without a record to attach them to, the killed run never
reaches the run list. Recording here is best-effort: the job is already terminal
and the teardown still has to happen, so a record that cannot be built or posted
is logged rather than fatal.

Only gg has a wind-down protocol to be asked for. A third-party harness is a CLI
the Test Cabinet drives through an `exec`, with no boundary at which it can be
told to stop and no epilogue to wait for, so a canceled third-party run always
takes the degraded fallback.

### Teardown and late statuses

Whichever path recorded the run, the driver tears its sandbox down. The sandbox
outlives the run future, so under the Kubernetes runtime the driver deletes the
run's sandbox pod, which it finds by the job-id label it stamped on it. The
driver then exits successfully, so the cluster reads a canceled run as a driver
success rather than retrying it. The killed run appears in the run list like any
other unpublished run, with a working Events view, and is [never
publishable](/components/core/results/#publish).

Any other late status a winding-down driver posts before it notices the kill is
discarded by the backend, so only the driver's own `canceled` acknowledgement
can touch a canceled run.

## Artifacts

The sandbox pod is ephemeral and its disk is lost on exit, so the driver uploads
the produced run tree to the [artifact service](/components/artifacts/overview/)
(`TCAB_ARTIFACTS_URL`, forwarded by the dispatcher) before reporting terminal
status, and stamps the playable-build link onto the record. That tree is the
playable build, the proof media, and the asset media. By the time a console sees
the run finish, its build and media are already servable. When the artifacts URL
is unset the upload is skipped.

The artifact service serves a run only to the console session that produced it,
so the driver also mirrors a backend-driven run's servable media into the
[backend](/components/backend/overview/) store: every run's
proof-of-implementation media, synthesized validation media and code-analysis
document, an adversarial run's controller wasm and proof replays, a performance
run's scored scenarios, an asset-generation run's regenerated and preview images
with their action log, and a captured gg replay. That store, rather than the
artifact service, is what the backend exports the public
[snapshot](/components/backend/overview/) from and what the per-run tabs read.
Each mirror is best-effort: a failure is logged and the run's record still
reports.

The store is the fast path rather than the record of truth. It is an ephemeral
volume in production, so it can be empty for a run published after a backend
restart. The [snapshot builder](/components/backend/overview/) falls back to the
artifact service for any run media missing from the store and re-exports it to
durable R2, so a store wipe self-heals on the next refresh.
`scripts/backfill-run-media.sh` populates the store and triggers a refresh
immediately rather than waiting for the next publish.

## RBAC

Under the Kubernetes runtime the driver runs under the `tcab-driver`
`ServiceAccount`, with a namespaced `Role` granting exactly what creating the
sandbox needs: `core`/`pods` create/get/list/delete and `core`/`pods/exec`
get/create. Both exec verbs are required, because the driver's Kubernetes client
execs over a WebSocket, which the API server authorizes as `get`. The
[dispatcher](/components/dispatcher/overview/) names this ServiceAccount on
every `Job` it creates. The manifests are in `deployments/k8s/base/rbac.yaml`.
See [Kubernetes: staging & prod](/deployment/kubernetes/run-plane/#rbac).

## Deployment

The driver is the `test-cabinet-driver` crate (`crates/driver`). It is a client
rather than a server, so it carries no app-level auth of its own; its streaming
calls authenticate to the backend with the per-job token the dispatcher passed
in. Its configuration is entirely environment variables, documented in
`crates/driver/src/config.rs`.

The driver image ships no publish CLIs, because publishing is a separate backend
operation. It does carry the tooling a run needs end to end in-process: `git` to
seed each run's fresh repository, and a Node runtime with the bundled Playwright
browser to run an end-to-end case's build steps and load-check the build with a
headless screenshot. That is the same browser toolchain the
[backend](/components/backend/overview/) bakes to render references, so the
image layers the driver binary on the Node and browser base. It also bakes the
static-musl gg binary the core copies into each sandbox pod, so a gg run
installs locally with no network egress. The driver runs unprivileged and needs
no Docker or Podman daemon.
