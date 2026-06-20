# Run Container

These are the container images The Test Cabinet runs benchmarks inside. Every run
executes in an isolated container seeded with a fresh git repository, so a model
cannot reach the host or other runs' work (see
`../apps/docs/src/content/docs/components/core/execution.md`).

There are **two images**, selected by a run's
[test type](../apps/docs/src/content/docs/testing/):

- the **base** image, which every
  [end-to-end](../apps/docs/src/content/docs/testing/end-to-end/) run executes
  in; and
- the **asset-generation** image, which every
  [asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  run executes in — the base image plus the baked-in `draw` binary.

Neither is a per-harness image — a run installs the selected harness's CLI into
the image at run time, by running the harness's `install` command (see
[`../harnesses/README.md`](../harnesses/README.md)). Installing at run time is
what lets a run always pick up the harness's most recently published version,
rather than whatever was current when an image was last built. The runner picks
the image by test type via
[`harness::resolve_run_image`](../crates/core/src/harness.rs).

## Layout

```
containers/
├── base/Dockerfile        # the end-to-end run image (toolchain, run user)
├── asset-gen/Dockerfile   # the base image plus the baked-in `draw` binary
└── build.sh               # builds (and optionally pushes) both images
```

## Base image

`base/` carries everything common to a run and nothing harness specific: `git`
(each run is a fresh repository), a Node.js build toolchain (test cases produce
web UIs that are built inside the container), the shared libraries a headless
Chromium links against (so a test case can install Playwright and Chromium
*itself* and drive its build in a real browser to verify it), system fonts (a
slim base ships none, so without them Chromium and Canvas text render no glyphs —
`fonts-dejavu-core` covers the monospace stack the test cases require), the
`curl`/`unzip` tooling the curl-piped harness installers rely on, and an
unprivileged `node` user whose home is configured so both a harness's install
command and a test case's init command can install software at run time without
root.

The base image deliberately does **not** install the Playwright npm package or
the Chromium browser binary. A test case that needs a browser provides Playwright
as a dependency in its [workspace](/testing/end-to-end/overview/#workspace) (for
example a `package.json` pinning `playwright`) and installs it with the case's
[init command](/testing/end-to-end/overview/#init) (`npm install` then
`npx playwright install chromium`). This keeps browser tooling a visible,
project-local dependency a model installs and uses through its own project,
rather than a global tool a model has to know is already on the machine. Only the
OS-level libraries Chromium links against live in the image, because the
unprivileged run user cannot `apt-get` them at init time.

It likewise installs **no agent harness** and **no Test Cabinet binary**. The
harness CLI is installed into the container at run time from the harness's
[manifest](../harnesses/README.md), the same way and for the same reason a test
case prepares its workspace with an init command. End-to-end runs never touch the
`draw` tool, so it stays out of the base — it lives in the asset-generation image
below.

## Asset-generation image

`asset-gen/` is the base image plus exactly one addition: the **`draw`** binary,
the drawing tool an
[asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
run uses (`asset-gen/Dockerfile` is `FROM` the base, so it inherits the toolchain,
the `node` run user, the `/work` working directory, and the keep-alive `CMD`).
Unlike a harness CLI, `draw` is part of The Test Cabinet itself and its drawing
logic must match the orchestrator's — the orchestrator regenerates an
asset-generation run's scored image from its action log through the *same* library
this binary uses — so it is compiled from this repo (a multi-stage build in
`asset-gen/Dockerfile`) and baked in rather than installed at run time. Because of
this coupling, **build the image from the same commit as the orchestrator**: a run
records both the orchestrator commit and the image digest, so a version mismatch
(which would invalidate the cheat-divergence signal) is auditable after the fact.
Building `draw` is why the build context is the repository root rather than
`asset-gen/` (see `build.sh`); `build.sh` builds the asset-generation image `FROM`
the base it builds alongside it, so the two stay in lockstep.

## Building

Run on a machine with Docker (or Podman) available:

```sh
./build.sh                # build the base and asset-generation images
DOCKER=podman ./build.sh  # build with Podman instead
```

Build-only mode tags `test-cabinet-base:latest` and
`test-cabinet-asset-gen:latest` locally. Those are exactly the names a runner
resolves (by test type) when its `TCAB_CONTAINER_REGISTRY` is set to an empty
string, so a locally-built image is used for offline development without pulling
anything. Override `IMAGE_TAG` / `IMAGE_NAME_PREFIX` to change the tag or name
prefix.

With `PUSH=1` and `IMAGE_REGISTRY` set (e.g. `ghcr.io/theclockwyrks`), each image
is pushed and its pinned `repo@sha256:…` digest printed. Runners resolve the
published image directly from their own registry configuration; the script does
**not** register anything with the backend, which plays no part in container
distribution (see `../apps/docs/src/content/docs/components/core/execution.md`).

## Runtime contract

The testing harness — not this image — owns how a container is run. The image
only promises an environment that honors the following contract:

- **Working directory** is `/work`. The seeded repository is mounted there at run
  time; it is the harness's working directory.
- **Secrets** (API keys) are passed in **at run time as environment variables**
  and are never baked into the image or committed anywhere. The testing harness
  sets the variable the selected harness expects.
- **Network** is enabled at run time so the harness can install itself and reach
  model APIs and package registries. Isolation protects the host filesystem and
  other runs, not the network.
- **Lifecycle**: a container is started and left running (the base `CMD` keeps it
  alive); the testing harness installs the selected harness's CLI, then `exec`s
  the agent harness inside it, then stops the container when the run finishes.
- **User**: the image runs as uid 1000 (`node`). On a host whose checkout is
  owned by a different uid, the testing harness is responsible for reconciling
  ownership of the mounted repository.

## Status / validation

This definition is authored but **not yet built or validated** — that requires a
Docker host. When validating on Linux, build both images (`./build.sh`) and
confirm a container from each runs and keeps alive, and that `draw` is on `PATH`
in the asset-generation image. Validating each **harness** — that its
[install command](../harnesses/README.md) lands a working CLI on `PATH`, the
exact non-interactive flags, its token/usage reporting format, and which
environment variable carries the provider API key — is tracked alongside the
harness manifests and the adapters in `crates/core/src/harness_registry.rs`.
