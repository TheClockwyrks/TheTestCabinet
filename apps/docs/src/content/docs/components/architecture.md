---
title: Architecture
---

The Test Cabinet is a set of repositories whose applications run as services on
a Kubernetes cluster, reached through a Cloudflare edge, with a public plane of
Workers and an R2 bucket beside it. A run is a Kubernetes `Job` that executes
one test case in an untrusted sandbox and streams its progress back, and a
finished run reaches the public gallery through an automatic publish. See
[Repositories](/development/repositories/) for the full set, its edges and
the kit every repository is rendered from.

## Repositories

Every repository is a submodule of the superrepo, `the-test-cabinet`, which
holds this documentation site, the issue board, the repository kit and the
gates over the whole set. The dependency rule is hub-and-spokes with
`contracts` as the hub: a library repository may be depended on, and an
application, site, shell, tool-binary or content repository is never depended
on. Every shape two repositories exchange, and everything that keeps them in
step, lives in `contracts`.

| Role               | Repositories                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The hub            | [`contracts`](/components/contracts/overview/)                                                                                                                                       |
| Libraries          | [`engines`](/components/engines/overview/), `ui-common` (the [UI library](/components/ui/overview/))                                                                                 |
| Tools              | `tool-model-core`, `tool-sprite`, `tool-paint`, `tool-voxel`, `tool-mc`, `tool-sn`, `tool-dc`, `tool-particle`, `tool-audio-core`, `tool-sfx-synth`, `tool-sfx-sample`, `tool-music` |
| Services           | `microservice-backend`, `microservice-dispatcher`, `microservice-driver`, `microservice-artifacts`, `microservice-repos`, `microservice-publisher`, `microservice-arena`             |
| Other applications | [`gg`](/gg/overview/), `the-spec-cabinet` ([The Spec Cabinet](/the-spec-cabinet/overview/))                                                                                          |
| Sites              | `testcabinet.ai` (the [gallery](/components/site/overview/)), `console.testcabinet.ai` (the [console](/components/web/overview/)), `gg.rocks`                                        |
| The shell          | [`client-tauri`](/components/client/overview/)                                                                                                                                       |
| Content            | `test-suites`                                                                                                                                                                        |
| Baseline media     | `cold-storage`, a submodule the kit renders nothing into                                                                                                                             |

A tool repository is a library workspace whose binaries are also baked into the
run-container images an [asset-generation](/testing/asset-generation/overview/)
run executes in. A shell is a Tauri workspace that builds the desktop and
Android client and depends on nothing of the project at build time.

## Components

