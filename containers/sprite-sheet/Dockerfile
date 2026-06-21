# The sprite-sheet run-container image for The Test Cabinet.
#
# Every sprite-sheet asset-generation run (a case with
# `asset_kind = "sprite-sheet"`) executes in this one image. It is the base
# run-container image plus exactly one addition: the baked-in `draw-sheet` binary,
# the drawing tool a sprite-sheet run uses (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/`). Single-sprite runs use
# the separate sprite image, which bakes in `draw` instead — see
# `containers/sprite/Dockerfile`.
#
# `draw-sheet` is baked in rather than installed at run time because, unlike a
# harness CLI, it is part of The Test Cabinet itself and its drawing logic must
# match the orchestrator's: the orchestrator regenerates an asset-gen run's scored
# image with the *same* library this binary uses. Building both from one commit
# keeps them in lockstep (a run records the orchestrator commit and the image
# digest, so a mismatch is auditable). The build context is the repository root so
# the compile stage can see `crates/` — see `containers/build.sh`.
#
# This image inherits everything from the base — the toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it
# only adds `draw-sheet`. End-to-end runs use the base image directly; the image a
# run resolves is selected by its test type and asset kind (see crate
# `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the `FROM` for the run image below can
# consume — an `ARG` declared after a `FROM` is scoped to that stage and would be
# blank in a later `FROM`. `build.sh` passes the base image it just built (e.g.
# the local `test-cabinet-base:latest`, or a registry-qualified tag) so this image
# is always `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `draw-sheet` binary from this repository ----------
FROM docker.io/library/rust:1-bookworm AS draw-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph; `-p test-cabinet-draw --bin draw-sheet` compiles
# only the `draw-sheet` binary and its dependencies. The glibc target matches the
# bookworm-based base image below — do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-draw --bin draw-sheet

# --- Stage 2: the base run image, plus `draw-sheet` -------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `draw-sheet` binary compiled in stage 1. `/usr/local/bin` is on PATH
# and root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it, never writes it. A sprite-sheet run
# invokes it as the model's drawing tool. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed here.
COPY --from=draw-build /build/target/release/draw-sheet /usr/local/bin/draw-sheet
