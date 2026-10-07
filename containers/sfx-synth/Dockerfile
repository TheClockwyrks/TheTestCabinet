# The procedural sound-effect run-container image for The Test Cabinet.
#
# Every procedural sound-effect run (a case with `asset_kind = "sfx-synth"`) executes
# in this one image. It is the base run-container image plus the baked-in `sfx-synth`
# binary, the tool a synthesis run builds a sound from oscillators and noise with (see
# the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`). The audio
# tools render a `.wav` and a waveform/spectrogram PNG on the CPU, so — like the
# sprite image and unlike the voxel family — this image needs no Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted `.wav` with
# the same library it uses. Building from one commit keeps them in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable).
# The baked-in tooling is compiled by the shared builder
# (`containers/tools/Dockerfile`) — see `containers/build.sh`.

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

# --- The run image: the base, plus `sfx-synth` ------------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `sfx-synth` binary from the tools image. `/usr/local/bin` is on
# PATH and root-owned (COPY writes as root regardless of the inherited `USER
# node`); the unprivileged run user only executes it. The base image already
# sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is
# needed here.
COPY --from=tools /out/sfx-synth /usr/local/bin/sfx-synth
