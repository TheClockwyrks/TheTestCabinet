# The procedural sound-effect run-container image for The Test Cabinet.
#
# Every procedural sound-effect run (a case with `asset_kind = "sfx-synth"`) executes
# in this one image. It is the base run-container image plus the baked-in `sfx-synth`
# binary, the tool a synthesis run builds a sound from oscillators and noise with (see
# the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`). The audio
# tools render a `.wav` and a waveform/spectrogram PNG on the CPU, so — like the sprite
# image and unlike the voxel family — this image needs no Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted `.wav` with
# the same library it uses. Building from one commit keeps them in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable).
# The build context is the repository root so the compile stage can see `crates/` — see
# `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `sfx-synth` binary from this repository -----------
FROM docker.io/library/rust:1.97.1-bookworm AS audio-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph; `-p test-cabinet-sfx-synth --bin sfx-synth` compiles only this
# binary and its dependencies. The glibc target matches the bookworm-based base image
# below — do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-sfx-synth --bin sfx-synth

# --- Stage 2: the base run image, plus `sfx-synth` --------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `sfx-synth` binary compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed here.
COPY --from=audio-build /build/target/release/sfx-synth /usr/local/bin/sfx-synth
