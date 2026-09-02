# The music run-container image for The Test Cabinet.
#
# Every music run (a case with `asset_kind = "music"`) executes in this one image. It is
# the base run-container image plus the baked-in `music` binary AND the baked-in
# instrument banks — the fixed palettes of sample-based instruments the sequencer plays,
# one per bank a case may name (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md` and the
# sample-library section of `containers/README.md`). The audio tools render on the CPU,
# so — like the sprite image and unlike the voxel family — this image needs no
# Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness CLI,
# it is part of The Test Cabinet itself and core validates the emitted `.wav`/`.mid` with
# the same library it uses. Building from one commit keeps them in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable). The
# baked-in tooling is compiled by the shared builder (`containers/tools/Dockerfile`) —
# see `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

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

# --- The run image: the base, plus `music` + the instrument banks -----------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `music` binary from the tools image. `/usr/local/bin` is on PATH
# and root-owned (COPY writes as root regardless of the inherited `USER node`);
# the unprivileged run user only executes it. The base image already sets `USER
# node`, `WORKDIR /work`, and the keep-alive CMD.
COPY --from=tools /out/music /usr/local/bin/music

# --- Bake in the instrument banks the `music` sequencer plays ---------------
#
# The audio is not committed to this repository: the clip bytes live in the private
# audio object store, and `containers/build.sh` stages the tree this image bakes with
# `scripts/stage-audio-image.mjs` before the build, verifying every object against
# `containers/sample-packs/objects.lock.json` as it lands. `AUDIO_STAGE_DIR` is that
# staged tree's path within the build context (the repository root):
#   --build-arg AUDIO_STAGE_DIR=dist/audio-image/<hash>/audio
# Its default points nowhere, so a build that does not go through `build.sh` fails at
# the COPY below rather than shipping an image with a missing palette.
ARG AUDIO_STAGE_DIR=dist/audio-image/unstaged/audio

# Copy the staged tree to the path the `audio-core` loader reads. It holds
# `clips/<clip-id>.<profile-id>.wav` plus one `packs/<name>/pack.toml` per bank
# (`gm-lite`, `cinematic`, `synthwave`), whose entries reference the shared clip files
# relatively, so a clip several banks name is carried once (`load_pack` in
# `crates/audio-core/src/sample.rs` resolves each entry's `file` against its pack
# directory). The subdirectory name is the bank name a case selects by. Make it
# world-readable for the unprivileged run user; COPY writes as root, so bracket it with
# the root/node USER switch the base image's `USER node` otherwise leaves in force.
USER root
COPY ${AUDIO_STAGE_DIR} /opt/audio
RUN chmod -R a+rX /opt/audio
USER node

# Point the `music` binary at the banks ROOT; the run's `instrument_bank` name selects
# the subdirectory under it (see `select_pack_dir` in `crates/audio-core/src/config.rs`),
# and a bank with no subdirectory there is a load error rather than some other palette.
# `TCAB_INSTRUMENT_BANK` names the bank a run gets when its config names none. Kept here
# so the image, not a run's seeded config, owns where the palettes live.
ENV TCAB_INSTRUMENT_BANK_DIR=/opt/audio/packs
ENV TCAB_INSTRUMENT_BANK=gm-lite
