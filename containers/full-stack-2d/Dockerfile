# The 2D full-stack run-container image for The Test Cabinet.
#
# Every full-stack run (a case with `type = "full-stack"`) executes in this one
# image. Unlike an end-to-end run — which builds a program in the Rust/wasm base
# image — a full-stack run must ALSO produce its own 2D assets during the run, so
# this image is the Rust/wasm base image (`base-wasm`) plus the baked-in 2D
# asset-generation binaries on `PATH`: `draw` and `draw-sheet` (sprites / sprite
# sheets), `particle-2d` (particle
# systems), and the three audio tools `sfx-synth` (procedural SFX), `sfx-sample`
# (sampled SFX), and `music` (sampled-instrument music). See the asset-generation
# docs under `apps/docs/src/content/docs/testing/asset-generation/` for each tool and
# `apps/docs/src/content/docs/testing/full-stack/` for how a full-stack case wires the
# produced assets into its build. The 3D asset tooling (voxel/mesh/blender) is
# deliberately NOT here: a full-stack-3d image is a separate, later addition.
#
# The binaries are baked in rather than installed at run time because, like the
# per-kind asset-generation images, they are part of The Test Cabinet itself; building
# them from one commit alongside `core` keeps their libraries in lockstep (a run
# records the orchestrator commit and the image digest, so a mismatch is auditable).
# A full-stack run's assets are build INPUTS, not a separately-scored output, so —
# unlike an asset-generation run — nothing here regenerates an action log; the produced
# files are consumed by the built program and judged as part of it. The build context
# is the repository root so the compile stage can see `crates/` — see
# `containers/build.sh`.
#
# This image inherits everything from base-wasm — the Node build toolchain, the
# Rust + `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack` toolchain, the
# unprivileged `node` run user, the `/work` working directory, and the keep-alive
# CMD — so it only adds the six binaries and the two audio packs. The image a run
# resolves is selected by its test type (see crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend — the Rust/wasm base (`base-wasm`), so a
# full-stack build may author its simulation core in Rust and ship it as committed
# wasm. It is declared here, BEFORE the first `FROM`, so it is a global build arg the
# `FROM` for the run image below can consume — an `ARG` declared after a `FROM` is
# scoped to that stage and would be blank in a later `FROM`. `build.sh` passes the
# base-wasm image it just built (e.g. the local `test-cabinet-base-wasm:latest`, or a
# registry-qualified tag) so this image is always `FROM` the matching base-wasm.
ARG BASE_IMAGE=test-cabinet-base-wasm:latest

# --- Stage 1: compile the six 2D asset-generation binaries ------------------
FROM docker.io/library/rust:1-bookworm AS assets-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph. Naming each package with `--bins` compiles exactly the six
# binaries these five crates expose (`test-cabinet-draw` alone exposes `draw` and
# `draw-sheet`) and nothing else, in ONE compile pass over the shared dependency graph.
# The glibc target matches the bookworm-based base image below — do not statically link
# musl here.
COPY . .
RUN cargo build --release --bins \
	-p test-cabinet-draw \
	-p test-cabinet-particle-2d \
	-p test-cabinet-sfx-synth \
	-p test-cabinet-sfx-sample \
	-p test-cabinet-music

# --- Stage 2: the base-wasm run image, plus the binaries + the audio packs -------
# `FROM` the base-wasm built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the six binaries compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes them, never writes them. The base image already
# sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed
# for the binaries themselves.
COPY --from=assets-build /build/target/release/draw /usr/local/bin/draw
COPY --from=assets-build /build/target/release/draw-sheet /usr/local/bin/draw-sheet
COPY --from=assets-build /build/target/release/particle-2d /usr/local/bin/particle-2d
COPY --from=assets-build /build/target/release/sfx-synth /usr/local/bin/sfx-synth
COPY --from=assets-build /build/target/release/sfx-sample /usr/local/bin/sfx-sample
COPY --from=assets-build /build/target/release/music /usr/local/bin/music

