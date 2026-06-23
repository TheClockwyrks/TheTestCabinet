---
title: Architecture
---

The Test Cabinet is built as a **headless core** with a set of components
layered on top of it. The core owns all of the orchestration — resolving a test
case version, seeding a run's repository, executing the run in a container,
invoking the agent harness, collecting metrics, running validation, writing the
run record, and publishing — and every other component is a thin wrapper that
exposes that functionality under whatever interface it is expected to provide (a
CLI, an HTTP API, a desktop GUI, and so on).

Keeping orchestration in the core and out of the interfaces is what makes batch
runs, automation, unattended sweeps, and remote execution possible: any
component can drive a run because none of them re-implement what a run is.

## Components

The Test Cabinet is made up of the following components.

| Component | What it is |
| --------- | ---------- |
| [Core](/components/core/overview/) | The Rust library that implements ~95% of the functionality. Everything else wraps it. |
| [CLI](/components/cli/overview/) | The `tcab` binary. Exposes the core so runs can be scripted and swept in batch. |
| [Dispatcher](/components/dispatcher/overview/) | A thin controller that claims queued runs from the backend and creates one driver `Job` per run. |
| [Driver](/components/driver/overview/) | The per-run executor: it runs exactly one test case in a `Job`, streams its progress to the backend, and exits. |
| [Artifacts](/components/artifacts/overview/) | A data-plane service that serves produced run trees (playable builds, proof/asset media) off a persistent volume. |
| [Tauri app](/components/tauri/overview/) | The desktop GUI — the primary interactive way to launch runs, watch them live, review them, and publish. |
| [Web console](/components/web/overview/) | The same runner/reporter console as the Tauri app, running in a browser and backed by the backend's run queue rather than a built-in local runner. |
| [Backend](/components/backend/overview/) | A private Rust server that distributes test case definitions, owns the run queue, and stores run results (pushed, reviewed, and published). |
| [Auth service](/components/auth/overview/) | A small standalone Rust server for user accounts: self-registration, password login, and the bearer tokens the backend verifies. |
| [Site](/components/site/overview/) | The public static gallery at [testcabinet.ai](https://testcabinet.ai) where published runs are browsed and played. |
| [UI library](/components/ui/overview/) | Shared frontend code (`@test-cabinet/ui`): the full routed gallery application all three GUIs mount, the presentational primitives they render, and the backend client interfaces the Tauri and web consoles share. |
| [Docs](/components/docs/overview/) | This documentation site. |

## Runners and Reporters

Two roles recur across the components:

- A **runner** is any component that can execute a test case: the
  [CLI](/components/cli/overview/), the [Tauri app](/components/tauri/overview/),
  and — for a server-side run — the [driver](/components/driver/overview/) the
  [dispatcher](/components/dispatcher/overview/) creates per run. A runner needs a
  container runtime (a host Docker/Podman, or the Kubernetes API) on the machine it
  runs on, resolves the requested test case version from the backend, drives the
  run through the core, and reports the result back to the backend.
- A **reporter** is any component that displays run results: the
  [Tauri app](/components/tauri/overview/), the
  [web console](/components/web/overview/), and the
  [public site](/components/site/overview/). Reporters read published results;
  only GUI reporters let a person interact with the produced implementations.

The Tauri app is both, which is why it is expected to be the primary way The
Test Cabinet is used: it launches runs, reviews them, and shows results in one
place. The [web console](/components/web/overview/) is the same console in a
browser — it reviews and reports like the Tauri app and launches runs too, but
enqueues them at the [backend](/components/backend/overview/) (which a
[dispatcher](/components/dispatcher/overview/) drains into per-run
[driver](/components/driver/overview/) `Job`s) instead of a built-in local runner.
All three GUIs in fact mount the *same* routed gallery application from the
[UI library](/components/ui/overview/); the consoles are that app with run
execution enabled, and the public site is the same app with it off.

## The Backend

Earlier versions of The Test Cabinet deliberately had **no** backend. Run
records were committed into the site's dataset — a "git-as-a-db" design that was
chosen for convenience rather than because it was sound. That requirement has
been dropped in favor of a single, centralized
[backend](/components/backend/overview/) that records run results and serves as
the canonical copy of the test case definitions runners need.

The backend stays deliberately small and has no public write surface; it sits on
a private network, so reaching it is the first line of access control (see
[Backend](/components/backend/overview/#authentication)). On top of that, real
**user [accounts](/components/backend/overview/#accounts)** — held in a standalone
[auth service](/components/auth/overview/) — identify *who* acts, so that every
[review](/components/core/results/#reviews) is attributed to a person. The backend
verifies the auth service's bearer tokens on the mutating run endpoints (push,
review, publish); reads stay open. The [public site](/components/site/overview/)
remains a fully static, backend-less deployment: publishing exports a public
snapshot of the **published** runs that the site builds from, so the gallery has
no live dependency on the private backend.

## Local Operation

A run is driven by whichever runner launched it through a container runtime on
that runner's own machine — the host for the CLI and the Tauri app. A runner
therefore requires a supported container runtime (Docker or a compatible runtime
such as Podman) to be available, while components that only report results do not.
See [Execution](/components/core/execution/).

## Server-side Run Topology

A run launched from a [web console](/components/web/overview/) does not execute on
the console's machine. The console **enqueues** the run at the
[backend](/components/backend/overview/), which owns a run queue; a thin
[dispatcher](/components/dispatcher/overview/) claims the queued run and creates one
Kubernetes `Job` running a [driver](/components/driver/overview/); the driver
executes the run (creating an untrusted sandbox pod via the Kubernetes API), streams
its live progress back to the backend (which relays it to the console), uploads the
produced tree to the [artifact service](/components/artifacts/overview/), and pushes
the produced record. Each run is one schedulable `Job`, so concurrency scales with
the cluster rather than with a hand-sized pool — there is no per-pod registration
and no long-lived worker. Local development runs the **same** manifests on
[k3d](/development/running/), so a run is a `Job` everywhere. This topology replaces
the earlier worker-pool design; see [Kubernetes: staging & prod](/deployment/kubernetes/).

## A Run

At a high level, launching a run must:

- Select a test case version, an agent harness, and a model, resolving the
  version from the [backend](/components/backend/overview/).
- Seed a fresh git repository with the selected
  [variant](/testing/end-to-end/overview/#variants)'s data.
- Start a container and invoke the agent harness against the seeded repository.
- Surface the harness's activity as a live stream of
  [harness events](/components/core/events/) while the run is in progress.
- Record [metrics](/components/core/metrics/) as the run proceeds and collect the
  produced repository when it finishes.
- Run [validation](/components/core/validation/) over the produced implementation.
- Write a [run record](/components/core/run-records/), and then optionally
  [push, review, and publish](/components/core/results/#lifecycle) the run.

Getting a run onto the gallery is three explicit steps: **push** releases the
produced code to its own public repository, makes its build playable for review,
and stores the run record on the backend *privately*; **review** lets people
(typically not the operator) submit assessments; and **publish** flips a reviewed
run public, which refreshes the snapshot the site is built from. The CLI's
`tcab publish` collapses all three for the solo case. See
[Results](/components/core/results/).

## Live Streaming

Some progress happens *inside* the run container — most visibly an
[asset-generation](/testing/asset-generation/overview/) run drawing through its
in-container binary — and a watched run shows that progress to the viewer in real
time. Because the container's filesystem is not host-visible mid-run and a
subprocess's stdout is mediated by the harness, the host opens a small per-run
network listener that the in-container process connects back to, and relays each
update to the viewer over the run's existing live channel. This is a reusable
pattern; see [Live Streaming](/components/live-streaming/).

## A Note on "Harness"

The word *harness* is used two ways throughout these docs:

- The *testing harness* is The Test Cabinet's own application that runs
  benchmarks.
- An *agent harness* is a third-party coding tool (for example Claude Code or
  Codex) that drives a model through a test case. See
  [Agent Harnesses](/components/core/harnesses/).
