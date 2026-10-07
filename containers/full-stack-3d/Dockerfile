# The 3D full-stack run-container image for The Test Cabinet.
#
# Every full-stack run whose case declares `asset_dimension = "3d"` executes in this one
# image; a full-stack case that declares nothing (or `"2d"`) resolves the sibling
# full-stack-2d image instead (see `containers/full-stack-2d/Dockerfile`, and
# `harness::resolve_run_image` in crate `core` for the selection). The two are siblings
# rather than a chain: this image is the 2D image's WHOLE content — the Rust/wasm base
# (`base-wasm`) plus `draw` and `draw-sheet` (sprites / sprite sheets), `particle-2d` (2D
# particle systems), and the three audio tools `sfx-synth` (procedural SFX), `sfx-sample`
# (sampled SFX) and `music` (sampled-instrument music), and, like it, no baked audio
# — PLUS the 3D model and effect tooling a 3D full-stack build needs: `voxel` (static
# voxel models), `voxel-anim` (rigged/animated voxel models) and `particle-3d` (3D particle
# systems). A 3D game still needs sprites and sheets for its UI and its 2D overlays, and it
# needs sound exactly as a 2D one does, so the 3D set is an ADDITION and not a replacement:
# a case that declares the 3D dimension loses nothing it would have had. See the
# asset-generation docs under `apps/docs/src/content/docs/testing/asset-generation/` for
# each tool and `apps/docs/src/content/docs/testing/full-stack/` for how a full-stack case
# wires the produced assets into its build.
#
# WHAT IS DELIBERATELY NOT HERE: the surface-extraction meshing families — `mc`/`sn`/`dc`
# and their `-anim`/`-skin` siblings, the SDF/CSG modelers — and the Blender toolchain.
# Both are a far heavier toolchain than the voxel one (Blender is not even `FROM` the
# shared base: it is a self-contained `ubuntu:26.04` image, see
# `containers/blender/Dockerfile`), and no full-stack case needs either yet. A full-stack
# case whose concept genuinely requires meshed geometry or a rigged Blender character is
# the reason to revisit this list — until one exists, baking those families in would put
# hundreds of megabytes into every 3D full-stack run to no end. The dimension key has room
# for that answer; this image is not it.
#
# The binaries are baked in rather than installed at run time because, like the per-kind
# asset-generation images, they are part of The Test Cabinet itself; building them from one
# commit alongside `core` keeps their libraries in lockstep (a run records the orchestrator
# commit and the image digest, so a mismatch is auditable). A full-stack run's assets are
# build INPUTS, not a separately-scored output, so — unlike an asset-generation run —
# nothing here regenerates an action log; the produced files are consumed by the built
# program and judged as part of it. The baked-in tooling is compiled by the shared builder
# (`containers/tools/Dockerfile`) — see `containers/build.sh`.
#
# This image inherits everything from base-wasm — the Node build toolchain, the Rust +
# `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack` toolchain, the unprivileged `node`
# run user, the `/work` working directory, the empty `/opt/audio` staging root, and the
# keep-alive CMD — so it adds only the nine binaries and the Mesa software-Vulkan runtime
# three of them render through. The audio palette `sfx-sample` and `music` read is NOT
# baked here, exactly as it is not in the 2D image: a run is staged with the packs its case
# names in `[audio] packs`, written into the started container at `/opt/audio`, so a
# full-stack container holds exactly the packs its manifest declares and nothing else.

# `BASE_IMAGE` is the base image to extend — the Rust/wasm base (`base-wasm`), so a
# full-stack build may author its simulation core in Rust and ship it as committed
# wasm. It is declared here, BEFORE the first `FROM`, so it is a global build arg the
# `FROM` for the run image below can consume — an `ARG` declared after a `FROM` is
# scoped to that stage and would be blank in a later `FROM`. `build.sh` passes the
# base-wasm image it just built (e.g. the local `test-cabinet-base-wasm:latest`, or a
# registry-qualified tag) so this image is always `FROM` the matching base-wasm.
ARG BASE_IMAGE=test-cabinet-base-wasm:latest

