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
[`RunEngine`](/components/core/execution/) any other host does, with
backend-streaming sinks in place of the in-process ones.

- It drives the launch request the dispatcher passed in through the core. The
  request names a version, a variant, a [harness](/components/core/harnesses/),
  a model, and an [orchestrator](/components/core/orchestrators/).
- It streams the run's live [harness events](/components/core/events/) to the
  backend as they happen, along with the live drawing [preview
  frames](/testing/asset-generation/sprite-binaries/#live-preview) of an
  asset-generation run. The backend's relay fans them out to every watching
  console.
- It produces the same [run record](/components/core/run-records/) any other
  host would and reports it with the terminal status. The backend persists it
  using the events the relay already accumulated.

The driver reports `starting` before any work, advances the job to `running`
once setup finishes and the harness session is about to begin, and posts its
terminal status once, after the relay has drained so that every streamed event
has reached the backend first. The run's own start is taken immediately after
the `starting` report, so the [`startedAt`](/components/backend/api/#topics) the
backend stamps from that transition names the same instant the produced record
does.

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

A run can be killed while it is in progress. The console asks the backend to
cancel the job, the backend moves it to the terminal `canceled` state and closes
its live stream, so every watcher sees the end at once. The operator's answer is
settled immediately, waiting on nothing the run still has to do.

What happens to the run in flight depends on the harness. The driver polls its
own job's state while the run proceeds. On observing the cancellation it winds a
[gg](/gg/overview/) session down and records what the run produced. A run of any
other harness is destroyed outright, because gg is the one harness with a
wind-down protocol to ask for and every other is a CLI the Test Cabinet drives
through an `exec`.

A gg run is wound down only once gg has been launched inside the sandbox,
because what a kill preserves is what the session got through. A kill that lands
after that launch is a wind-down however little the session has done. A kill
that lands earlier, while the driver resolves the definition, pulls the image,
starts the sandbox, or seeds the workspace, destroys the run exactly as it
destroys a third-party one. Two checks enforce that boundary: the driver refuses
to advance the job to `running` once it has observed the kill, and the engine
refuses to launch a session against a raised latch and stops the sandbox it
started instead.

### gg wind-down

The driver raises the run's cancellation latch and keeps awaiting the run,
bounded by a 20-minute wind-down grace. Awaiting the run preserves the stages
that turn a session into a result. The latch is a request to stop at the next
clean boundary, after which the run finishes through its ordinary path.

The engine races the session against the latch. On a kill it writes the
cancellation sentinel, a file at the path gg was named in its invocation
document, and keeps draining gg's telemetry stream for up to its own 10-minute
grace so the session's epilogue is ingested.

Every gg agent, the root and every subagent, checks that sentinel at its turn
boundary on the same terms as the run-wide deadline and cost ceilings (see
[Execution limits](/gg/execution-limits/#cancellation)). The turn already
in flight completes, so nothing is abandoned half-applied. The agent ends with
the terminal status `canceled` and no limit breach, and the session then runs
its ordinary epilogue: the per-profile rollups, the session summary, the
[session-record](/gg/session-record/) sidecar, and the session-ended event.

The engine therefore gets back a normal harness outcome marked canceled,
carrying the tokens, the cost and the session summary the run accumulated, and
walks its whole post-session path: it collects the produced tree out of the
sandbox, runs the post-run analysis stages, folds the metrics, and assembles the
[run record](/components/core/run-records/). The one stage a cancellation skips
is [validation](/components/core/validation/), which is fresh work judging
output an operator chose to stop, so a canceled run's validation summary is
empty rather than failed. The record's terminal state is
[`canceled`](/components/core/run-records/#status).

The driver then runs every artifact upload it runs for any other run and posts a
`canceled` status carrying the record. The backend persists it with the events
its relay accumulated and attaches it to the already-canceled job, changing
nothing else: no state change, no completion notification, and no retry.

#### Degraded fallbacks

Two paths produce a bare canceled record instead: the session does not wind down
inside the grace, or the run errors on its way out. Both concern a session that
had been launched, since a run killed before that is destroyed rather than
recorded bare. In both the driver builds the record itself from what it still
holds: state [`canceled`](/components/core/run-records/#status), the detail
`canceled by operator`, and the resolved case identity and test type when the
definition had materialized. That record carries no produced tree and zero
metrics.

That record anchors the [events](/components/core/events/) the run streamed
right up to the kill, which the backend already holds, and is what brings the
killed run into the run list. Recording here is best-effort: the job is already
terminal and the teardown still has to happen, so a record that cannot be built
or posted is logged rather than fatal.

### Third-party destruction

A canceled run of any other harness is destroyed. The driver drops the run
future, tears the sandbox down, and exits. No record is built, no artifacts are
uploaded, and no terminal status is posted, so the job stays `canceled` with the
record slot empty and the run is absent from the run list. The events the relay
streamed before the kill are discarded with it.

Destroying the run is what frees its scheduling slot promptly, so the runs an
operator queues after a kill start straight away. The disposition is decided by
harness alone rather than by how far the run got, so a kill that lands in the
post-session stages destroys the run just as one landing mid-session does.

A run that reaches its own ending in the window between the kill and the
driver's next poll is not destroyed. The driver finalizes it like any other
finished run and posts its terminal status, which the backend discards, leaving
the job `canceled`.

### Teardown and late statuses

Every cancellation tears the sandbox down. The sandbox outlives the run future,
so the driver deletes it by the job-id label it stamped on it when it started
it: the run's sandbox pod under the Kubernetes runtime, and the run's container
under the CLI runtime. Deleting the sandbox is what ends the harness process and
stops it spending. The driver then exits successfully, so the cluster reads a
canceled run as a driver success rather than retrying it, and its `Job` goes
terminal. A gg run holds its dispatcher slot for the length of its wind-down,
bounded by the 20-minute grace.

The one exception is a destroyed run whose teardown failed. There the teardown
is the kill, so the driver exits non-zero instead: a failed driver `Job` is what
the dispatcher's [reaper](#sandbox-lifetime) looks for, and reporting the
failure hands it the sandbox that is still running the harness. A destroyed run
also sweeps twice, a couple of seconds apart, because dropping the run future
cancels an in-flight sandbox creation on the client side only and the sandbox
can still appear just after the first sweep looked.

A wound-down gg run appears in the run list like any other unpublished run and
is [never publishable](/components/core/results/#publish).

Any other late status a winding-down driver posts before it notices the kill is
discarded by the backend, so only the driver's own `canceled` acknowledgement
can touch a canceled run.

## Sandbox lifetime

The driver deletes the sandbox pod it created at the end of every run, and again
on [cancellation](#cancellation). Both of those are in-process, so a driver that
dies by `SIGKILL` from an OOM kill, an eviction, a node drain, or a spot
preemption runs neither. A leaked sandbox lives indefinitely, since its
keep-alive command is `sleep infinity` and it carries no `ownerReference`, and
it holds its CPU and memory requests against the node the whole time, which
crowds out new runs. The only candidate owner is the driver `Job`, which
`ttlSecondsAfterFinished` reaps minutes after the run ends and which would
therefore cascade-delete healthy sandboxes out from under long runs.

Two mechanisms outside the driver close that gap:

- The [dispatcher](/components/dispatcher/overview/) reaps the sandbox. It
  watches every driver `Job` it created, so it learns when one fails terminally,
  and deletes the pods carrying that job's id and the driver's `managed-by`
  label. This is the primary path and it runs within a poll interval of the
  death.
- The sandbox pod carries an `activeDeadlineSeconds` of its own
  (`TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS`, default 24h; `0` disables it) as a
  last-resort backstop for a dispatcher that is down or lacks the RBAC. It is
  sized to outlast any real run: it is a leak bound rather than a run timeout,
  and nothing else caps a run's duration.

## Artifacts

Under the Kubernetes runtime the driver collects the produced tree out of the
sandbox pod over an exec: a `tar` of `/work` streamed to stdout, with the
regenerable dependency directories excluded at pack time. The exec's exit status
is not proof that its stdout arrived, because the transport can deliver the
status before the tail of the stream and drop the rest without an error. The
pipeline therefore prints a fixed completion mark after the archive, only once
`tar` has exited successfully, and the driver accepts a collected stream only
when it ends with that mark. A stream without the mark, a `tar` that reported a
failure, a lost exec stream and an archive that fails to unpack are each
retried with a fresh stream and a fresh destination, up to a fixed number of
attempts; `tar -c` is read-only, so repeating it is safe. A collection failure
report names the innermost cause of the failure.

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
document, the files of a run's [showcase](/components/core/showcase/), an
adversarial run's controller wasm and proof replays, a performance run's scored
scenarios, an asset-generation run's regenerated and preview images with their
action log, and a captured gg replay. That store, rather than the artifact
service, is what the backend exports the public snapshot from and what a console
reads a run's media from. Each mirror is best-effort: a failure is logged and
the run's record still reports.

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
rather than a server, so it carries no app-level auth of its own. Its streaming
calls authenticate to the backend with the per-job token the dispatcher passed
in. Its configuration is entirely environment variables, documented in
`crates/driver/src/config.rs`.

The driver image carries the tooling a run needs end to end in-process: `git` to
seed each run's fresh repository, and a Node runtime with the bundled Playwright
browser to run an end-to-end case's build steps and load-check the build with a
headless screenshot. That is the same browser toolchain the
[backend](/components/backend/overview/) bakes to render references, so the
image layers the driver binary on the Node and browser base. It also bakes the
static-musl gg binary the core copies into each sandbox pod, so a gg run
installs locally with no network egress. Publishing is a separate backend
operation, so the image ships no publish CLIs. The driver runs unprivileged and
needs no Docker or Podman daemon.
