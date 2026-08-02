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

# --- The run image: the base, plus `sfx-sample` + the sample pack -----------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `sfx-sample` binary from the tools image. `/usr/local/bin` is on
# PATH and root-owned (COPY writes as root regardless of the inherited `USER
# node`); the unprivileged run user only executes it. The base image already
# sets `USER node`, `WORKDIR /work`, and the keep-alive CMD.
COPY --from=tools /out/sfx-sample /usr/local/bin/sfx-sample

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
# pack (see `containers/sample-packs/README.md`). `SAMPLE_PACK` names the committed
# manifest's real combat palette; the SHA256/URL are the digest+location of the tarball
# that run produced (they default to placeholders that fail the build until pinned,
# since the normalized tarball's digest depends on the building ffmpeg):
#   --build-arg SAMPLE_PACK=combat-core@0.1.0
#   --build-arg SAMPLE_PACK_SHA256=sha256:<digest printed by build-sample-pack.mjs>
#   --build-arg SAMPLE_PACK_URL=<object-storage URL of combat-core-0.1.0.tar>
ARG SAMPLE_PACK=combat-core@0.1.0
ARG SAMPLE_PACK_SHA256=sha256:0000000000000000000000000000000000000000000000000000000000000000
ARG SAMPLE_PACK_URL

# Fetch the pinned tarball (BuildKit verifies it against SAMPLE_PACK_SHA256 — a mismatch
# or a missing URL fails the build) and unpack it to the path the `audio-core` loader
# reads (`load_pack` in `crates/audio-core/src/sample.rs`: a `*.toml` manifest plus the
# `<name>.wav` audio beside it). The pack tar's root holds `pack.toml` + the `.wav`
# files, so strip its leading `.` component into the target dir. The dir name is
# pack-agnostic (the loader is pointed at it by env below), so a new pack version needs
# no path change here. Make it world-readable for the unprivileged run user.
USER root
ADD --checksum=${SAMPLE_PACK_SHA256} ${SAMPLE_PACK_URL} /tmp/sample-pack.tar
RUN mkdir -p /opt/sample-packs/pack \
	&& tar -xf /tmp/sample-pack.tar -C /opt/sample-packs/pack \
	&& rm /tmp/sample-pack.tar \
	&& chmod -R a+rX /opt/sample-packs
USER node

# Point the `sfx-sample` binary at the baked pack. `audio-core`'s config carries a
# `pack_dir` the loader reads; this env var is the baked-image source of that path (the
# run config only names the pack as `sample_pack = "<name>@<version>"`). Kept here so
# the image, not a run's seeded config, owns where the palette physically lives.
ENV TCAB_SAMPLE_PACK=${SAMPLE_PACK}
ENV TCAB_SAMPLE_PACK_DIR=/opt/sample-packs/pack
