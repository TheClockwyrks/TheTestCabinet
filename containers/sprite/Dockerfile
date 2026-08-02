# The single-sprite run-container image for The Test Cabinet.
#
# Every single-sprite asset-generation run (a case with `asset_kind = "sprite"`)
# executes in this one image. It is the base run-container image plus exactly one
# addition: the baked-in `draw` binary, the drawing tool a single-sprite run uses
# (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/`). Sprite-sheet runs use
# the separate sprite-sheet image, which bakes in `draw-sheet` instead — see
# `containers/sprite-sheet/Dockerfile`.
#
# `draw` is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and its drawing logic must match the
# orchestrator's: the orchestrator regenerates an asset-gen run's scored image
# with the *same* library this binary uses. Building both from one commit keeps
# them in lockstep (a run records the orchestrator commit and the image digest, so
# a mismatch is auditable). It is compiled by the shared tooling
# builder (`containers/tools/Dockerfile`) — see `containers/build.sh`.
#
# This image inherits everything from the base — the toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it
# only adds `draw`. End-to-end runs use the base image directly; the image a run
# resolves is selected by its test type and asset kind (see crate
# `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the `FROM` for the run image below can
# consume — an `ARG` declared after a `FROM` is scoped to that stage and would be
# blank in a later `FROM`. `build.sh` passes the base image it just built (e.g.
# the local `test-cabinet-base:latest`, or a registry-qualified tag) so this image
# is always `FROM` the matching base.
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

# --- The run image: the base, plus `draw` -----------------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `draw` binary from the tools image. `/usr/local/bin` is on PATH
# and root-owned (COPY writes as root regardless of the inherited `USER node`);
# the unprivileged run user only executes it, never writes it. A single-sprite
# run invokes it as the model's drawing tool. The base image already sets `USER
# node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed
# here.
COPY --from=tools /out/draw /usr/local/bin/draw
