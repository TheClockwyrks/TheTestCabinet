---
title: Overview
---

The driver is the per-run executor: it runs exactly one test case and exits. The
[dispatcher](/components/dispatcher/overview/) creates one driver `Job` per
claimed run. The driver resolves the definition from the
[backend](/components/backend/overview/), runs it through its own run engine,
streams live progress back to the backend, uploads the produced tree to the
[artifacts service](/components/artifacts/overview/) and the implementation's
git bundle to the [repos service](/components/repos/overview/), and reports its
terminal status carrying the produced [run
record](/components/contracts/run-records/).

Everything the driver needs arrives in its environment when the dispatcher
creates the `Job`. It serves nothing, takes no flags, and keeps no state beyond
the run; the only sockets it opens are the per-run listeners its sandbox
connects back to.

## The run engine

The driver owns a run's behavior end to end. Its `RunEngine` is the one
implementation of a run, and the pages beside this one specify its stages:

- [Execution](/components/driver/execution/): seeding the workspace, starting
  the sandbox and driving the [harness](/components/driver/harnesses/) session
  under an [orchestrator](/components/driver/orchestrators/).
- [Events](/components/driver/events/): the normalized event stream every
  harness's output is lifted into.
- [Validation](/components/driver/validation/): the three validators, the
  toolchain stage and the post-run stages that turn a produced tree into
  verdicts, plus the [showcase](/components/driver/showcase/) capture.
