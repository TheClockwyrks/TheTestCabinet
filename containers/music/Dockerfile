# The music run-container image for The Test Cabinet.
#
# Every music run (a case with `asset_kind = "music"`) executes in this one image. It
# is the base run-container image plus the baked-in `music` binary AND a baked-in
# instrument bank — the fixed palette of sample-based instruments the sequencer plays
# (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md` and the
# sample-library section of `containers/README.md`). The audio tools render on the CPU,
# so — like the sprite image and unlike the voxel family — this image needs no
# Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted `.wav`/`.mid`
# with the same library it uses. Building from one commit keeps them in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable).
# The build context is the repository root so the compile stage can see `crates/` — see
# `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `music` binary from this repository ---------------
FROM docker.io/library/rust:1-bookworm AS audio-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph; `-p test-cabinet-music --bin music` compiles only this binary and
# its dependencies. The glibc target matches the bookworm-based base image below — do
# not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-music --bin music

# --- Stage 2: the base run image, plus `music` + the instrument bank --------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `music` binary compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD.
COPY --from=audio-build /build/target/release/music /usr/local/bin/music

# --- Bake in the instrument bank the `music` sequencer plays ----------------
#
# The instrument bank is a separately-versioned, content-addressed artifact (an
# object-storage tarball) assembled by `scripts/build-sample-pack.mjs` from a manifest
# under `containers/sample-packs/` (the audio files are NOT committed to this repo). The
# build PINS a bank BY DIGEST: `build-sample-pack.mjs` prints the tarball's `sha256:…`,
# which is passed as `INSTRUMENT_BANK_SHA256` and enforced by `ADD --checksum` below, so
# the baked palette is immutable and versioned with the image — a run container is
# offline, so nothing is fetched at RUN time; this fetch happens at BUILD time, pinned.
#
# Supply all three build args from the `build-sample-pack.mjs` run that produced the
# bank (see `containers/sample-packs/README.md`); the defaults are placeholders that
# fail the build until a real bank is pinned:
#   --build-arg INSTRUMENT_BANK=gm-lite@0.1.0
#   --build-arg INSTRUMENT_BANK_SHA256=sha256:<digest printed by build-sample-pack.mjs>
#   --build-arg INSTRUMENT_BANK_URL=<object-storage URL of gm-lite-0.1.0.tar>
ARG INSTRUMENT_BANK=gm-lite@0.1.0
ARG INSTRUMENT_BANK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG INSTRUMENT_BANK_URL

# Fetch the pinned tarball (BuildKit verifies it against INSTRUMENT_BANK_SHA256 — a
# mismatch or a missing URL fails the build) and unpack it to the path the `audio-core`
# loader reads (`load_pack` in `crates/audio-core/src/sample.rs`: a `*.toml` manifest
# plus the `<name>.wav` audio beside it). The bank tar's root holds `pack.toml` + the
# `.wav` files, so unpack it into the target dir. Make it world-readable for the
# unprivileged run user.
USER root
ADD --checksum=${INSTRUMENT_BANK_SHA256} ${INSTRUMENT_BANK_URL} /tmp/instrument-bank.tar
RUN mkdir -p /opt/instrument-banks/gm-lite \
	&& tar -xf /tmp/instrument-bank.tar -C /opt/instrument-banks/gm-lite \
	&& rm /tmp/instrument-bank.tar \
	&& chmod -R a+rX /opt/instrument-banks
USER node

# Point the `music` binary at the baked bank. `audio-core`'s config carries a `pack_dir`
# the loader reads; this env var is the baked-image source of that path (the run config
# only names the bank as `instrument_bank = "<name>@<version>"`). Kept here so the
# image, not a run's seeded config, owns where the palette physically lives.
ENV TCAB_INSTRUMENT_BANK=${INSTRUMENT_BANK}
ENV TCAB_INSTRUMENT_BANK_DIR=/opt/instrument-banks/gm-lite
