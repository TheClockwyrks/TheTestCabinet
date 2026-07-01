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

- The testing harness must drive the run container through a **runtime
  abstraction** rather than hard-coding a single runtime. Two runtimes implement
  it: a Docker/Podman runtime that shells out to a host container engine, and the
  [Kubernetes runtime](/deployment/kubernetes/) that creates a pod per run through
  the Kubernetes API. Every test-case run is now driven by the
  [driver](/components/driver/overview/) under the **Kubernetes runtime** — the
  CLI and desktop app enqueue runs at the backend rather than executing them on
  the host (see [Server-side Run Topology](/components/architecture/#server-side-run-topology)),
  so the host Docker/Podman path is no longer how a test case runs. The behavior
  below is identical across both runtimes — only the mechanism that starts the
  container, copies the working tree in and out, and runs commands in it differs.
- A container must not have access to the host filesystem beyond the seeded
  repository and the inputs the run explicitly provides.
- A container does require outbound network access so the agent harness can
  reach model APIs and install packages. Isolation is about protecting the host
  filesystem and other runs' outputs, not about disabling the network.
- When an asset-generation run is being watched (the driver supplies a preview
  sink), the container is additionally given a route back to the run host as
  `host.docker.internal` — `--add-host …:host-gateway` under the Docker/Podman
  runtime, a pod `hostAlias` to the driver pod's own IP under the Kubernetes
  runtime — so the in-container drawing or
  [voxel](/testing/asset-generation/voxel-binaries/#live-preview) binary can stream
  its [live preview](/testing/asset-generation/binaries/#live-preview) back to a
  listener on the run host. No host mapping is added for an unwatched run.
- A run executes in one of **five run-container images**, selected by the test
  case's [test type](/testing/) and — for asset-generation — its
  [`asset_kind`](/testing/asset-generation/manifests/): an
  [end-to-end](/testing/end-to-end/) run uses the **base image**; a single-sprite
  [asset-generation](/testing/asset-generation/overview/) run
  (`asset_kind = "sprite"`) uses the **sprite image** (the base image plus the
  baked-in `draw` tool); a sprite-sheet run (`asset_kind = "sprite-sheet"`) uses
  the **sprite-sheet image** (the base image plus the baked-in `draw-sheet` tool);
  a static-voxel run (`asset_kind = "voxel-model"`) uses the **voxel image** (the
  base image plus the baked-in `voxel` tool); and an animated-voxel run
  (`asset_kind = "voxel-animation"`) uses the **voxel-animation image** (the base
  image plus the baked-in `voxel-anim` tool). None is a per-harness image: the
  selected harness's CLI is installed into the container at run time (see
  [Harness install](#harness-install) below), not baked into the image. All five
  are registry images, and a runner resolves the one for the run from its **own
  registry configuration** — `TCAB_CONTAINER_REGISTRY` (default
  `ghcr.io/theclockwyrks`) and `TCAB_CONTAINER_TAG` (default `latest`) select the
  image named for the run (`test-cabinet-base`, `test-cabinet-sprite`,
  `test-cabinet-sprite-sheet`, `test-cabinet-voxel`, or
  `test-cabinet-voxel-animation`), and a **per-image** override pins a verbatim
  reference for one image without touching the others (`TCAB_CONTAINER_IMAGE_BASE`
  for end-to-end, `TCAB_CONTAINER_IMAGE_SPRITE` for single-sprite,
  `TCAB_CONTAINER_IMAGE_SPRITE_SHEET` for sprite-sheet,
  `TCAB_CONTAINER_IMAGE_VOXEL` for static-voxel, and
  `TCAB_CONTAINER_IMAGE_VOXEL_ANIMATION` for animated-voxel; there is no override
  that spans every image, since they differ) — and pulls it at run start
  (`--pull missing`). No backend is consulted, so a runner
  resolves the image the same way against any backend or none. Whatever image
  actually runs is resolved to its registry digest where it has one and recorded
  in the [run record](/components/core/run-records/#environment), so a run still
  pins the exact image bytes it used even when launched by a mutable tag.

## Seeding

Each run must be seeded into its own newly created git repository that contains
the data a model needs to build the game: the selected variant's
[workspace](/testing/end-to-end/overview/#workspace) starter files, the specs of
the selected variant, the test case's assets, and the rendered reference
screenshots that serve as visual targets. A run selects exactly one
[variant](/testing/end-to-end/overview/#variants), and the variant's specs are
seeded at their declared `dest` paths — the common specs plus that variant's own
— rather than as a single specification at the repository root.

- A new repository must be created per run so that no prior history exists.
  Models have been observed solving tasks by reading git history to recover a
  deleted reference implementation; starting from an empty history removes that
  possibility.
- The seeded repository must begin from a clean initial commit with no upstream
  remote and no history beyond that commit.
- The selected variant's [workspace](/testing/end-to-end/overview/#workspace)
  starter files are seeded into the repository **root** first, before the specs,
  so the specification and reference screenshots land on top of a baseline
  project. They are copied verbatim. Resolution rejects any collision between a
  workspace file and a spec, asset, or reference destination, so seeding never
  silently clobbers one with another.
- A spec whose source is a Handlebars template (a `.hbs` extension) is
  **rendered** with the selected variant and version while seeding, and the
  result lands at the spec's `dest`; every other spec is copied verbatim. This
  lets a spec state per-variant facts directly instead of hedging about what a run
  might contain. See [Spec templates](/testing/end-to-end/overview/#spec-templates).
- A test case's **reference screenshots are seeded** as visual targets so the
  model can see what each screen should look like. The reference **source**
  mockups are **not** seeded: handing over the mockup HTML/CSS would let a model
  copy the intended UI instead of building it from the specification, the same
  kind of shortcut the fresh repository is meant to prevent. A screenshot
  conveys the target without giving away the implementation.
- The seeded specs must be **self-contained**, with no links or references to
  these harness docs or to any file outside the seeded repository, because none
  of them exist inside the container. They may, however, point at the seeded
  reference screenshots. See
  [Test Cases](/testing/end-to-end/overview/#self-contained-specifications).
- The prompt is **not seeded** to disk. It is rendered from the version's
  `prompt.hbs` template — with the run's in-container workspace path and the
  selected variant's seeded spec paths — and handed directly to the harness as
  its instruction. See [Prompt template](/testing/end-to-end/overview/#prompt-template).

The seeded repository is normally created on the host, copied into the run
container, and torn down as part of a run, so its contents are never visible on
their own. The `tcab seed` command runs
this same seeding step for a chosen variant (`--variant`) and leaves the result
on disk (under `tmp/` by default) so the exact inputs a harness receives — the
variant's seeded specs, the seeded assets, and the fresh git history — can be
inspected without launching a container. Because the prompt is not seeded,
`tcab prompt` renders and prints the instruction a run would hand the harness
for a given variant, without seeding or launching anything.

## Harness install

The base image ships **no agent harness**. Once the container starts, the run
installs the selected harness's CLI into it by running that harness's
[install command](/components/core/harnesses/#installation) — typically a
single-line `npm install -g …` or a curl-piped installer. Installing at run time,
rather than baking the CLI into an image, is what lets a run always pick up the
harness's most recently published version.

- The install step runs **after** the container starts and **before** the test
  case's init command and the harness session, so the CLI is in place for both.
- It runs through a non-login `sh -c` as the container's unprivileged run user,
  with the container's own environment, so it installs into the user-writable
  locations the base image puts on `PATH` without needing root.
- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session, so a hung install can never run unbounded.
- A non-zero exit, a timeout, or a missing binary afterward (the run probes
  `<binary> --version` to confirm the install worked and to record the version)
  aborts the run before a harness session is spent and tears the container down,
  with the captured output surfaced for diagnosis.

## Init

A test case may declare an [init command](/testing/end-to-end/overview/#init) that
runs **inside the run container** once the seeded repository is mounted and the
harness CLI is installed, and before the harness session begins. It is where a
case prepares the workspace it shipped — typically installing its dependencies —
so the harness starts against a ready project. It runs as the container's
unprivileged run user with the seeded repository as its working directory.

- The init step runs **after** the container starts, the workspace is mounted,
  and the harness is installed, and **before** the harness is invoked, so anything
  it installs is in place for the model.
- It is bounded by the run's maximum runtime, the same cap that bounds the
  harness session, so a hung setup can never run unbounded.
- A non-zero exit or a timeout aborts the run before the harness starts and tears
  the container down — a broken setup would only waste a harness session — with
  the captured output surfaced for diagnosis.
- Because init needs a running container, it is **not** performed by `tcab seed`,
  which only materializes the seeded files on disk.

## Model Authored Tests

The goal of a test case is to measure how well a model writes code in a large
project, so the testing harness must not get in the way of the model testing its
own work.

- Any tests a test case provides must be visible to the model.
- The model must not be blocked from writing its own tests.

## Artifact Collection

When a run finishes, the testing harness must collect the run's working tree as
the run's primary artifact. This produced repository is what gets validated and,
if published, released. See [Results](/components/core/results/).
