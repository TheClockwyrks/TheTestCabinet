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
queue never claims a canceled-while-queued job. The driver **polls its own job's
state** while it runs, so it observes the cancellation, drops the in-flight harness
session (which cancels the container `exec`), and **tears its sandbox down** — under
the Kubernetes runtime it deletes the run's sandbox pod, which it finds by the
job-id label it stamped on it — then exits without reporting a terminal status (the
backend already recorded `canceled`). The path is identical on the local
[k3d](/development/running/) cluster and in production, since both drive a run
through a driver pod. A late status the winding-down driver might still post is
ignored by the backend, so it can never resurrect a canceled run.

## Sandbox lifetime

The driver deletes the sandbox pod it created at the end of every run, and again on
[cancellation](#cancellation). Both of those are **in-process**, so a driver that
dies by `SIGKILL` — an OOM kill, an eviction, a node drain, a spot preemption — runs
neither, and the sandbox it leaves behind would otherwise live forever: its
keep-alive command is `sleep infinity`, and it deliberately carries no
`ownerReference` for Kubernetes to garbage-collect it by. (Its only candidate parent
is the driver `Job`, which `ttlSecondsAfterFinished` reaps minutes after the run
ends — as an owner that would cascade-delete healthy sandboxes out from under long
runs.) A leaked sandbox holds its CPU and memory *requests* against the node for as
long as it lives, which crowds out new runs.

Two mechanisms outside the driver close that gap:

- The [dispatcher](/components/dispatcher/overview/) **reaps** the sandbox. It
  watches every driver `Job` it created, so it learns when one fails terminally, and
  deletes the pods carrying that job's id and the driver's `managed-by` label. This
  is the primary path and it runs within a poll interval of the death.
- The sandbox pod carries an **`activeDeadlineSeconds`** of its own
  (`TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS`, default 24h; `0` disables it) as a
  last-resort backstop for the case where the dispatcher is down or lacks the RBAC
  too. It is sized to outlast any real run — it is a leak bound, **not** a run
  timeout, and nothing else caps a run's duration.

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