- [Code analysis](#code-analysis): the static read of the code the model wrote.

The launch request the dispatcher passed in names a version, a variant, a
harness, a model, and an orchestrator. The driver streams the run's live harness
events to the backend as they happen, along with the live drawing [preview
frames](/testing/asset-generation/sprite-binaries/#live-preview) of an
asset-generation run, and the backend's relay fans them out to every watching
console. It produces the run record and reports it with the terminal status,
and the backend persists it using the events the relay already accumulated.

The driver reports `starting` before any work and advances the job to `running`
once setup finishes and the harness session is about to begin. Once the run has
a record, the driver hands it to the backend in a held report, uploads the run's
files, and posts its terminal status last, after the relay has drained so that
every streamed event has reached the backend first. [Finishing a
run](#finishing-a-run) gives the order and the retries. The run's own start is
taken immediately after the `starting` report, so the
[`startedAt`](/components/backend/api/#topics) the backend stamps from that
transition names the same instant the produced record does.

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
[run record](/components/contracts/run-records/). The one stage a cancellation skips
is [validation](/components/driver/validation/), which is fresh work judging
output an operator chose to stop, so a canceled run's validation summary is
empty rather than failed. The record's terminal state is
[`canceled`](/components/contracts/run-records/#status).

The driver then runs every upload it runs for any other run and posts a
`canceled` status carrying the record. The backend persists it with the events
its relay accumulated and attaches it to the already-canceled job, changing
nothing else: no state change, no completion notification, and no retry.

#### Degraded fallbacks

Two paths produce a bare canceled record instead: the session does not wind down
inside the grace, or the run errors on its way out. Both concern a session that
had been launched, since a run killed before that is destroyed rather than
recorded bare. In both the driver builds the record itself from what it still
holds: state [`canceled`](/components/contracts/run-records/#status), the detail
`canceled by operator`, and the resolved case identity and test type when the
definition had materialized. That record carries no produced tree and zero
metrics.

That record anchors the [events](/components/driver/events/) the run streamed
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
is [never publishable](/components/backend/results/#publish).

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
sandbox pod over a network channel of its own, following the pattern in
[Live Streaming](/components/live-streaming/): a pod exec carries only the
command that starts the transfer, and the bytes travel over a direct connection
the driver owns. A collected tree is the result of every API call the run paid
for, so the transfer is verified by the receiver rather than trusted from the
sender's exit status. Exec stdout gives no such guarantee; it can be cut short
while the exit status still reports success.

The driver binds a TCP listener on an ephemeral port for the collection, with a
per-run token, and execs an uploader into the sandbox with the driver's pod IP,
the port and the token as arguments. The uploader is a Test Cabinet script the
driver ships in its own binary and runs with the sandbox image's Node runtime,
so the two ends of the channel always come from the same driver build. It
streams a `tar` of `/work`, with the regenerable dependency directories excluded
at pack time, as length-framed chunks, and ends the stream with the total byte
count and a SHA-256 digest of the archive; a `tar` failure is sent as a failure
frame carrying `tar`'s message. The driver accepts the tree only when the
stream's terminator arrives and both the count and the digest match what it
received, then acknowledges the upload. The listener's verdict is the only one
that counts: the exec that started the uploader is consulted only when no
verified upload has arrived, and an exec whose stream is lost while the
uploader is still streaming leaves the listener to decide. A connection that
ends without its terminator, a count or digest mismatch, a stalled stream, an
uploader that never connects, a failed `tar` and an uploader that exits without
completing are each retried with a fresh upload, up to a fixed number of
attempts; `tar -c` is read-only, so repeating it is safe. A verified archive
that fails to unpack fails the collection outright, since another transfer
cannot change a host-side fault. A collection failure report names the
innermost cause of the failure.

The sandbox pod is ephemeral and its disk is lost on exit, so the driver uploads
the produced run tree to the artifacts service (`TCAB_ARTIFACTS_URL`, forwarded
by the dispatcher) as one tar, `POST /runs/{id}/artifacts` with its per-job
token, before reporting terminal status, and stamps the playable-build link onto
the record. That tree is the playable build, the proof media, the asset media,
the validation media, the showcase files, the code-analysis document and the
recorded logs. By the time a console sees the run finish, its build and media
are already servable from the artifacts service, which is the one store a
console reads a run's media from and the one the backend publishes it from.
When the artifacts URL is unset the upload is skipped.

The driver's copy of the tree is the only one until the upload is acknowledged.
The tarball stays on the driver's disk between attempts, and each attempt reads
it from its first byte, so an attempt the service answered before reading its
whole body leaves the next one unaffected. An attempt has no overall deadline,
since its body is as large as the run tree, and it is abandoned as stalled when
the service takes none of the tree and gives no answer for five minutes. The
service replaces a run's stored tree atomically, so a repeated upload stores the
tree once.

A failed upload is one of two kinds:

| Kind              | Failures                                                                                      | The driver                             |
| ----------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| The run's own     | The tree cannot be tarred, or the service answers `413`, `400` or `422`                       | Ends the upload at once                |
| A store condition | Every other failure: no answer, a stall, a `5xx`, a `401` or `403`, a `404`, any other status | [Retries](#retries) until it is stored |

When the upload ends without the tree stored, the driver leaves the
playable-build link off the record and reports the run with the state it
reached. The terminal report carries `artifactsStored`: `true` when the service
acknowledged the tree, `false` when it did not, and absent when no artifact
service is configured.

### What the backend reads from the tree

The run tree the artifacts service holds is the one copy of a run's servable
media: the proof-of-implementation media, the synthesized validation media, an
asset-generation run's media and action log, the
[showcase](/components/driver/showcase/) files, an adversarial run's proof
replays, a performance run's scored scenarios, a captured gg replay, and the
code-analysis document. The backend serves each of them from that tree through
the artifacts service, as its [durable
state](/components/backend/overview/#durable-state) states, so the driver
writes nothing into the backend's store.

## The implementation bundle

A run's workspace is a git repository whose first commit is the seed. At run
end, after the post-run stages, the driver commits everything the model left
uncommitted on top of the history the run holds, with the commit message the
[contract](/components/contracts/overview/) defines, writes `git bundle --all`
and uploads the bundle to the repos service (`TCAB_REPOS_URL`, forwarded by the
dispatcher) with `POST /runs/{id}/bundle` and its per-job token. The bundle is
what a console downloads, what a re-analysis reads and what the run's public
repository is pushed from at [publish](/components/backend/results/#publish).

The commit happens after the tree is collected out of the sandbox, on the
driver's own copy, so the sandbox never holds a credential and the committed
tree is exactly the one the validators judged. The repos service replaces a
run's bundle on a repeated upload, and the upload is [retried](#retries) like
the tree's. A bundle still failing at the deadline is logged and the run's
record still reports, so a run is never lost for want of its bundle; the
console then offers no download for it.

## Code analysis

The driver runs the [static code analyzer](/gg/analysis/code-analysis/) over the
collected tree before the uploads: a deterministic, execute-nothing read of the
code the model wrote, with the seed commit telling the authored files from the
seeded ones. The bounded tier of the analysis rides on the run record and the
unbounded tier is written into the run tree as `code-analysis.json.gz`, which the
artifacts upload carries. The analysis is the driver's own module, so a run's
analysis and the `tcab` CLI's read of a tree on disk are the same code.

## Finishing a run

Once the session ends, the driver collects the tree, deletes the sandbox, runs
the post-run stages and writes the record locally. From then on the run's result
exists only on the driver pod's disk, so the driver hands it to durable storage
in this order:

1. The held report: a `storing` status carrying the record, and the failure
   detail when the run failed. The backend stores the record in Postgres against
   the job.
2. The uploads: the run tree to the artifacts service and the bundle to the
   repos service.
3. The terminal report: a `succeeded`, `failed` or `canceled` status carrying
   the record with its build link and `artifactsStored`.

The held report is what makes a finished run durable. A driver lost after it
landed has its run finished by the backend from the held record, with the state
the run reached, and the run is never retried. A driver lost before it landed
leaves no result, and its job takes the path of a [lost
driver](/components/dispatcher/overview/#lost-drivers).

A failed run whose driver builds a record takes the same sequence, and so does
a canceled gg run. A destroyed run takes none of it.

### Retries

Every call in the sequence is retried until it lands, waiting 5, 10, 20 and 40
seconds and then 60 seconds between attempts. A call ends at once when its
answer says the request itself is at fault: a `4xx` other than `408` and `429`
from the backend, or one of the run's own upload failures. Every other failure
is retried.

Two deadlines bound the waiting, each counted from a call's first failure:

| Variable                            | Bounds                                  | Default           |
| ----------------------------------- | --------------------------------------- | ----------------- |
| `TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS` | each upload                             | `21600` (6 hours) |
| `TCAB_DRIVER_REPORT_WAIT_SECONDS`   | the held report and the terminal report | `21600` (6 hours) |

A value of `0` makes a single attempt, and a value that is not a whole number
of seconds stops the driver before it runs anything. The dispatcher forwards
both from its own environment.

While an upload waits, the driver repeats the `storing` report after each
failed attempt with the failure as its reason, so the job reads `storing` and
the console shows the run as waiting to store its files. A `storing` report
that fails is logged, and the wait goes on.

Every call is idempotent by run id. A repeated `storing` report replaces the
held record with the same record, a repeated upload replaces what the
earlier attempt stored, and a terminal report repeated after its answer was lost
is answered with success when the job already holds that terminal state.

An operator's cancellation ends the waiting wherever it is. The driver polls its
job's state every three seconds throughout, and a `canceled` job ends the call
in flight; the driver then posts `canceled` carrying the record. A gg run that
was already canceled when its finishing began retries each upload for at most
ten minutes, or for the configured wait when that is shorter.

The driver exits successfully once its terminal report lands or the backend
refuses it. It exits non-zero when the report deadline passes with the terminal
report undelivered, and the backend then finishes the run from the held record.

### Late terminal reports

The dispatcher can report a job lost while its driver is still delivering a
report. A terminal report that reaches the backend after that supersedes the
lost outcome. The backend records the run from the report and withdraws the
automatic retry the lost outcome enqueued, canceling it when it was already
claimed, so a finished run's record is always kept and its work is never
repeated.

## Termination

Kubernetes sends the driver `SIGTERM` before it kills the pod for a drain, an
eviction or a preemption, and the driver `Job` grants it a [grace
period](/components/dispatcher/overview/#the-driver-job) to act on it. The
driver handles the signal by what it holds:

- A driver that holds the run's record posts the held report at once if it has
  not landed, then goes on finishing the run for as long as the grace lasts.
  The backend finishes from the held record whatever the driver did not.
- A driver that holds no record yet reports the run `failed` with the state
  [`infrastructure`](/components/contracts/run-records/#status) and the detail
  `driver interrupted by SIGTERM`, naming the stage it was in.

Either way the driver deletes its sandbox before it exits, so an interrupted run
leaves nothing for the dispatcher's [reaper](#sandbox-lifetime).

## RBAC

Under the Kubernetes runtime the driver runs under the `tcab-driver`
`ServiceAccount`, with a namespaced `Role` granting exactly what creating the
sandbox needs: `core`/`pods` create/get/list/delete and `core`/`pods/exec`
get/create. Both exec verbs are required, because the driver's Kubernetes client
execs over a WebSocket, which the API server authorizes as `get`. The
[dispatcher](/components/dispatcher/overview/) names this ServiceAccount on
every `Job` it creates. The manifests are in `deployments/k8s/base/rbac.yaml`.
See [Run plane](/deployment/kubernetes/run-plane/#rbac).

## Deployment

The driver is the `tcab-driver` binary of the `microservice-driver` repository,
which also builds the [`tcab` CLI](/components/cli/overview/) as a second
binary over the same run engine. The driver is a client rather than a server,
so it carries no app-level auth of its own. Its streaming calls authenticate to
the backend with the per-job token the dispatcher passed in, and it never
crosses the [edge](/deployment/kubernetes/edge/). Its configuration is entirely
environment variables, documented in the repository's `crates/driver/src/config.rs`.

The driver image carries the tooling a run needs end to end in-process: `git`
to seed each run's fresh repository and commit its bundle, and a Node runtime
with the bundled Playwright browser to run an end-to-end case's build steps and
load-check the build with a headless screenshot. That is the same browser
toolchain the [backend](/components/backend/overview/) bakes to render
references, so the image layers the driver binary on the Node and browser base.
It also bakes the static-musl gg binary the driver copies into each sandbox
pod, so a gg run installs locally with no network egress; that binary is the
release the driver pins, and the one the backend's reference documents were
projected by. Publishing is a separate operation, so the image ships no publish
CLIs. The driver runs unprivileged and needs no Docker or Podman daemon.

### Installing gg

The driver declares the gg release it runs once, as a pinned gg version
independent of any crate version. Its image fetches that release from gg's
release container at build time, and the backend image fetches the matching
`gg-reference` the same way. The driver resolves the gg binary a run installs
in this order:

1. `TCAB_GG_INSTALL=release` forces a download.
2. `TCAB_GG_BINARY` names a local binary, which must exist.
3. The first local build that exists: the path the driver image bakes gg at,
   `/usr/local/lib/tcab/gg`, then the development build paths.
4. Otherwise, a download.

`TCAB_GG_INSTALL=local` requires one of the local binaries, and any other value
of it is an error. A download fetches `<base>/v<version>/gg-<target>` into the
sandbox with one `curl`:

| Variable                  | Sets        | Default                                                          |
| ------------------------- | ----------- | ---------------------------------------------------------------- |
| `TCAB_GG_RELEASE_URL`     | `<base>`    | `https://testcabinetartifacts.blob.core.windows.net/gg-releases` |
| `TCAB_GG_RELEASE_VERSION` | `<version>` | the driver's pinned gg version                                   |
| `TCAB_GG_RELEASE_TARGET`  | `<target>`  | `<arch>-unknown-linux-musl` for the driver's architecture        |

The default base is gg's release container, which the Azure pipeline publishes
to; see [Releasing `gg`](/development/releasing/#releasing-gg). The dispatcher
forwards all five variables into every driver `Job` when they are set.
