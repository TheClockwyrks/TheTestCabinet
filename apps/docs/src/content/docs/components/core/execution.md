---
title: Execution
---

Every run executes inside an isolated, containerized environment seeded with a
fresh git repository. Isolation protects the host, keeps runs from discovering
each other's work, and prevents models from finding solutions in places they
should not be looking.

## Containerization

Runs must occur in a container so that a model cannot access the host system.

- The testing harness must drive the run container through a runtime
  abstraction. Two runtimes implement it: a Docker/Podman runtime that shells
  out to a host container engine, and the [Kubernetes
  runtime](/deployment/kubernetes/run-plane/) that creates a pod per run through
  the Kubernetes API. The [driver](/components/driver/overview/) selects one
  from its own configuration, and a cluster deployment selects Kubernetes. Run
  behavior is identical across both.
- A container must have access to the host filesystem only through the seeded
  repository and the inputs the run explicitly provides.
- A container requires outbound network access so the agent harness can reach
  model APIs and install packages.
- A run that needs to reach the run host is given a route back to it as
  `host.docker.internal`. Two things ask for it: an asset-generation run whose
  runner supplied a preview sink, so the in-container tool binary can stream its
  [live preview](/components/live-streaming/) back over that route, and a
  harness exporting telemetry to a collector on the run host. Only those runs
  are given the mapping.

### Run images

