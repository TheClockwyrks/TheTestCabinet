# The 2D full-stack run-container image for The Test Cabinet.
#
# Every 2D full-stack run — a case with `type = "full-stack"` that declares no
# `asset_dimension`, or declares `"2d"` — executes in this one image.
# Unlike an end-to-end run — which builds a program in the Rust/wasm base image — a
# full-stack run must ALSO produce its own 2D assets during the run, so this image is
# the Rust/wasm base image (`base-wasm`) plus the baked-in 2D asset-generation binaries
# on `PATH`: `draw` and `draw-sheet` (sprites / sprite sheets), `particle-2d` (particle
# systems), and the three audio tools `sfx-synth` (procedural SFX), `sfx-sample`
# (sampled SFX), and `music` (sampled-instrument music). See the asset-generation docs
# under `apps/docs/src/content/docs/testing/asset-generation/` for each tool and
# `apps/docs/src/content/docs/testing/full-stack/` for how a full-stack case wires the
# produced assets into its build. The 3D voxel/particle tooling is deliberately NOT here:
# it lives in the sibling `full-stack-3d` image, which a case selects with
# `asset_dimension = "3d"` (see `containers/full-stack-3d/Dockerfile`). This image stays
# the 2D set, so a 2D case carries neither those binaries nor the Mesa software-Vulkan
# runtime they render their previews through.
#
# The binaries are baked in rather than installed at run time because, like the
# per-kind asset-generation images, they are part of The Test Cabinet itself; building
# them from one commit alongside `core` keeps their libraries in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable). A
# full-stack run's assets are build INPUTS, not a separately-scored output, so — unlike
# an asset-generation run — nothing here regenerates an action log; the produced files
# are consumed by the built program and judged as part of it. `draw` and `draw-sheet`
# are copied out of the `tool-sprite` image and `particle-2d` out of the `tool-particle`
# image, each at the commit the driver pins; the other three are compiled by the shared
# builder (`containers/tools/Dockerfile`) — see `containers/build.sh`.
#
# This image inherits everything from base-wasm — the Node build toolchain, the Rust +
# `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack` toolchain, the unprivileged
# `node` run user, the `/work` working directory, the empty `/opt/audio` staging root,
# and the keep-alive CMD — so it only adds the six binaries. The audio palette
# `sfx-sample` and `music` read is NOT baked here: a run is staged with the packs its
# case names in `[audio] packs`, written into the started container at `/opt/audio`, so
# a full-stack container holds exactly the packs its manifest declares and nothing
# else. The image a run resolves is selected by its test type and, for a full-stack
# case, its `asset_dimension` (see crate
# `harness::resolve_run_image`).

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
# binaries it compiles always come from this same invocation's compile.
ARG TOOLS_IMAGE=test-cabinet-tools:latest

# `TOOL_SPRITE_IMAGE` is the `tool-sprite` image `draw` and `draw-sheet` are copied
# out of: `testcabinet.azurecr.io/tool-sprite:<commit>` at the commit the driver pins,
# or, for a local build without PUSH, the image `build.sh` has just built from the
# `tool-sprite/` checkout (`scripts/ci/tool-images.sh` names the reference). Declared
# BEFORE the first `FROM` for the same reason as the two above.
ARG TOOL_SPRITE_IMAGE=test-cabinet-tool-sprite:latest

# `TOOL_PARTICLE_IMAGE` is the `tool-particle` image `particle-2d` is copied out of,
# taken as `TOOL_SPRITE_IMAGE` is: `testcabinet.azurecr.io/tool-particle:<commit>` at
# the commit the driver pins, or the image `build.sh` has just built from the
# `tool-particle/` checkout. Declared BEFORE the first `FROM` for the same reason.
ARG TOOL_PARTICLE_IMAGE=test-cabinet-tool-particle:latest

# Resolve the tooling builder and the tool images to named stages. `COPY --from=` cannot
# interpolate a build arg directly ("variable expansion is not supported for --from"),
# so each has to arrive through a `FROM`; the `COPY --from=tools`, `COPY
# --from=tool-sprite` and `COPY --from=tool-particle` lines below then name these stages.
FROM ${TOOLS_IMAGE} AS tools
FROM ${TOOL_SPRITE_IMAGE} AS tool-sprite
FROM ${TOOL_PARTICLE_IMAGE} AS tool-particle

# --- The run image: the base-wasm, plus the six 2D asset binaries -----------
# `FROM` the base-wasm built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the six binaries: `draw` and `draw-sheet` from the tool-sprite image and
# `particle-2d` from the tool-particle image, which carry them at `/usr/local/bin`, and
# the other three from the tools image.
# `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes them, never writes them. The base image
# already sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing
# else is needed for the binaries themselves.
COPY --from=tool-sprite /usr/local/bin/draw /usr/local/bin/draw
COPY --from=tool-sprite /usr/local/bin/draw-sheet /usr/local/bin/draw-sheet
COPY --from=tool-particle /usr/local/bin/particle-2d /usr/local/bin/particle-2d
COPY --from=tools /out/sfx-synth /usr/local/bin/sfx-synth
COPY --from=tools /out/sfx-sample /usr/local/bin/sfx-sample
COPY --from=tools /out/music /usr/local/bin/music