# `TOOLS_IMAGE` is the shared asset-tooling builder that compiles every run
# image's baked-in binaries — ONE cargo pass over the whole dependency graph,
# rather than a per-image `cargo build` that recompiles that graph from scratch
# (`containers/tools/Dockerfile` has the numbers). Declared BEFORE the first
# `FROM` for the same reason `BASE_IMAGE` is: an `ARG` after a `FROM` is scoped
# to that stage. `build.sh` passes the tools image it just built, so the baked-in
# binaries always come from this same invocation's compile.
ARG TOOLS_IMAGE=test-cabinet-tools:latest

# Resolve the tooling builder to a named stage. `COPY --from=` cannot interpolate
# a build arg directly ("variable expansion is not supported for --from"), so it
# has to arrive through a `FROM`; the `COPY --from=tools` lines below then name
# this stage.
FROM ${TOOLS_IMAGE} AS tools

# --- The run image: the base-wasm, plus Mesa, the binaries + the audio packs -
# `FROM` the base-wasm built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# THE ONE THING THE 2D IMAGE DOES NOT NEED. `voxel`, `voxel-anim` and `particle-3d` each
# write a preview PNG, and each draws it through `wgpu` targeting Mesa's software Vulkan
# (lavapipe) — there is no GPU in the run container, so the image must ship the Mesa Vulkan
# ICD (`mesa-vulkan-drivers`, which provides lavapipe) and the Vulkan loader (`libvulkan1`)
# the binaries link against at run time. This is the same install the per-kind voxel,
# voxel-animation and particle-3d images carry, and for the same reason: without it the
# binaries are on `PATH` and every render dies at preview time, on an image that otherwise
# looks entirely correct. Installing OS packages needs root, so switch to root for the
# apt-get and switch back to the unprivileged `node` run user the base image set, leaving
# the run user unchanged.
#
# It is also what makes this image a FIFTH gg environment rather than a copy of an existing
# one: `containers/build.sh`'s `assert_gg_environments` groups the `-gg` variants by the
# packages installed along each chain, and base-wasm's packages plus these is a combination
# no other run image has. That is why `full-stack-3d-gg` is in GG_SELFCHECK_IMAGES — read
# the argument there before changing this block.
USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libvulkan1 \
		mesa-vulkan-drivers \
	&& rm -rf /var/lib/apt/lists/*
USER node

# Force `wgpu` onto the lavapipe (software CPU) Vulkan device deterministically
# in-container: no GPU or display is present, and the base+Mesa install ships
# an ICD for every driver, so restrict the loader to the lavapipe driver by
# manifest-name glob. This is arch-agnostic (the manifest is `lvp_icd.<arch>.json`,
# e.g. `lvp_icd.x86_64.json` or `lvp_icd.aarch64.json`), unlike pinning an
# absolute VK_ICD_FILENAMES path, so it selects lavapipe on both x86_64 and arm64
# (this project's local dev and prod are arm64). XDG_RUNTIME_DIR gives the loader
# a writable runtime dir so it does not warn on every render.
ENV VK_LOADER_DRIVERS_SELECT=lvp*
ENV XDG_RUNTIME_DIR=/tmp

# Bake in the nine binaries from the tools image — the 2D six the full-stack-2d image
# carries, then the three 3D additions. `/usr/local/bin` is on PATH and root-owned (COPY
# writes as root regardless of the inherited `USER node`); the unprivileged run user only
# executes them, never writes them. The base image already sets `USER node`, `WORKDIR
# /work`, and the keep-alive CMD, so nothing else is needed for the binaries themselves.
COPY --from=tools /out/draw /usr/local/bin/draw
COPY --from=tools /out/draw-sheet /usr/local/bin/draw-sheet
COPY --from=tools /out/particle-2d /usr/local/bin/particle-2d
COPY --from=tools /out/sfx-synth /usr/local/bin/sfx-synth
COPY --from=tools /out/sfx-sample /usr/local/bin/sfx-sample
COPY --from=tools /out/music /usr/local/bin/music
COPY --from=tools /out/voxel /usr/local/bin/voxel
COPY --from=tools /out/voxel-anim /usr/local/bin/voxel-anim
COPY --from=tools /out/particle-3d /usr/local/bin/particle-3d