| Component                                                  | What it is                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Contracts](/components/contracts/overview/)               | The hub: every wire and file shape, the test-suite runtime, telemetry, redaction and the backend's HTTP client.                                         |
| [Engines](/components/engines/overview/)                   | The authored engines a produced game is built on, the voxel and particle runtimes, and the adversarial and performance runtimes with the match runner.  |
| [Driver](/components/driver/overview/)                     | The run engine. It runs exactly one test case in a `Job`, streams its progress to the backend, and exits.                                               |
| [CLI](/components/cli/overview/)                           | The `tcab` binary, the driver's second binary: validation, baselines, seeding, ingest and reference publishing.                                         |
| [Dispatcher](/components/dispatcher/overview/)             | A controller that claims queued runs and publishes from the backend and creates one `Job` for each.                                                     |
| [Backend](/components/backend/overview/)                   | The private server that distributes test case definitions, owns the queues, stores run results and reviews, and writes the public snapshot.             |
| [Artifacts](/components/artifacts/overview/)               | The write-through store of run trees and the one writer of both object stores, the private Blob container and the public R2 bucket.                     |
| [Repos](/components/repos/overview/)                       | The write-through store of run implementations as git bundles and the public push of a published run's repository.                                      |
| [Publisher](/components/backend/results/#publish)          | The per-publish `Job`: deploys a run's build to its Pages project, has repos push its repository, and reports both links.                               |
| [Arena](/components/arena/overview/)                       | The service that runs the adversarial test type's matches and tournaments off the backend.                                                              |
| [Console](/components/web/overview/)                       | The operator console at `console.testcabinet.ai`: the primary way to launch runs, watch them live, review them, and share them.                         |
| [Gallery](/components/site/overview/)                      | The public gallery at [testcabinet.ai](https://testcabinet.ai), where published runs are browsed and played.                                            |
| [Client](/components/client/overview/)                     | The operator client for Windows, Linux, macOS and Android: a shell that loads the console.                                                              |
| [Identity](/components/auth/overview/)                     | Cloudflare Access with Entra ID: who an operator is, and how the services verify it.                                                                    |
| [UI library](/components/ui/overview/)                     | Shared frontend code (`@clockwyrks/ui`): the routed gallery application both GUIs mount, the primitives they render, and the backend client interfaces. |
| [Voxel runtime](/components/voxel-runtime/overview/)       | Poses and renders a produced voxel rig.                                                                                                                 |
| [Particle runtime](/components/particle-runtime/overview/) | Simulates and renders a produced particle system.                                                                                                       |
| [Docs](/components/docs/overview/)                         | This documentation site.                                                                                                                                |

## Responsibilities of a run

The driver owns everything that happens during a run, the contracts repository
defines the shapes a run is built around, and the backend owns what happens to
a run once it is recorded.

- [Test cases](/testing/end-to-end/overview/): resolving a test case version
  and its selected [variant](/testing/end-to-end/overview/#variants), and
  reading the `test-case.toml` manifest that says what gets seeded, rendered,
  and checked.
- [Execution](/components/driver/execution/): seeding a fresh git repository,
  running the harness inside an isolated container, and collecting the produced
  working tree.
- [Agent harnesses](/components/driver/harnesses/): a single abstraction for
  invoking any supported coding harness, absorbing each one's quirks.
- [Orchestrators](/components/driver/orchestrators/): the harness-agnostic
  strategy that decides how a run's harness sessions are conducted.
- [Engines](/components/engines/engines/): the runtime a produced game is built
  on, selected independently of the test case.
- [Test case groups](/components/backend/test-case-groups/): the sets of
  related cases, declared in `test-suites`, the home page renders one
  leaderboard per.
- [Harness events](/components/driver/events/): translating each harness's raw
  output into one normalized, live event stream.
- [Metrics](/components/contracts/metrics/): recording the run time, token, and
  cost data every run produces.
- [Validation](/components/driver/validation/): the automated first pass that
  builds, loads, and decides the objective review points of an implementation.
- [Run records](/components/contracts/run-records/): the fixed data contract a
  run emits.
- [Results](/components/backend/results/): getting a finished run onto the
  gallery through review and publish.

## The services

Every service runs in one Kubernetes namespace per environment, and nothing in
a cluster is reachable from outside it except through the
[edge](#the-edge).

- The [backend](/components/backend/overview/) is the control plane. It holds
  the definitions and results, owns the run and publish queues, and is the one
  thing a console or a runner addresses for state.
- The [dispatcher](/components/dispatcher/overview/) turns the queues into
  work: one [driver](/components/driver/overview/) `Job` per claimed run and
  one publisher `Job` per claimed publish, each admitted through its own lane.
- The [artifacts](/components/artifacts/overview/) and
  [repos](/components/repos/overview/) services are the data plane. Artifacts
  owns every byte a run produces and every byte the public reads, over a
  private Azure Blob container per environment and the public R2 bucket, and
  it is stateless: data flows through it to the stores, so it scales
  horizontally. Repos owns each run's implementation as a git bundle in a
  private Blob container of its own and pushes a published run's repository to
  GitHub.
- The [arena](/components/arena/overview/) runs the adversarial test type's
  CPU-bound matches and tournaments, as a peer of the backend that holds no
  data.

The services that talk to each other inside the cluster do so over `ClusterIP`
services with the service token and the per-job tokens the backend mints, and
never cross the edge.

## The edge

One Cloudflare Tunnel per namespace carries one public hostname per
environment, `console.testcabinet.ai` for prod and
`console.staging.testcabinet.ai` for staging, to the in-cluster services by
path: `/` the console, `/api/` the backend, `/artifacts/` the artifacts
service, `/arena/` the arena. TLS terminates at Cloudflare, and the cluster
holds no `Ingress`, no load balancer, no public IP and no certificate. Grafana
sits behind the same tunnel and policy at `grafana.testcabinet.ai`.

Each hostname is one Cloudflare Access application whose policy is an Entra ID
identity allowed by email. Every request through the edge carries an Access
assertion, which the backend, the artifacts service and the arena verify
against Cloudflare's certificates and the application's audience tag before
answering. A person's identity is the assertion's email, which is what a
review records; automation uses an Access service token. See
[Identity](/components/auth/overview/) and
[Kubernetes: the edge](/deployment/kubernetes/edge/).

Being same-origin is what lets the console call `/api` and resolve media under
`/artifacts` with no configuration of its own. The
[client](/components/client/overview/) is the same console loaded in a WebView,
signed in through Access inside it.

## A run

A run launched from the [console](/components/web/overview/) executes on the
cluster rather than on the launcher's machine. Launching a run must:

- Select a test case version, an agent harness, a model, an orchestrator and an
  engine, and enqueue them at the [backend](/components/backend/overview/),
  which resolves the version and owns the queue.
- Be claimed by the [dispatcher](/components/dispatcher/overview/), which
  creates one driver `Job` for it.
- Seed a fresh git repository with the selected
  [variant](/testing/end-to-end/overview/#variants)'s data, in the driver.
- Start an untrusted sandbox pod through the Kubernetes API and invoke the
  agent harness against the seeded repository.
- Surface the harness's activity as a live stream of [harness
  events](/components/driver/events/) while the run is in progress, which the
  backend's relay fans out to every watching console.
- Record [metrics](/components/contracts/metrics/) as the run proceeds and
  collect the produced repository when it finishes.
- Run [validation](/components/driver/validation/) and code analysis over the
  produced implementation.
- Commit the model's work on top of the seed commit, upload the run tree to
  the [artifacts](/components/artifacts/overview/) service and the
  repository's bundle to the [repos](/components/repos/overview/) service.
- Write a [run record](/components/contracts/run-records/) and report it to
  the backend, which stores it privately.

A stored run is playable and reviewable in the console at once, served from
the artifacts service behind Access. Reviews collect assessments of the
produced run from people identified by Access. A run that completed and is
validator-rated publishes automatically: the backend enqueues a publish `Job`,
the dispatcher admits it in the publish lane, and the publisher fetches the
build output from artifacts, deploys it to the run's Pages project, has repos
create and push the run's public GitHub repository, and reports both links.
The backend then marks the run published, mints the run's short code and
writes its object, has artifacts copy the run's media to R2, then writes the
run's document and the updated index objects through artifacts, swapping the
`index.json` pointer last. See [Results](/components/backend/results/).

## The public plane

The R2 bucket is the public dataset: the published runs' documents, their
media, content-addressed index objects, and one object per short code, with
the `index.json` pointer swapped atomically after each publish. The
[gallery](/components/site/overview/), a static site on Cloudflare Pages, reads
the index objects at runtime, so a publish is an upload and no site rebuild
follows it. A Worker in front of the gallery's run routes writes a run's
preview tags into the page it serves and answers an unknown run with a 404,
and the `tcab.ai` Worker redirects a short code to the run's verdict or play
page. The backend stays private throughout: the public plane reads the bucket
and nothing else. See [Serving the gallery](/components/site/serving/) and
[The public gallery](/deployment/public-gallery/).

## Test cases and test suites

The backend's catalog has two sources in the `test-suites` repository it
ingests: the authored test cases and game jams, and the [test
suites](/test-suites/overview/). A suite is one authored project holding
specifications, validators, assets and reference implementations, and each of
its exported versions offers one or more test case definitions. The
[suites crate](/components/contracts/overview/#the-suites-crate) reads and
validates a suite version, and the backend's ingest lowers every definition it
offers into an ordinary test case version that records the suite coordinate it
came from. A runner therefore resolves a suite-defined case exactly as it
resolves an authored one. The suite's own entities are stored beside the
lowered versions, and the console's Test Suites tab presents them. The Test
Cabinet reads the suites tree and never writes it.

## Live streaming

Progress that happens inside the run container reaches a watching viewer in real
time over a dedicated channel. See [Live
Streaming](/components/live-streaming/).

## The three meanings of "harness"

The word harness is used three ways throughout these docs.

- The testing harness is The Test Cabinet's own application that runs
  benchmarks.
- An agent harness is a coding tool, for example Claude Code or Codex, that
  drives a model through a test case. See [Agent
  Harnesses](/components/driver/harnesses/).
- The Spec Cabinet's harness is the agentic harness, built on gg's design, that
  drives its authoring workflows and its assistant. See
  [Harness](/the-spec-cabinet/harness/).
