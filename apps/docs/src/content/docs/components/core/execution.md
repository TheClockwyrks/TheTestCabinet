---
title: Execution
---

Every run executes inside an isolated, containerized environment seeded with a
fresh git repository. Isolation protects the host, keeps runs from discovering
each other's work, and prevents models from finding solutions in places they
should not be looking.

## Containerization

Runs must occur in a container so that a model cannot access the host system.
Without this, a model could discover other runs' outputs or damage the host, for
example by deleting files.

- The testing harness must drive the run container through a runtime abstraction
  rather than hard-coding a single runtime. Two runtimes implement it: a
  Docker/Podman runtime that shells out to a host container engine, and the
  [Kubernetes runtime](/deployment/kubernetes/run-plane/) that creates a pod per
  run through the Kubernetes API. The [driver](/components/driver/overview/)
  selects one from its own configuration, and a cluster deployment selects
  Kubernetes. The behavior described below is identical across both. Only the
  mechanism that starts the container, copies the working tree in and out, and
  runs commands in it differs.
- A container must not have access to the host filesystem beyond the seeded
  repository and the inputs the run explicitly provides.
- A container does require outbound network access so the agent harness can
  reach model APIs and install packages. Isolation protects the host filesystem
  and other runs' outputs; the network stays available.
- A run that needs to reach the run host is given a route back to it as
  `host.docker.internal`. The Docker/Podman runtime adds it as
  `--add-host …:host-gateway`; the Kubernetes runtime adds a pod `hostAlias`
  pointing at the driver pod's own IP. Two things ask for it: an
  asset-generation run whose runner supplied a preview sink, so the in-container
  tool binary can stream its [live preview](/components/live-streaming/) back
  over that route, and a harness exporting telemetry to a collector on the run
  host. A run that needs neither is given no host mapping.

### Run images

A run executes in exactly one run-container image, selected by the test case's
[test type](/testing/overview/) and, for asset generation, its
[`asset_kind`](/testing/asset-generation/manifests/overview/). Each image is the
shared base plus what that kind needs: an
[end-to-end](/testing/end-to-end/overview/) run gets the base plus the shared
Rust to WebAssembly toolchain, and each
[asset-generation](/testing/asset-generation/overview/) kind gets the base plus
that kind's baked-in tool binary. The Blender kinds are the exception, running
in a self-contained image built from Ubuntu that carries headless Blender.

