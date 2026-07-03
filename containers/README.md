# Run Container

These are the container images The Test Cabinet runs benchmarks inside. Every run
executes in an isolated container seeded with a fresh git repository, so a model
cannot reach the host or other runs' work (see
`../apps/docs/src/content/docs/components/core/execution.md`).

There are **thirteen images**, selected by a run's
[test type](../apps/docs/src/content/docs/testing/) and — for asset-generation —
its [`asset_kind`](../apps/docs/src/content/docs/testing/asset-generation/manifests.md):

- the **base** image, which every
  [end-to-end](../apps/docs/src/content/docs/testing/end-to-end/) run executes
  in;
- the **sprite** image, which every single-sprite
  [asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  run (`asset_kind = "sprite"`) executes in — the base image plus the baked-in
  `draw` binary;
- the **sprite-sheet** image, which every sprite-sheet asset-generation run
  (`asset_kind = "sprite-sheet"`) executes in — the base image plus the baked-in
  `draw-sheet` binary;
- the **voxel** image, which every static-voxel asset-generation run
  (`asset_kind = "voxel-model"`) executes in — the base image plus the baked-in
  `voxel` binary;
- the **voxel-animation** image, which every rigged-voxel asset-generation run
  (`asset_kind = "voxel-animation"`) executes in — the base image plus the
  baked-in `voxel-anim` binary;
- the **mc** image, which every static Marching Cubes meshing run
  (`asset_kind = "mc-model"`) executes in — the base image plus the baked-in
  `mc` binary;
- the **mc-animation** image, which every rigged Marching Cubes meshing run
  (`asset_kind = "mc-animation"`) executes in — the base image plus the baked-in
  `mc-anim` binary;
- the **sn** image, which every static Surface Nets meshing run
  (`asset_kind = "sn-model"`) executes in — the base image plus the baked-in
  `sn` binary;
- the **sn-animation** image, which every rigged Surface Nets meshing run
  (`asset_kind = "sn-animation"`) executes in — the base image plus the baked-in
  `sn-anim` binary;
- the **dc** image, which every static Dual Contouring meshing run
  (`asset_kind = "dc-model"`) executes in — the base image plus the baked-in
  `dc` binary;
- the **dc-animation** image, which every rigged Dual Contouring meshing run
  (`asset_kind = "dc-animation"`) executes in — the base image plus the baked-in
  `dc-anim` binary;
- the **adversarial** image, which every
  [adversarial](../apps/docs/src/content/docs/testing/adversarial/overview.md)
  run executes in — the base image plus the Rust + `wasm32-unknown-unknown`
  toolchain (so a model's controller builds to a wasm core module in-container)
  and the Foray tooling compiled from `crates/`: the baked-in `foray` CLI, the
  controller buildkit, and the reference modules + map; and
- the **performance** image, which every
  [performance](../apps/docs/src/content/docs/testing/performance/overview.md)
  run executes in — the base image plus the Rust + `wasm32-unknown-unknown`
  toolchain (so a model's engine builds to a wasm core module in-container) and
  the Lattice tooling compiled from `crates/`: the baked-in `lattice` CLI, the
  engine buildkit, the reference engines, and the committed training scenarios.

None is a per-harness image — a run installs the selected harness's CLI into
the image at run time, by running the harness's `install` command (see
[`../harnesses/README.md`](../harnesses/README.md)). Installing at run time is
what lets a run always pick up the harness's most recently published version,
rather than whatever was current when an image was last built. The runner picks
the image by test type and asset kind via
[`harness::resolve_run_image`](../crates/core/src/harness.rs).

## Layout

```
containers/
├── base/Dockerfile             # the end-to-end run image (toolchain, run user)
├── sprite/Dockerfile           # the base image plus the baked-in `draw` binary
├── sprite-sheet/Dockerfile     # the base image plus the baked-in `draw-sheet` binary
├── voxel/Dockerfile            # the base image plus the baked-in `voxel` binary
├── voxel-animation/Dockerfile  # the base image plus the baked-in `voxel-anim` binary
├── mc/Dockerfile               # the base image plus the baked-in `mc` binary (Marching Cubes)
├── mc-animation/Dockerfile     # the base image plus the baked-in `mc-anim` binary
├── sn/Dockerfile               # the base image plus the baked-in `sn` binary (Surface Nets)
├── sn-animation/Dockerfile     # the base image plus the baked-in `sn-anim` binary
├── dc/Dockerfile               # the base image plus the baked-in `dc` binary (Dual Contouring)
├── dc-animation/Dockerfile     # the base image plus the baked-in `dc-anim` binary
├── adversarial/                # the base image plus the wasm toolchain + Foray tooling
│   ├── Dockerfile              #   (foray CLI, references + map, controller buildkit)
│   └── buildkit/Cargo.toml     #   de-workspaced root for the baked buildkit crates
├── performance/                # the base image plus the wasm toolchain + Lattice tooling
│   ├── Dockerfile              #   (lattice CLI, reference engines, training, engine buildkit)
│   └── buildkit/Cargo.toml     #   de-workspaced root for the baked buildkit crates
└── build.sh                    # builds (and optionally pushes) all thirteen images
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
case prepares its workspace with an init command. End-to-end runs never touch a
drawing tool, so neither lives in the base — they live in the asset-generation
images below.

## Asset-generation images

Asset-generation runs split by [`asset_kind`](../apps/docs/src/content/docs/testing/asset-generation/manifests.md):
a single-sprite case draws with `draw`, a sprite-sheet case draws with
`draw-sheet`. Each gets its own image so a run carries only the tool it uses:

- `sprite/` is the base image plus exactly the **`draw`** binary, the drawing tool
  a single-sprite
  [asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  run uses.
- `sprite-sheet/` is the base image plus exactly the **`draw-sheet`** binary, the
  drawing tool a sprite-sheet run uses (`draw` plus a required `--frame` on every
  operation).
- `voxel/` is the base image plus exactly the **`voxel`** binary, the sculpting
  tool a static-voxel run uses.
- `voxel-animation/` is the base image plus exactly the **`voxel-anim`** binary,
  the sculpting-and-rigging tool a rigged-voxel run uses.
- `mc/` and `mc-animation/` are the base image plus exactly the **`mc`** /
  **`mc-anim`** binary, the Marching Cubes meshing tool (static / rigged) a
  low-poly meshing run uses.
- `sn/` and `sn-animation/` are the base image plus exactly the **`sn`** /
  **`sn-anim`** binary, the Surface Nets meshing tool (static / rigged) a
  smooth mid-fidelity meshing run uses.
- `dc/` and `dc-animation/` are the base image plus exactly the **`dc`** /
  **`dc-anim`** binary, the Dual Contouring meshing tool (static / rigged) a
  high-fidelity, sharp-feature meshing run uses.

Each meshing image bakes in its one binary the same way `sprite`/`voxel` do; the
`-animation` images add the rigging/F-curve authoring that
`voxel-anim` uses. The voxel-family binaries render their preview PNGs with a
`wgpu` renderer targeting Mesa (software Vulkan, headless), not the old
deterministic isometric rasterizer, and their output is judged from the emitted
data plus the rendered previews — there is no cheat-divergence check on these
binaries.

Both drawing Dockerfiles are `FROM` the base, so each inherits the toolchain, the `node`
run user, the `/work` working directory, and the keep-alive `CMD`, and adds only
its one binary. Unlike a harness CLI, these binaries are part of The Test Cabinet
itself and their drawing logic must match the orchestrator's — the orchestrator
regenerates an asset-generation run's scored image from its action log through the
*same* library they use — so each is compiled from this repo (a multi-stage build
in its Dockerfile) and baked in rather than installed at run time. Because of this
coupling, **build the images from the same commit as the orchestrator**: a run
records both the orchestrator commit and the image digest, so a version mismatch
(which would invalidate the cheat-divergence signal) is auditable after the fact.
Compiling the binaries is why the build context is the repository root rather than
each image's directory (see `build.sh`); `build.sh` builds both asset-generation
images `FROM` the base it builds alongside them, so all three stay in lockstep.

## Adversarial image

`adversarial/` is the base image plus the **Rust toolchain with the
`wasm32-unknown-unknown` target** and **The Test Cabinet's own Foray tooling**
(`adversarial/Dockerfile` is `FROM` the base, so it inherits the toolchain, the
`node` run user, the `/work` working directory, and the keep-alive `CMD`). An
[adversarial](../apps/docs/src/content/docs/testing/adversarial/overview.md) run
asks the model to write a controller in Rust; the case's `[build]` commands
compile that controller to a wasm core module **inside this container at run
time**, which is why the Rust toolchain is baked in. The toolchain is installed
system-wide and made world-readable so the unprivileged run user can invoke
`cargo`/`rustc` and the wasm target without root; its cargo registry/cache is
owned by the run user so a controller build can resolve dependencies at run time.

Like the asset-generation images, this one **also bakes in The Test Cabinet's own
tooling**, compiled from `crates/` in a multi-stage build and copied under
`/usr/local/bin` and `/opt/foray`:

- the **`foray` CLI** (`/usr/local/bin/foray`) — the binary a model runs its
  controller through to play local matches against the baselines. It hosts the
  *same* `foray-host` engine the validator scores with, so it must be built from
  this repo and kept in lockstep, not installed at run time;
- the **controller buildkit** (`/opt/foray/buildkit`) — fresh, source-only copies
  of `foray-core` and `foray-controller-sdk` (with a de-workspaced root manifest,
  [`adversarial/buildkit/Cargo.toml`](adversarial/buildkit/Cargo.toml), that
  re-supplies their `workspace = true` inheritance) that the seeded `controller`
  crate path-depends on to build — so the run workspace vendors nothing; and
- the **reference controllers** (`/opt/foray/references`, pre-built wasm + readable
  source) and the **canonical map** (`/opt/foray/maps`) — the baselines a model
  plays against. `$FORAY_HOME` is set to `/opt/foray` so specs and a model can name
  these by `$FORAY_HOME/references/…` rather than a hard-coded path.

The same coupling argument as the asset-generation binaries applies: the CLI, the
buildkit crates, and the reference modules must match the engine the validator
scores against, so **build this image from the same commit as the orchestrator**
(a run records both the orchestrator commit and the image digest, so a mismatch is
auditable). Compiling them is why the build context is the repository root rather
than the image's directory (see `build.sh`); the build also smoke-compiles the
buildkit standalone, so a buildkit root that has drifted from the repository's
workspace dependencies fails the image build.

## Performance image

`performance/` is the base image plus the **Rust toolchain with the
`wasm32-unknown-unknown` target** and **The Test Cabinet's own Lattice tooling**
(`performance/Dockerfile` is `FROM` the base, so it inherits the toolchain, the
`node` run user, the `/work` working directory, and the keep-alive `CMD`). A
[performance](../apps/docs/src/content/docs/testing/performance/overview.md) run
asks the model to write a factory-simulation engine in Rust; the case's `[build]`
commands compile that engine to a wasm core module **inside this container at run
time**, exactly as the adversarial image compiles a controller, which is why the
Rust toolchain is baked in the same way (system-wide, world-readable, with a
run-user-owned cargo registry).

Like the adversarial image, this one **also bakes in The Test Cabinet's own
tooling**, compiled from `crates/` in a multi-stage build and copied under
`/usr/local/bin` and `/opt/lattice`:

- the **`lattice` CLI** (`/usr/local/bin/lattice`) — the binary a model runs to
  solve scenarios with the oracle and score its engine locally. It hosts the
  *same* `lattice-host` the validator scores with, so it must be built from this
  repo and kept in lockstep, not installed at run time;
- the **engine buildkit** (`/opt/lattice/buildkit`) — fresh, source-only copies of
  `lattice-core` and `lattice-sdk` (with a de-workspaced root manifest,
  [`performance/buildkit/Cargo.toml`](performance/buildkit/Cargo.toml), that
  re-supplies their `workspace = true` inheritance) that the seeded `engine` crate
  path-depends on to build — so the run workspace vendors nothing;
- the **reference engines** (`/opt/lattice/references`, pre-built wasm + readable
  source) — the naive and transport worked examples; and
- the **training scenarios** (`/opt/lattice/training`, each
  `<name>/{scenario.json,expected.json}`) — the labelled practice set, copied from
  the case's version folder. `$LATTICE_HOME` is set to `/opt/lattice` so specs and
  a model can name these by `$LATTICE_HOME/training/…` rather than a hard-coded
  path. The **held-out scored set is never baked here** — it lives only with the
  case, so a model cannot reach it.

The same coupling argument as the adversarial tooling applies: the CLI, the
buildkit crates, the reference modules, and the training set must match the types
and checksum the validator scores against, so **build this image from the same
commit as the orchestrator** (a run records both the orchestrator commit and the
image digest, so a mismatch is auditable). Compiling them is why the build context
is the repository root rather than the image's directory (see `build.sh`); the
build also smoke-compiles the buildkit standalone, so a buildkit root that has
drifted from the repository's workspace dependencies fails the image build.

## Building

Run on a machine with Docker (or Podman) available:

```sh
./build.sh                # build all thirteen images (base, sprite, sprite-sheet, voxel, voxel-animation, mc, mc-animation, sn, sn-animation, dc, dc-animation, adversarial, performance)
DOCKER=podman ./build.sh  # build with Podman instead
```

Build-only mode tags `test-cabinet-base:latest`, `test-cabinet-sprite:latest`,
`test-cabinet-sprite-sheet:latest`, `test-cabinet-voxel:latest`,
`test-cabinet-voxel-animation:latest`, `test-cabinet-mc:latest`,
`test-cabinet-mc-animation:latest`, `test-cabinet-sn:latest`,
`test-cabinet-sn-animation:latest`, `test-cabinet-dc:latest`,
`test-cabinet-dc-animation:latest`, `test-cabinet-adversarial:latest`, and
`test-cabinet-performance:latest` locally. Those are exactly the names a runner
resolves (by test type and asset
kind) when its `TCAB_CONTAINER_REGISTRY` is set to an empty string, so a
locally-built image is used for offline development without pulling anything.
Override `IMAGE_TAG` / `IMAGE_NAME_PREFIX` to change the tag or name prefix.

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
Docker host. When validating on Linux, build all thirteen images (`./build.sh`) and
confirm a container from each runs and keeps alive, that `draw` is on `PATH` in
the sprite image and `draw-sheet` is on `PATH` in the sprite-sheet image, that
each voxel-family binary (`voxel`, `voxel-anim`, `mc`, `mc-anim`, `sn`, `sn-anim`,
`dc`, `dc-anim`) is on `PATH` in its matching image, and
that the adversarial image gives the unprivileged run user `cargo`/`rustc` and the
`wasm32-unknown-unknown` target (e.g. `cargo --version` and a trivial
`cargo build --target wasm32-unknown-unknown` as `node`), `foray` on `PATH`
(`foray --version`), and a buildable controller against the baked buildkit — copy
a case's `controller/` and confirm `cargo build --release --target
wasm32-unknown-unknown -p controller` emits `controller.wasm` and
`foray simulate --red … --blue $FORAY_HOME/references/border-soldier.wasm --map
$FORAY_HOME/maps/mirror-32x16.toml --out replay.json` runs as `node`. Validating each
**harness** — that its
[install command](../harnesses/README.md) lands a working CLI on `PATH`, the
exact non-interactive flags, its token/usage reporting format, and which
environment variable carries the provider API key — is tracked alongside the
harness manifests and the adapters in `crates/core/src/harness_registry.rs`.
