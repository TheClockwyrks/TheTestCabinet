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
| [Worker](/components/worker/overview/) | An Axum server that exposes the core's run functionality over an HTTP API, for running test cases on a remote machine. |
| [Tauri app](/components/tauri/overview/) | The desktop GUI — the primary interactive way to launch runs, watch them live, review them, and publish. |
| [Web console](/components/web/overview/) | The same runner/reporter console as the Tauri app, running in a browser and backed by remote workers rather than a built-in local one. |
| [Backend](/components/backend/overview/) | A private Rust server that distributes test case definitions and stores published run results. |
| [Site](/components/site/overview/) | The public static gallery at [testcabinet.ai](https://testcabinet.ai) where published runs are browsed and played. |
| [UI library](/components/ui/overview/) | Shared frontend code (`@test-cabinet/ui`): the full routed gallery application all three GUIs mount, the presentational primitives they render, and the backend/worker client interfaces the Tauri and web consoles share. |
| [Docs](/components/docs/overview/) | This documentation site. |

## Runners and Reporters

Two roles recur across the components:

- A **runner** is any component that can execute a test case: the
  [CLI](/components/cli/overview/), the [worker](/components/worker/overview/),
  and the [Tauri app](/components/tauri/overview/). A runner needs a container
  runtime on the machine it runs on, resolves the requested test case version
  from the backend, drives the run through the core, and reports the result back
  to the backend on publish.
- A **reporter** is any component that displays run results: the
  [Tauri app](/components/tauri/overview/), the
  [web console](/components/web/overview/), and the
  [public site](/components/site/overview/). Reporters read published results;
  only GUI reporters let a person interact with the produced implementations.

The Tauri app is both, which is why it is expected to be the primary way The
Test Cabinet is used: it launches runs, reviews them, and shows results in one
place. The [web console](/components/web/overview/) is the same console in a
browser — it reviews and reports like the Tauri app and launches runs too, but
drives them on remote [workers](/components/worker/overview/) instead of a
built-in local runner. All three GUIs in fact mount the *same* routed gallery
application from the [UI library](/components/ui/overview/); the consoles are
that app with run execution enabled, and the public site is the same app with it
off.

## The Backend

Earlier versions of The Test Cabinet deliberately had **no** backend. Run
records were committed into the site's dataset — a "git-as-a-db" design that was
chosen for convenience rather than because it was sound. That requirement has
been dropped in favor of a single, centralized
[backend](/components/backend/overview/) that records run results and serves as
the canonical copy of the test case definitions runners need.

The backend stays deliberately small. There are still no end-user accounts and
no public write surface; instead it sits on a private network and only
authorized users and machines can push to or pull from it (see
[Backend](/components/backend/overview/#authentication)). The
[public site](/components/site/overview/) remains a fully static, backend-less
deployment: publishing exports a public snapshot of the dataset that the site
builds from, so the gallery has no live dependency on the private backend.

## Local Operation

A run is driven by whichever runner launched it through a container runtime on
that runner's own machine — the host for the CLI and the Tauri app, the worker's
host for a worker-driven run. A runner therefore requires a supported container
runtime (Docker or a compatible runtime such as Podman) to be available, while
components that only report results do not. See
[Execution](/components/core/execution/).

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
- Write a [run record](/components/core/run-records/), and optionally
  [publish](/components/core/results/) the run.

Publishing releases the produced code to its own public repository, makes its
build available for embedding, and submits the run record to the backend, which
serializes it into its store and refreshes the public snapshot the site is built
from. See [Results](/components/core/results/).

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
