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
FROM docker.io/library/rust:1.97.1-bookworm AS audio-build
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
# The image bakes EVERY instrument bank as a per-name subdirectory under
# `/opt/instrument-banks/`, so a `music` case's `instrument_bank = "<name>@<version>"`
# selects which palette it plays (see `select_pack_dir` in
# `crates/audio-core/src/config.rs`). The FIRST bank (gm-lite) is the default recorded
# in `TCAB_INSTRUMENT_BANK`. Each bank is a separately-pinned, content-addressed pack;
# `containers/build.sh` (`build_music_image`) presigns each from R2 and passes its three
# build args. The defaults are placeholders that fail the build until a real bank is
# pinned:
#   --build-arg INSTRUMENT_BANK=gm-lite@0.1.0 (+_URL, +_SHA256)
#   --build-arg INSTRUMENT_BANK_CINEMATIC=cinematic@0.1.0 (+_URL, +_SHA256)
#   --build-arg INSTRUMENT_BANK_SYNTHWAVE=synthwave@0.1.0 (+_URL, +_SHA256)
ARG INSTRUMENT_BANK=gm-lite@0.1.0
ARG INSTRUMENT_BANK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG INSTRUMENT_BANK_URL

ARG INSTRUMENT_BANK_CINEMATIC=cinematic@0.1.0
ARG INSTRUMENT_BANK_CINEMATIC_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG INSTRUMENT_BANK_CINEMATIC_URL

ARG INSTRUMENT_BANK_SYNTHWAVE=synthwave@0.1.0
ARG INSTRUMENT_BANK_SYNTHWAVE_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG INSTRUMENT_BANK_SYNTHWAVE_URL

# Fetch each pinned tarball (BuildKit verifies it against its …_SHA256 — a mismatch or a
# missing URL fails the build) and unpack it into its per-name subdir. Each bank tar's
# root holds `pack.toml` + the `.wav` files (exactly what `load_pack` in
# `crates/audio-core/src/sample.rs` reads), so the subdir name must equal the bank name
# (`gm-lite`, `cinematic`, `synthwave`). Make them world-readable for the run user.
USER root
ADD --checksum=${INSTRUMENT_BANK_SHA256} ${INSTRUMENT_BANK_URL} /tmp/bank-gm-lite.tar
ADD --checksum=${INSTRUMENT_BANK_CINEMATIC_SHA256} ${INSTRUMENT_BANK_CINEMATIC_URL} /tmp/bank-cinematic.tar
ADD --checksum=${INSTRUMENT_BANK_SYNTHWAVE_SHA256} ${INSTRUMENT_BANK_SYNTHWAVE_URL} /tmp/bank-synthwave.tar
RUN mkdir -p /opt/instrument-banks/gm-lite /opt/instrument-banks/cinematic /opt/instrument-banks/synthwave \
	&& tar -xf /tmp/bank-gm-lite.tar -C /opt/instrument-banks/gm-lite \
	&& tar -xf /tmp/bank-cinematic.tar -C /opt/instrument-banks/cinematic \
	&& tar -xf /tmp/bank-synthwave.tar -C /opt/instrument-banks/synthwave \
	&& rm /tmp/bank-*.tar \
	&& chmod -R a+rX /opt/instrument-banks
USER node

# Point the `music` binary at the banks ROOT; the run's `instrument_bank` name selects
# the subdir (see `select_pack_dir`). `TCAB_INSTRUMENT_BANK` records the default bank.
# Kept here so the image, not a run's seeded config, owns where the palettes live.
ENV TCAB_INSTRUMENT_BANK=${INSTRUMENT_BANK}
ENV TCAB_INSTRUMENT_BANK_DIR=/opt/instrument-banks
