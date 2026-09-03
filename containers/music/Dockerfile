# The music run-container image for The Test Cabinet.
#
# Every music run (a case with `asset_kind = "music"`) executes in this one image. It is
# the base run-container image plus the baked-in `music` binary and nothing else: the
# instrument bank the sequencer plays is NOT in this image. A run is staged with the
# one bank its case names in `[audio] packs`, written into the started container at
# `/opt/audio` (the empty, run-user-owned root the base image creates), so this image
# is the same whatever a case declares and publishing a bank version needs no rebuild
# of it. See the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md` and the
# sample-library section of `containers/README.md`. The audio tools render on the CPU,
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

# --- The run image: the base, plus the `music` binary -----------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `music` binary from the tools image. `/usr/local/bin` is on PATH
# and root-owned (COPY writes as root regardless of the inherited `USER node`);
# the unprivileged run user only executes it. The base image already sets `USER
# node`, `WORKDIR /work`, and the keep-alive CMD.
COPY --from=tools /out/music /usr/local/bin/music

