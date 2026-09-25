---
title: Architecture
---

The Test Cabinet is a headless core with a set of components layered on top of
it. The core owns run orchestration: resolving a test case version, seeding a
run's repository, executing the run in a container, invoking the agent harness,
collecting metrics, running validation, writing the run record, and publishing.
Every other component links against that library and exposes it under the
interface it provides, whether that is a CLI, an HTTP API, or a browser console.
Keeping orchestration in the core is what makes batch runs, unattended sweeps,
and remote execution possible.

## Components

| Component                                                  | What it is                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Core](/components/core/overview/)                         | The Rust library that implements the run lifecycle and owns the data contracts.                                                                         |
| [CLI](/components/cli/overview/)                           | The `tcab` binary. Exposes the core so runs can be scripted and swept in batch.                                                                         |
| [Dispatcher](/components/dispatcher/overview/)             | A controller that claims queued runs from the backend and creates one driver `Job` per run.                                                             |
| [Driver](/components/driver/overview/)                     | The per-run executor. It runs exactly one test case in a `Job`, streams its progress to the backend, and exits.                                         |
| [Artifacts](/components/artifacts/overview/)               | A data-plane service that serves produced run trees (playable builds, proof and asset media) off a persistent volume.                                   |
| [Arena](/components/arena/overview/)                       | A data-plane service that runs the adversarial test type's matches and tournaments off the backend.                                                     |
| [Web console](/components/web/overview/)                   | The browser console: the primary interactive way to launch runs, watch them live, review them, and publish.                                             |
| [Backend](/components/backend/overview/)                   | A private Rust server that distributes test case definitions, owns the run queue, and stores run results.                                               |
| [Auth service](/components/auth/overview/)                 | A standalone Rust server for user accounts: self-registration, password login, and the bearer tokens the backend verifies.                              |
| [Site](/components/site/overview/)                         | The public gallery at [testcabinet.ai](https://testcabinet.ai) where published runs are browsed and played.                                             |
| [UI library](/components/ui/overview/)                     | Shared frontend code (`@clockwyrks/ui`): the routed gallery application both GUIs mount, the primitives they render, and the backend client interfaces. |
| [Voxel runtime](/components/voxel-runtime/overview/)       | Poses and renders a produced voxel rig.                                                                                                                 |
| [Particle runtime](/components/particle-runtime/overview/) | Simulates and renders a produced particle system.                                                                                                       |
| [Docs](/components/docs/overview/)                         | This documentation site.                                                                                                                                |

## Runners and reporters

Two roles recur across the components.

- A runner executes a test case. The [driver](/components/driver/overview/) is
  the only one. It resolves the requested test case version from the backend,
  drives the run through the core, creates an untrusted sandbox pod through the
  Kubernetes API, and reports the result back to the backend.
- A reporter displays run results: the [web
  console](/components/web/overview/) and the [public
  site](/components/site/overview/). Reporters read stored results and let a
  person interact with the produced implementations.

The web console is a launcher and reporter in one. It enqueues runs, watches
them live, reviews them, and shows results in one place. The web console is the
primary way The Test Cabinet is used.

Both GUIs mount the same routed gallery application from the [UI
library](/components/ui/overview/). The console is that application with the
launch surface enabled, and the public site is the same application with it off.

## Server-side run topology

A run launched from the [CLI](/components/cli/overview/) or the [web
console](/components/web/overview/) executes on the cluster rather than on the
launcher's machine. The launcher enqueues the run at the
[backend](/components/backend/overview/), which owns the run queue. A
[dispatcher](/components/dispatcher/overview/) claims the queued run and creates
one Kubernetes `Job` running a [driver](/components/driver/overview/).

The driver executes the run, creating an untrusted sandbox pod through the
Kubernetes API. It streams live progress back to the backend, which relays it to
the launcher. It uploads the produced tree to the [artifact
service](/components/artifacts/overview/) and reports the produced record, which
the backend stores privately.

Each run is one schedulable `Job`, so concurrency scales with the cluster. A
launcher needs a reachable backend and an account, and no container runtime of
its own. Local development runs the same manifests on a [k3d
cluster](/development/running/), so a run is a `Job` everywhere. See
[Kubernetes: run plane](/deployment/kubernetes/run-plane/).

## The backend

The [backend](/components/backend/overview/) records run results and serves as
the canonical copy of the test case definitions runners need. It has no public
write surface and sits on a private network, so reaching it is the first line of
access control.

User [accounts](/components/backend/overview/#authentication), held in the
standalone [auth service](/components/auth/overview/), identify who acts, so
that every [review](/components/core/results/#reviews) is attributed to a
person. The backend verifies the auth service's bearer tokens on the mutating
run endpoints, review and publish. Reads stay open.

The [public site](/components/site/overview/) runs on its own public plane.
Publishing writes the run's documents and media to a public bucket and its index
row to a public projection, both of which the gallery reads, so the gallery
serves published runs while the backend stays private.

## A run

At a high level, launching a run must:

- Select a test case version, an agent harness, and a model, resolving the
  version from the [backend](/components/backend/overview/).
- Seed a fresh git repository with the selected
  [variant](/testing/end-to-end/overview/#variants)'s data.
- Start a container and invoke the agent harness against the seeded repository.
- Surface the harness's activity as a live stream of [harness
  events](/components/core/events/) while the run is in progress.
- Record [metrics](/components/core/metrics/) as the run proceeds and collect
  the produced repository when it finishes.
- Run [validation](/components/core/validation/) over the produced
  implementation.
- Write a [run record](/components/core/run-records/) and report it to the
  backend, which stores it privately.

A stored run reaches the gallery through two explicit steps. Review collects
assessments of the produced run from people other than the operator, and publish
releases the produced code and flips the reviewed run public. See
[Results](/components/core/results/).

## Live streaming

Progress that happens inside the run container reaches a watching viewer in real
time over a dedicated channel. See [Live
Streaming](/components/live-streaming/).

## The two meanings of "harness"

The word harness is used two ways throughout these docs.

- The testing harness is The Test Cabinet's own application that runs
  benchmarks.
- An agent harness is a coding tool, for example Claude Code or Codex, that
  drives a model through a test case. See [Agent
  Harnesses](/components/core/harnesses/).
