# The UI run-container image for The Test Cabinet.
#
# Every UI asset-generation run (a case with `asset_kind = "ui"`) executes in this
# one image. It is the base run-container image plus the baked-in `paint` and `ui`
# binaries, the two tools a UI run interleaves over a shared workspace — `paint` for
# layered raster work and `ui` for crisp vector shapes, text, and nine-slice (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md`). Both are
# built from `crates/paint`. The UI tools do only 2D raster compositing, so — like the
# sprite image and unlike the voxel family — this image needs no Mesa/Vulkan runtime.
#
# The binaries are baked in rather than installed at run time because, unlike a
# harness CLI, they are part of The Test Cabinet itself and core validates the emitted
# PNGs/`ui.json` with the same library they use. Building from one commit keeps them in
# lockstep (a run records the orchestrator commit and the image digest, so a mismatch
# is auditable). The build context is the repository root so the compile stage can see
# `crates/` — see `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `paint` and `ui` binaries from this repository ----
FROM docker.io/library/rust:1-bookworm AS paint-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph; `-p test-cabinet-paint --bin paint --bin ui` compiles only these
# two binaries and their dependencies. The glibc target matches the bookworm-based base
# image below — do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-paint --bin paint --bin ui

# --- Stage 2: the base run image, plus `paint` + `ui` -----------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the two binaries compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes them. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed here.
COPY --from=paint-build /build/target/release/paint /usr/local/bin/paint
COPY --from=paint-build /build/target/release/ui /usr/local/bin/ui
