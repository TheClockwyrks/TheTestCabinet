# The 2D full-stack run-container image for The Test Cabinet.
#
# Every full-stack run (a case with `type = "full-stack"`) executes in this one image.
# Unlike an end-to-end run — which builds a program in the Rust/wasm base image — a
# full-stack run must ALSO produce its own 2D assets during the run, so this image is
# the Rust/wasm base image (`base-wasm`) plus the baked-in 2D asset-generation binaries
# on `PATH`: `draw` and `draw-sheet` (sprites / sprite sheets), `particle-2d` (particle
# systems), and the three audio tools `sfx-synth` (procedural SFX), `sfx-sample`
# (sampled SFX), and `music` (sampled-instrument music). See the asset-generation docs
# under `apps/docs/src/content/docs/testing/asset-generation/` for each tool and
# `apps/docs/src/content/docs/testing/full-stack/` for how a full-stack case wires the
# produced assets into its build. The 3D asset tooling (voxel/mesh/blender) is
# deliberately NOT here: a full-stack-3d image is a separate, later addition.
#
# The binaries are baked in rather than installed at run time because, like the
# per-kind asset-generation images, they are part of The Test Cabinet itself; building
# them from one commit alongside `core` keeps their libraries in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable). A
# full-stack run's assets are build INPUTS, not a separately-scored output, so — unlike
# an asset-generation run — nothing here regenerates an action log; the produced files
# are consumed by the built program and judged as part of it. The baked-in tooling is
# compiled by the shared builder (`containers/tools/Dockerfile`) — see
# `containers/build.sh`.
#
# This image inherits everything from base-wasm — the Node build toolchain, the Rust +
# `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack` toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it only
# adds the six binaries and the baked audio palette. The image a run resolves is
# selected by its test type (see crate `harness::resolve_run_image`).

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

# --- The run image: the base-wasm, plus the binaries + the audio palette ----
# `FROM` the base-wasm built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the six binaries from the tools image. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes them, never writes them. The base image
# already sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing
# else is needed for the binaries themselves.
COPY --from=tools /out/draw /usr/local/bin/draw
COPY --from=tools /out/draw-sheet /usr/local/bin/draw-sheet
COPY --from=tools /out/particle-2d /usr/local/bin/particle-2d
COPY --from=tools /out/sfx-synth /usr/local/bin/sfx-synth
COPY --from=tools /out/sfx-sample /usr/local/bin/sfx-sample
COPY --from=tools /out/music /usr/local/bin/music

# --- Bake in the audio palette `sfx-sample` and `music` read ----------------
#
# Identical mechanism to the dedicated `sfx-sample` and `music` images (see
# `containers/sfx-sample/Dockerfile` and `containers/music/Dockerfile`), with one tree
# serving both tools. The audio is not committed to this repository: the clip bytes
# live in the private audio object store, and `containers/build.sh`
# (`build_full_stack_2d`) stages the tree this image bakes with
# `scripts/stage-audio-image.mjs` before the build, verifying every object against
# `containers/sample-packs/objects.lock.json` as it lands. `AUDIO_STAGE_DIR` is that
# staged tree's path within the build context (the repository root):
#   --build-arg AUDIO_STAGE_DIR=dist/audio-image/<hash>/audio
# Its default points nowhere, so a build that does not go through `build.sh` fails at
# the COPY below rather than shipping an image with a missing palette.
ARG AUDIO_STAGE_DIR=dist/audio-image/unstaged/audio

# Copy the staged tree to the path the `audio-core` loader reads. It holds
# `clips/<clip-id>.<profile-id>.wav` plus one `packs/<name>/pack.toml` per pack — the
# `combat-core` sample pack `sfx-sample` mixes over AND every instrument bank `music`
# can play (`gm-lite`, `cinematic`, `synthwave`), because a full-stack case may name
# any of them and a bank that is not baked is a load error rather than a fallback.
# Entries
# reference the shared clip files relatively, so a clip several packs name is carried
# once (`load_pack` in `crates/audio-core/src/sample.rs` resolves each entry's `file`
# against its pack directory). Make it world-readable for the unprivileged run user;
# COPY writes as root, so bracket it with the root/node USER switch the base image's
# `USER node` otherwise leaves in force.
USER root
COPY ${AUDIO_STAGE_DIR} /opt/audio
RUN chmod -R a+rX /opt/audio
USER node

# Point both tools at the packs ROOT, under which a config's `sample_pack` /
# `instrument_bank` name selects a subdirectory (see `select_pack_dir` in
# `crates/audio-core/src/config.rs`); a name with no subdirectory there is a load error
# rather than some other palette. A full-stack model authors its own
# `sfx-sample.config.json` / `music.config.json` and typically names no palette, so
# `TCAB_SAMPLE_PACK` and `TCAB_INSTRUMENT_BANK` state which of the baked palettes such a
# run reads. The image, not a run's config, owns where the audio physically lives.
ENV TCAB_SAMPLE_PACK_DIR=/opt/audio/packs
ENV TCAB_SAMPLE_PACK=combat-core
ENV TCAB_INSTRUMENT_BANK_DIR=/opt/audio/packs
ENV TCAB_INSTRUMENT_BANK=gm-lite
