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
  [preview frames](/testing/asset-generation/binaries/#live-preview)) to the backend
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

## Artifacts

Because the sandbox pod is ephemeral — its disk is lost on exit — the driver
**uploads** the produced run tree (the playable build, proof and asset media) to
the [artifact service](/components/artifacts/overview/) (`TCAB_ARTIFACTS_URL`,
forwarded by the dispatcher) before reporting terminal status, so a reviewer can
play and inspect the run afterward. When the artifacts URL is unset — the local
CLI/desktop path, where nothing serves a worker disk — the upload is skipped and
behavior is otherwise unchanged.

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
