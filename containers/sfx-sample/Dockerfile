# The sample-library sound-effect run-container image for The Test Cabinet.
#
# Every sample-library sound-effect run (a case with `asset_kind = "sfx-sample"`)
# executes in this one image. It is the base run-container image plus the baked-in
# `sfx-sample` binary AND a baked-in sample pack — the fixed palette of library clips
# the tool mixes over (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md` and the
# sample-library section of `containers/README.md`). The audio tools render on the CPU,
# so — like the sprite image and unlike the voxel family — this image needs no
# Mesa/Vulkan runtime.
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

# --- Stage 1: compile the `sfx-sample` binary from this repository ----------
FROM docker.io/library/rust:1-bookworm AS audio-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph; `-p test-cabinet-sfx-sample --bin sfx-sample` compiles only this
# binary and its dependencies. The glibc target matches the bookworm-based base image
# below — do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-sfx-sample --bin sfx-sample

# --- Stage 2: the base run image, plus `sfx-sample` + the sample pack -------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `sfx-sample` binary compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD.
COPY --from=audio-build /build/target/release/sfx-sample /usr/local/bin/sfx-sample

# --- Bake in the sample pack the `sfx-sample` tool mixes over ---------------
#
# The sample pack is a separately-versioned, content-addressed artifact (an
# object-storage tarball) assembled by `scripts/build-sample-pack.mjs` from a manifest
# under `containers/sample-packs/` (the audio files are NOT committed to this repo). The
# build PINS a pack BY DIGEST: `build-sample-pack.mjs` prints the tarball's `sha256:…`,
# which is passed as `SAMPLE_PACK_SHA256` and enforced by `ADD --checksum` below, so the
# baked palette is immutable and versioned with the image — a run container is offline,
# so nothing is fetched at RUN time; this fetch happens at BUILD time and is pinned.
#
# Supply all three build args from the `build-sample-pack.mjs` run that produced the
# pack (see `containers/sample-packs/README.md`); the defaults are placeholders that
# fail the build until a real pack is pinned:
#   --build-arg SAMPLE_PACK=sfx-core@0.1.0
#   --build-arg SAMPLE_PACK_SHA256=sha256:<digest printed by build-sample-pack.mjs>
#   --build-arg SAMPLE_PACK_URL=<object-storage URL of sfx-core-0.1.0.tar>
ARG SAMPLE_PACK=sfx-core@0.1.0
ARG SAMPLE_PACK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG SAMPLE_PACK_URL

# Fetch the pinned tarball (BuildKit verifies it against SAMPLE_PACK_SHA256 — a mismatch
# or a missing URL fails the build) and unpack it to the path the `audio-core` loader
# reads (`load_pack` in `crates/audio-core/src/sample.rs`: a `*.toml` manifest plus the
# `<name>.wav` audio beside it). The pack tar's root holds `pack.toml` + the `.wav`
# files, so strip its leading `.` component into the target dir. Make it world-readable
# for the unprivileged run user.
USER root
ADD --checksum=${SAMPLE_PACK_SHA256} ${SAMPLE_PACK_URL} /tmp/sample-pack.tar
RUN mkdir -p /opt/sample-packs/sfx-core \
	&& tar -xf /tmp/sample-pack.tar -C /opt/sample-packs/sfx-core \
	&& rm /tmp/sample-pack.tar \
	&& chmod -R a+rX /opt/sample-packs
USER node

# Point the `sfx-sample` binary at the baked pack. `audio-core`'s config carries a
# `pack_dir` the loader reads; this env var is the baked-image source of that path (the
# run config only names the pack as `sample_pack = "<name>@<version>"`). Kept here so
# the image, not a run's seeded config, owns where the palette physically lives.
ENV TCAB_SAMPLE_PACK=${SAMPLE_PACK}
ENV TCAB_SAMPLE_PACK_DIR=/opt/sample-packs/sfx-core