A run executes in exactly one run-container image, selected by the test case's
[test type](/testing/overview/), by its
[`asset_kind`](/testing/asset-generation/manifests/overview/) for asset
generation, and by its
[`asset_dimension`](/testing/full-stack/manifests/#asset_dimension) for full
stack. Each image is the shared base plus what that kind needs: an
[end-to-end](/testing/end-to-end/overview/) run gets the base plus the shared
Rust to WebAssembly toolchain, each
[asset-generation](/testing/asset-generation/overview/) kind gets the base plus
that kind's baked-in tool binary, and a
[full-stack](/testing/full-stack/overview/) run gets that toolchain plus the
asset-generation binaries of its dimension. The Blender kinds are the exception,
running in a self-contained image built from Ubuntu that carries headless
Blender.

The audio packs an audio binary reads are [staged](#staged-audio) into the
container per run rather than carried by any image, so a run's palette is fixed
by its test case rather than by the image it resolves.

The selected harness's CLI is installed into the container at run time (see
[Harness install](#harness-install)), so no image is per-harness.
[`gg`](/gg/overview/) is the exception: a gg run resolves the `-gg` variant of
the image it would otherwise get, which is the same image plus the language
toolchains a [responses-as-code](/gg/responses-as-code/overview/) program is
compiled with. Those toolchains must be baked in because a compiler is on the
turn path and a program's language is resolved per agent, so every toolchain is
present together. Every run image publishes a variant, and a variant's name is
derived from its parent's rather than looked up, so a gg run of any kind
resolves an image that has the compilers in it. The toolchain tree is one layer
with the same digest in every variant, so a host that has pulled one variant
already has those bytes for all the others.

A runner resolves the image for a run from its own registry configuration,
consulting no backend, so it resolves the same image against any backend or
none.

1. The image's own override, one `TCAB_CONTAINER_IMAGE_*` variable per run image
   plus the `_GG` suffixed counterpart that pins that image's gg variant, is a
   full verbatim reference. Set it to a `@sha256:…` digest to pin exact bytes or
   to point at a private build. Each image is pinned on its own.
2. Otherwise the image is composed as `{registry}/{name}:{tag}`, where `name` is
   the run's image name, `registry` is `TCAB_CONTAINER_REGISTRY` (default
   `ghcr.io/theclockwyrks`), and `tag` is `TCAB_CONTAINER_TAG` (default
   `latest`). An explicitly empty registry drops the prefix and names a local
   image for offline development.

The image is pulled at run start when it is absent locally. Whatever image
actually runs is resolved to its registry digest where it has one and recorded
in the [run record](/components/core/run-records/#environment), so a run pins
the exact image bytes it used even when launched by a mutable tag.

## Seeding

Each run must be seeded into its own newly created git repository containing the
data a model needs to build the game: the selected variant's
[workspace](/testing/end-to-end/overview/#workspace) starter files, the specs of
the selected variant, the test case's assets, and the rendered reference
screenshots that serve as visual targets. A run selects exactly one
[variant](/testing/end-to-end/overview/#variants), and the variant's specs are
seeded at their declared `dest` paths, the common specs plus that variant's own.

- A new repository must be created per run so that no prior history exists for a
  model to recover a reference implementation from. It must begin from a clean
  initial commit with no upstream remote and no history beyond that commit.
- The selected variant's [workspace](/testing/end-to-end/overview/#workspace)
  starter files are seeded into the repository root first, before the specs, so
  the specification and reference screenshots land on top of a baseline project.
  They are copied verbatim. Resolution rejects any collision between a workspace
  file and a spec, asset, or reference destination.
- A spec whose source is a Handlebars template (a `.hbs` extension) is rendered
  with the selected variant and version while seeding, and the result lands at
  the spec's `dest`. Every other spec is copied verbatim. See [Spec
  templates](/testing/end-to-end/overview/#spec-templates).
- A test case's reference screenshots are seeded as visual targets so the model
  can see what each screen should look like. The reference source mockups stay
  out of the repository, since handing over the mockup HTML and CSS would let a
  model copy the intended UI instead of building it from the specification.
- The seeded specs must be self-contained, referring only to files inside the
  seeded repository, which the reference screenshots are among. See [Test
  Cases](/testing/end-to-end/overview/#self-contained-specifications).
- The prompt is rendered from the version's `prompt.hbs` template, with the
  run's in-container workspace path and the selected variant's seeded spec
  paths, and handed directly to the harness as its instruction rather than
  written to disk. See [Prompt
  template](/testing/end-to-end/overview/#prompt-template).

The seeded repository is created on the host, copied into the run container, and
torn down as part of a run. The `tcab seed` command runs this same seeding step
for a chosen variant (`--variant`) and leaves the result on disk so the exact
inputs a harness receives can be inspected without launching a container.
`tcab prompt` renders and prints the instruction a run would hand the harness
for a given variant.

## Staged audio

A test case declares the audio packs its run may use, and the run container is
staged with those packs and nothing else. The
[audio binaries](/testing/asset-generation/audio-binaries/) read their palette
from `/opt/audio`, which staging writes once the container has started.

- Each declared `name@version` ref is resolved against the host audio store,
  located by `TCAB_AUDIO_STORE` and defaulting to `/opt/tcab-audio`. The driver
  image carries the store; a local checkout fetches it with
  `scripts/fetch-audio-store.sh`. A ref the store does not hold, or one whose
  stored pack disagrees with the pinned name, version, or kind, fails the run
  before the container starts.
- The store's `objects.lock.json` records every published object with its sha256
  and byte length. Every clip a declared pack names is checked against it before
  the clip is carried in, so a run is rendered only against audio that was
  published. A clip the lock does not record, one whose bytes disagree with it,
  and a store carrying no lock at all each fail the run.
- Staging materializes one `packs/<name>@<version>/pack.toml` per declared pack,
  the union of those packs' clip files under `clips/`, and a `packs.json`
  recording what the run was given and the default pack for each kind. The
  default is the first pack of that kind in declaration order, resolved on the
  host.
- The staged tree lands outside the seeded repository, so nothing staging writes
  is collected as the run's result and the raw clips stay out of the model's
  workspace and its git history.
- A run image declares that it accepts staged audio, and a run that stages audio
  reads that declaration back out of the started container. A mismatch fails the
  run at container start, before a harness session is spent, and names the image
  and the pin that selected it. A run that stages nothing is never asked.
- Because staging needs a running container, it is excluded from `tcab seed`,
  which materializes the seeded workspace alone. A case that declares no packs
  stages no audio.

## Harness install

The base image ships no agent harness. Once the container starts, the run
installs the selected harness's CLI into it by running that harness's [install
command](/components/core/harnesses/#installation). Installing at run time is
what lets a run pick up the harness's most recently published version.

- The install step runs after the container starts and before the test case's
  init command and the harness session, so the CLI is in place for both.
- It runs as the container's unprivileged run user with the container's own
  environment, installing into the user-writable locations the base image puts
  on `PATH`.
- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session.
- The run then probes the installed CLI to confirm it works and to record its
  version. A non-zero exit, a timeout, or a failed probe aborts the run before a
  harness session is spent and tears the container down, with the captured
  output surfaced for diagnosis.

## Init

A test case may declare an [init command](/testing/end-to-end/overview/#init)
that runs inside the run container after the seeded repository is mounted and
the harness CLI is installed, and before the harness session begins, so anything
it installs is in place for the model. It is where a case prepares the workspace
it shipped, typically installing its dependencies. It runs as the container's
unprivileged run user with the seeded repository as its working directory.

- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session.
- It is verified against the workspace's lockfile and retried, up to three
  attempts, as [Init](/testing/end-to-end/overview/#init) describes. After the
  last attempt, a non-zero exit or a declared package still missing aborts the
  run before the harness starts and tears the container down, with the captured
  output surfaced for diagnosis. A timeout aborts it the same way without a
  retry.
- Because init needs a running container, it is excluded from `tcab seed`, which
  only materializes the seeded files on disk.

## Runtime limits

Two independent bounds end a run that will not end itself. Between them they
guarantee that a run's fate is always decided by the Test Cabinet rather than by
the platform underneath it.

- The maximum runtime is the wall-clock cap on the harness session: the test
  case's `max_runtime_hours`, overridable per invocation with
  `tcab run --max-runtime`. It bounds each in-container setup step on its own
  as well. Tree collection, analysis, and validation run after the session and
  outside the cap. A session stopped by it is recorded as
  [`timed_out`](/components/core/run-records/).
- The idle watchdog bounds silence rather than duration. A harness that produces
  no output at all for 30 minutes is killed and the run is recorded as
  [`hung`](/components/core/run-records/). This catches a harness that has
  stopped doing anything, such as a stalled provider request or a subagent that
  never returns.

The watchdog's window must stay far below the platform's own limits. A
Kubernetes kubelet closes an exec stream idle for
`streamingConnectionIdleTimeout`, 4 hours on our clusters, without a terminating
status frame, so the exec reports exit code `-1` and the run is misattributed.
Because the watchdog always fires first, a hang is attributed accurately and
promptly, and a case's maximum runtime is reachable however long it is set.

These two are the only terminations the Test Cabinet decides on a timer. An
operator can also kill a run, and what the
[driver](/components/driver/overview/#cancellation) does with it then depends on
the harness.

A kill winds a [gg](/gg/overview/) run down cooperatively. The driver raises a
cancellation latch and keeps awaiting the run. The session sees the latch at its
next turn boundary, finishes the turn in flight, runs its epilogue, and hands
back everything it accumulated, so the run completes tree collection, metrics,
and the record, and skips only validation. The wait is bounded at every layer: a
grace on the session's wind-down and a longer one on the driver's. A run that
overruns those graces falls back to a bare record. Either way the run is
recorded as [`canceled`](/components/core/run-records/#status): it crossed no
bound and carries no fault to attribute, so it is retained for inspection only
and stays unpublishable.

A kill that lands before the gg session has been launched destroys the run
instead, as does a kill on a run of any other harness. The driver records
nothing and tears the sandbox down, and the run is absent from the run list.

`timed_out` and `hung` unwind the run instead of asking it to stop, so both are
recorded without a collected tree or folded metrics.

## Model authored tests

The goal of a test case is to measure how well a model writes code in a large
project, so the testing harness must stay out of the way of the model testing
its own work.

- Any tests a test case provides must be visible to the model.
- The model must be free to write its own tests.

## Artifact collection

When a run finishes, the testing harness must collect the run's working tree as
the run's primary artifact. This produced repository is what gets validated and,
if published, released. See [Results](/components/core/results/).