The selected harness's CLI is installed into the container at run time (see
[Harness install](#harness-install)), so no image is per-harness.
[`gg`](/gg/overview/) is the exception: a gg run resolves the `-gg` variant of
the image it would otherwise get, which is the same image plus the language
toolchains a [responses-as-code](/gg/responses-as-code/overview/) program is
compiled with. Those toolchains must be baked in because a compiler is on the
turn path and a program's language is resolved per agent, so every toolchain has
to be present together. Every run image publishes a variant, and a variant's
name is derived from its parent's rather than looked up, so a gg run of any kind
resolves an image that has the compilers in it.

A runner resolves the image for a run from its own registry configuration,
consulting no backend, so it resolves the same image against any backend or
none.

1. The image's own override, one `TCAB_CONTAINER_IMAGE_*` variable per run image
   plus the `_GG` suffixed counterpart that pins that image's gg variant, is a
   full verbatim reference. Set it to a `@sha256:…` digest to pin exact bytes or
   to point at a private build. Each image is pinned on its own, since the
   images differ.
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

- A new repository must be created per run so that no prior history exists.
  Models have been observed solving tasks by reading git history to recover a
  deleted reference implementation; starting from an empty history removes that
  possibility.
- The seeded repository must begin from a clean initial commit with no upstream
  remote and no history beyond that commit.
- The selected variant's [workspace](/testing/end-to-end/overview/#workspace)
  starter files are seeded into the repository root first, before the specs, so
  the specification and reference screenshots land on top of a baseline project.
  They are copied verbatim. Resolution rejects any collision between a workspace
  file and a spec, asset, or reference destination, so seeding never silently
  clobbers one with another.
- A spec whose source is a Handlebars template (a `.hbs` extension) is rendered
  with the selected variant and version while seeding, and the result lands at
  the spec's `dest`. Every other spec is copied verbatim. This lets a spec state
  per-variant facts directly. See [Spec
  templates](/testing/end-to-end/overview/#spec-templates).
- A test case's reference screenshots are seeded as visual targets so the model
  can see what each screen should look like. The reference source mockups stay
  out of the repository: handing over the mockup HTML and CSS would let a model
  copy the intended UI instead of building it from the specification. A
  screenshot conveys the target while the implementation stays the model's work.
- The seeded specs must be self-contained, with no links or references to these
  harness docs or to any file outside the seeded repository, because none of
  them exist inside the container. They may point at the seeded reference
  screenshots. See [Test
  Cases](/testing/end-to-end/overview/#self-contained-specifications).
- The prompt is rendered from the version's `prompt.hbs` template, with the
  run's in-container workspace path and the selected variant's seeded spec
  paths, and handed directly to the harness as its instruction rather than
  written to disk. See [Prompt
  template](/testing/end-to-end/overview/#prompt-template).

The seeded repository is created on the host, copied into the run container, and
torn down as part of a run, so its contents are never visible on their own. The
`tcab seed` command runs this same seeding step for a chosen variant
(`--variant`) and leaves the result on disk so the exact inputs a harness
receives can be inspected without launching a container. `tcab prompt` renders
and prints the instruction a run would hand the harness for a given variant.

## Harness install

The base image ships no agent harness. Once the container starts, the run
installs the selected harness's CLI into it by running that harness's [install
command](/components/core/harnesses/#installation). Installing at run time is
what lets a run pick up the harness's most recently published version.

- The install step runs after the container starts and before the test case's
  init command and the harness session, so the CLI is in place for both.
- It runs through a non-login `sh -c` as the container's unprivileged run user,
  with the container's own environment, so it installs into the user-writable
  locations the base image puts on `PATH` without needing root.
- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session, so a hung install stays bounded.
- The run then probes the installed CLI to confirm it works and to record its
  version. A non-zero exit, a timeout, or a failed probe aborts the run before a
  harness session is spent and tears the container down, with the captured
  output surfaced for diagnosis.

## Init

A test case may declare an [init command](/testing/end-to-end/overview/#init)
that runs inside the run container once the seeded repository is mounted and the
harness CLI is installed, and before the harness session begins. It is where a
case prepares the workspace it shipped, typically installing its dependencies,
so the harness starts against a ready project. It runs as the container's
unprivileged run user with the seeded repository as its working directory.

- The init step runs after the container starts, the workspace is mounted, and
  the harness is installed, and before the harness is invoked, so anything it
  installs is in place for the model.
- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session, so a hung setup stays bounded.
- A non-zero exit or a timeout aborts the run before the harness starts and
  tears the container down, with the captured output surfaced for diagnosis. A
  broken setup would only waste a harness session.
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
  [`timed_out`](/components/core/run-records/): the model was working and never
  converged.
- The idle watchdog bounds silence rather than duration. A harness that produces
  no output at all for 30 minutes is killed and the run is recorded as
  [`hung`](/components/core/run-records/). This catches a harness that has
  stopped doing anything, such as a stalled provider request or a subagent that
  never returns, which the runtime cap alone would leave to burn out the
  remainder of a multi-hour window.

The watchdog's window must stay far below the platform's own limits. A
Kubernetes kubelet closes an exec stream that has been idle for
`streamingConnectionIdleTimeout`, 4 hours by default and 4 hours on our
clusters, and it closes without a terminating status frame, so the exec reports
exit code `-1` and the run is misattributed. Because the watchdog always fires
first, a hang is attributed accurately and promptly, and a case's maximum
runtime is reachable however long it is set.

These two are the only terminations the Test Cabinet decides on a timer. A run
an operator kills from the live monitor is recorded as
[`canceled`](/components/core/run-records/#status). A canceled run crossed no
bound and carries no fault to attribute, so it is retained for inspection only
and stays unpublishable.

A kill also winds the run down cooperatively. The
[driver](/components/driver/overview/#cancellation) raises a cancellation latch
and keeps awaiting the run rather than dropping it. A [gg](/gg/overview/)
session sees the latch at its next turn boundary, finishes the turn in flight,
runs its epilogue, and hands back everything it accumulated, so the run
completes tree collection, metrics, and the record, and skips only validation.
The wait is bounded at every layer: a grace on the session's wind-down and a
longer one on the driver's. A run that overruns those graces falls back to a
bare record.

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