# --- Bake in the sample pack `sfx-sample` mixes over ------------------------
#
# Identical mechanism to the dedicated `sfx-sample` image (see
# `containers/sfx-sample/Dockerfile`): the sample pack is a separately-versioned,
# content-addressed object-storage tarball (the audio files are NOT committed to this
# repo). The build PINS it BY DIGEST — `SAMPLE_PACK_SHA256`, enforced by `ADD
# --checksum` — so the baked palette is immutable and versioned with the image; a run
# container is offline, so the fetch happens at BUILD time, pinned. `build.sh`'s
# `build_full_stack_2d` presigns a short-lived R2 GET URL from the pin in
# `containers/sample-packs/packs.lock.json` and supplies all three args (the defaults
# are placeholders that fail the build until a real pack is pinned):
#   --build-arg SAMPLE_PACK=combat-core@0.1.0
#   --build-arg SAMPLE_PACK_SHA256=sha256:<digest printed by build-sample-pack.mjs>
#   --build-arg SAMPLE_PACK_URL=<presigned R2 URL of combat-core-0.1.0.tar>
ARG SAMPLE_PACK=combat-core@0.1.0
ARG SAMPLE_PACK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG SAMPLE_PACK_URL

# Fetch + verify the pinned tarball and unpack it to the path the `audio-core` loader
# reads (`load_pack` in `crates/audio-core/src/sample.rs`: a `*.toml` manifest plus the
# `<name>.wav` audio beside it). The dir name is pack-agnostic (the loader is pointed at
# it by env below). Make it world-readable for the unprivileged run user.
USER root
ADD --checksum=${SAMPLE_PACK_SHA256} ${SAMPLE_PACK_URL} /tmp/sample-pack.tar
RUN mkdir -p /opt/sample-packs/pack \
	&& tar -xf /tmp/sample-pack.tar -C /opt/sample-packs/pack \
	&& rm /tmp/sample-pack.tar \
	&& chmod -R a+rX /opt/sample-packs
USER node

# Point `sfx-sample` at the baked pack (the run config only names it as
# `sample_pack = "<name>@<version>"`; the image owns where it physically lives).
ENV TCAB_SAMPLE_PACK=${SAMPLE_PACK}
ENV TCAB_SAMPLE_PACK_DIR=/opt/sample-packs/pack

# --- Bake in the instrument bank the `music` sequencer plays ----------------
#
# Identical mechanism to the dedicated `music` image (see `containers/music/Dockerfile`):
# a pinned, content-addressed instrument-bank tarball, fetched + verified at build time.
# `build.sh`'s `build_full_stack_2d` presigns it from the same pin file and supplies:
#   --build-arg INSTRUMENT_BANK=gm-lite@0.1.0
#   --build-arg INSTRUMENT_BANK_SHA256=sha256:<digest printed by build-sample-pack.mjs>
#   --build-arg INSTRUMENT_BANK_URL=<presigned R2 URL of gm-lite-0.1.0.tar>
ARG INSTRUMENT_BANK=gm-lite@0.1.0
ARG INSTRUMENT_BANK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG INSTRUMENT_BANK_URL

# Fetch + verify the pinned tarball and unpack it to the path the `audio-core` loader
# reads. Make it world-readable for the unprivileged run user.
USER root
ADD --checksum=${INSTRUMENT_BANK_SHA256} ${INSTRUMENT_BANK_URL} /tmp/instrument-bank.tar
RUN mkdir -p /opt/instrument-banks/gm-lite \
	&& tar -xf /tmp/instrument-bank.tar -C /opt/instrument-banks/gm-lite \
	&& rm /tmp/instrument-bank.tar \
	&& chmod -R a+rX /opt/instrument-banks
USER node

# Point `music` at the baked bank (the run config only names it as
# `instrument_bank = "<name>@<version>"`; the image owns where it physically lives).
ENV TCAB_INSTRUMENT_BANK=${INSTRUMENT_BANK}
ENV TCAB_INSTRUMENT_BANK_DIR=/opt/instrument-banks/gm-lite
