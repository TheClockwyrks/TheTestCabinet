---
title: Overview
---

The driver is the per-run executor: it runs **exactly one** test case and exits.
The [dispatcher](/components/dispatcher/overview/) creates one driver `Job` per
claimed run; the driver resolves the definition from the
[backend](/components/backend/overview/), drives the run through the
[core](/components/core/overview/), streams its live progress back to the backend,
uploads the produced tree to the [artifact service](/components/artifacts/overview/),
and reports its terminal status — carrying the produced
[run record](/components/core/run-records/) — when it finishes.

It is the one-shot successor to the old long-lived **worker**. Where the worker was
an HTTP server with an in-memory registry of many concurrent jobs, the driver is a
single disposable process: one run, one pod, then gone. Everything it needs arrives
in its environment when the dispatcher creates the `Job`; there is no server, no
flags, and no state that outlives the run.

## Relationship to the Core

Like every other [runner](/components/architecture/#runners-and-reporters), the
driver re-implements **none** of a run's behavior. It assembles the same
[`RunEngine`](/components/core/execution/) a local `tcab run` does, and swaps only
the in-process sinks for backend-streaming ones:

- It accepts the launch request the dispatcher passed in — a version, a
  [variant](/testing/end-to-end/overview/#variants), a
  [harness](/components/core/harnesses/), a model, and an
  [orchestrator](/components/core/orchestrators/) — and drives the run through the
  core.
- It streams the run's live [harness events](/components/core/events/) (and, for an
  [asset-generation](/testing/asset-generation/overview/) run, the live drawing
  [preview frames](/testing/asset-generation/sprite-binaries/#live-preview)) to the backend
  as they happen, which the backend's relay fans out to the watching console.
- It produces the same [run record](/components/core/run-records/) a local run
  would and reports it with the terminal status; the backend persists it using the
  events the relay already accumulated.

## How it starts the run container

How the run's sandbox container is started is selected by `TCAB_DRIVER_RUNTIME`:

- **`kubernetes`** (the cluster shape the dispatcher always sets) — the driver is
  the **trusted** pod. It creates one **untrusted sandbox pod** per run through the
  Kubernetes API, waits for it to be `Running`, seeds the working tree and `exec`s
  the harness session into it, copies the produced `/work` tree out, and deletes the
  pod. The sandbox pod gets **no** ServiceAccount token — only the driver reaches
  the API. This is the same trust model the worker used, repurposed: the trusted
  process creates the untrusted sandbox.
- **`cli`** (the default) — shells out to a host Docker/Podman, for a single-box or
  test setup.

### Live preview

[Asset-preview](/components/live-streaming/) is preserved unchanged: the
in-container process connects back to a TCP listener on the **driver's own pod IP**
(supplied via the downward API as `TCAB_K8S_POD_IP`), and the driver forwards each
frame to the backend, which relays it to the console.

## Cancellation

A run can be **killed** while it is in progress from the console's live monitor.
The console asks the backend to cancel the job (`POST /jobs/{id}/cancel`, gated on
the launching account); the backend moves it to the terminal `canceled` state and
closes its live stream, so every watching monitor reflects the end at once and the
queue never claims a canceled-while-queued job. That much is settled immediately —
the operator's answer does not wait on anything the run still has to do.

The run itself is wound down **cooperatively**. The driver **polls its own job's
state** while it runs, and on observing the cancellation it raises the run's
cancellation latch and then **keeps awaiting the run**, bounded by a wind-down
grace (20 minutes). It does *not* drop the run future, for two independent reasons:

- **Dropping it would not stop the run.** The harness is its own process inside the
  sandbox pod, and the future the driver holds is only reading that process's output
  stream. Closing the stream leaves the harness running — and spending — until the
  sandbox is torn out from under it.
- **A run's result is assembled after the session returns.** Collecting the produced
  tree, folding the accumulated usage into metrics, writing the record: a dropped
  future skips every one of those, so the killed run loses exactly what an operator
  kills a run to look at.

So the latch is a request to stop at the next clean boundary, and the run then
finishes through its ordinary path.

### How gg winds down

For a [gg](/gg/overview/) run the engine races the session against the latch. On a
kill it writes the **cancellation sentinel** — a file at a path gg was named in its
invocation document (`cancelFile`), which is how the host reaches a process it holds
no handle on — and then **keeps draining gg's telemetry stream** for up to its own
grace (10 minutes), so the session's epilogue is ingested rather than cut off.

Every gg agent, the root and every subagent, checks that sentinel at its own **turn
boundary**, next to the run-wide deadline and cost ceilings and on exactly the same
terms (see [Execution limits](/gg/execution-limits/#cancellation)). The turn already
in flight completes, so nothing is abandoned half-applied; the agent ends with the
terminal status `canceled` and, deliberately, **no limit breach** — nothing was
measured and nothing was crossed. The session then runs its ordinary epilogue: the
per-slot rollups, the session summary, the [replay](/gg/replay/) sidecar, and the
session-ended event.

The engine therefore gets back a normal harness outcome marked *canceled*, carrying
the tokens, the cost and the session summary the run accumulated. It is **not** an
error, and the engine walks its whole post-session path: it collects the produced
tree out of the sandbox, folds the metrics, and assembles the
[run record](/components/core/run-records/). The **one** stage it skips is
[validation](/components/core/validation/) — every other stage reads state the run
already produced, while validation is fresh work (install, build, serve, drive a
browser). A run told to stop is meant to be frozen where it stood, not judged on an
unfinished implementation, so its validation summary is **empty rather than failed**.
The record's terminal state is
[`canceled`](/components/core/run-records/#status).

The driver then runs **every artifact upload it runs for any other run** — the
produced tree, proof media, asset media, the `.gg/replay.json` sidecar — and posts a
`canceled` status carrying the record to `POST /jobs/{id}/status`. The backend
persists it with the events its relay accumulated and attaches it to the
already-canceled job. It changes nothing else: no state change, no completion
notification, and no retry. (The driver waits for its relay to drain first, so every
streamed event has reached the backend before any terminal status is sent.)

### The degraded fallbacks

Two paths produce a **bare** canceled record instead — the session does not wind down
inside the grace, or the run errors on its way out (the sandbox went away under it,
say). In both, the driver builds the record itself from what it still holds: state
[`canceled`](/components/core/run-records/#status), the detail `canceled by operator`,
the resolved case identity and test type when the definition had already
materialized, but **no produced tree and zero metrics**.

It is worth building anyway because of what it anchors. The run streamed
[events](/components/core/events/) right up to the kill — for a harness whose
telemetry *is* its event stream, the bulk of what it produced — and those are already
in the backend's hands; without a record to attach them to, the killed run never
reaches the run list at all. Recording is **best-effort**: the job is already terminal
and the teardown still has to happen, so a record that cannot be built or posted is
logged and never fatal.

### Scope: cooperative wind-down is a gg path

Only [gg](/gg/overview/) has a wind-down protocol to be asked for. A third-party
harness is a CLI the Test Cabinet drives through an `exec`; there is no boundary at
which it can be told to stop and no epilogue to wait for, so a canceled third-party
run never reports a canceled outcome and always takes the degraded fallback above.

### Teardown, and late statuses

Whichever path recorded the run, the driver **tears its sandbox down** — the sandbox the run created outlives the
run future, so under the Kubernetes runtime the driver deletes the run's sandbox
pod, which it finds by the job-id label it stamped on it — and **exits
successfully**, so the cluster does not read a canceled run as a driver failure and
retry it. The killed run appears in the run list like any other unpublished run,
with a working Events view, instead of vanishing — though it is
[never publishable](/components/core/results/#publish).

The path is identical on the local [k3d](/development/running/) cluster and in
production, since both drive a run through a driver pod. Any *other* late status the
winding-down driver might post before it notices the kill — a `running`,
`succeeded`, or `failed` — is discarded by the backend, so nothing but the driver's
own `canceled` acknowledgement can touch a canceled run.

## Artifacts

Because the sandbox pod is ephemeral — its disk is lost on exit — the driver
**uploads** the produced run tree (the playable build, proof and asset media) to
the [artifact service](/components/artifacts/overview/) (`TCAB_ARTIFACTS_URL`,
forwarded by the dispatcher) before reporting terminal status, so a reviewer can
play and inspect the run afterward. When the artifacts URL is unset — the local
CLI/desktop path, where nothing serves a worker disk — the upload is skipped and
behavior is otherwise unchanged.

The artifact service, however, only serves the run to the console session that
produced it. So the driver **also mirrors** a backend-driven run's servable media
into the [backend](/components/backend/overview/) store — an adversarial run's
controller wasm and proof replays, every run's proof-of-implementation media
(`POST /runs/{id}/proof/<proof-id>.<ext>`), and an asset-generation run's
regenerated/preview images and action log (`POST /runs/{id}/asset/<file>`) —
because that store, not the artifact service, is what the backend exports the public
[snapshot](/components/backend/overview/) from. Without this mirror a published
run's proof never reaches the static site (which renders "Proof media is not
available here." for each declared proof) and an asset-generation run's result view
has no media to show. Each mirror is best-effort: a failure is logged, never fatal,
and the run's record still reports.

The store is only the fast path, though: it is an ephemeral volume in production, so
it can be empty for a run published before a backend restart. The
[snapshot builder](/components/backend/overview/) therefore **falls back to the
artifact service** for any run media missing from the store, re-exporting it to
durable R2 — so a store wipe self-heals on the next refresh and the mirror above is
an optimization, not a correctness requirement. `scripts/backfill-run-media.sh`
is the one-shot operator backfill that populates the store and triggers a refresh
immediately, rather than waiting for the next publish.

## RBAC

Under the Kubernetes runtime the driver runs under the `tcab-driver`
`ServiceAccount`, with a namespaced `Role` granting exactly what creating the
sandbox needs: `core`/`pods` create/get/list/delete and `core`/`pods/exec` create.
The [dispatcher](/components/dispatcher/overview/) names this ServiceAccount on
every `Job` it creates. The manifests are in
[`deployments/k8s/base/rbac.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/rbac.yaml)
and [Kubernetes: staging & prod](/deployment/kubernetes/#rbac).

## Status

The driver is implemented as the `test-cabinet-driver` crate (`crates/driver`).
There is no app-level auth on the driver itself — it is a client, not a server; its
streaming calls authenticate to the backend with the per-job token the dispatcher
passed in. Its configuration is entirely environment variables, documented on its
[`config.rs`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/crates/driver/src/config.rs).
The driver image ships no publish CLIs (gh/wrangler) — publishing is a separate,
explicit [backend operation](/components/core/results/#lifecycle), not something a
driver does. It does carry the tooling a run needs end to end in-process, though:
`git` (to seed each run's fresh repository), a Node runtime and the bundled
Playwright browser (to run an end-to-end case's `npm` build steps and load-check
the build with a headless screenshot — the same browser toolchain the
[backend](/components/backend/overview/) bakes to render references), so the image
layers the driver binary on the Node/browser base rather than a bare one.
