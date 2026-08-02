# The UI run-container image for The Test Cabinet.
#
# Every UI asset-generation run (a case with `asset_kind = "ui"`) executes in this one
# image. It is the base run-container image plus the baked-in `paint` and `ui`
# binaries, the two tools a UI run interleaves over a shared workspace — `paint` for
# layered raster work and `ui` for crisp vector shapes, text, and nine-slice (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md`). Both are
# built from `crates/paint`. The UI tools do only 2D raster compositing, so — like the
# sprite image and unlike the voxel family — this image needs no Mesa/Vulkan runtime.
#
# The binaries are baked in rather than installed at run time because, unlike a harness
# CLI, they are part of The Test Cabinet itself and core validates the emitted
# PNGs/`ui.json` with the same library they use. Building from one commit keeps them in
# lockstep (a run records the orchestrator commit and the image digest, so a mismatch
# is auditable). The baked-in tooling is compiled by the shared builder
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

# --- The run image: the base, plus `paint` + `ui` ---------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the two binaries from the tools image. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes them. The base image already sets `USER
# node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed
# here.
COPY --from=tools /out/paint /usr/local/bin/paint
COPY --from=tools /out/ui /usr/local/bin/ui
