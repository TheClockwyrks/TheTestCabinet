# The sprite-sheet run-container image for The Test Cabinet.
#
# Every sprite-sheet asset-generation run (a case with `asset_kind =
# "sprite-sheet"`) executes in this one image. It is the base run-container image
# plus exactly one addition: the baked-in `draw-sheet` binary, the drawing tool a
# sprite-sheet run uses (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/`). Single-sprite runs use
# the separate sprite image, which bakes in `draw` instead — see
# `containers/sprite/Dockerfile`.
#
# `draw-sheet` is baked in rather than installed at run time because, unlike a
# harness CLI, it is part of The Test Cabinet itself and its drawing logic must
# match the orchestrator's: the orchestrator regenerates an asset-gen run's scored
# image with the *same* library this binary uses. Both come from the `tool-sprite`
# repository (its `crates/draw`) at the one commit the driver pins, which is the
# superrepo's `tool-sprite` gitlink: the driver links the crate at that commit and
# this image copies the binary out of `tool-sprite:<that commit>`, the image
# tool-sprite's pipeline publishes, so the two stay in lockstep (a run records the
# orchestrator commit and the image digest, so a mismatch is auditable). See
# `containers/build.sh` and `scripts/ci/tool-images.sh`.
#
# This image inherits everything from the base — the toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it
# only adds `draw-sheet`. End-to-end runs use the base image directly; the image a
# run resolves is selected by its test type, asset kind, and asset dimension (see
# crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the `FROM` for the run image below can
# consume — an `ARG` declared after a `FROM` is scoped to that stage and would be
# blank in a later `FROM`. `build.sh` passes the base image it just built (e.g.
# the local `test-cabinet-base:latest`, or a registry-qualified tag) so this image
# is always `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

# `TOOL_SPRITE_IMAGE` is the `tool-sprite` image the binary is copied out of:
# `testcabinet.azurecr.io/tool-sprite:<commit>` at the commit the driver pins, or,
# for a local build without PUSH, the image `build.sh` has just built from the
# `tool-sprite/` checkout (`scripts/ci/tool-images.sh` names the reference).
# Declared BEFORE the first `FROM` for the same reason `BASE_IMAGE` is: an `ARG`
# after a `FROM` is scoped to that stage.
ARG TOOL_SPRITE_IMAGE=test-cabinet-tool-sprite:latest

# Resolve the tool image to a named stage. `COPY --from=` cannot interpolate a
# build arg directly ("variable expansion is not supported for --from"), so it
# has to arrive through a `FROM`; the `COPY --from=tool-sprite` line below then
# names this stage.
FROM ${TOOL_SPRITE_IMAGE} AS tool-sprite

# --- The run image: the base, plus `draw-sheet` -----------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `draw-sheet` binary from the tool-sprite image, which carries it at
# `/usr/local/bin/draw-sheet`. `/usr/local/bin` is on
# PATH and root-owned (COPY writes as root regardless of the inherited `USER
# node`); the unprivileged run user only executes it, never writes it. A
# sprite-sheet run invokes it as the model's drawing tool. The base image
# already sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing
# else is needed here.
COPY --from=tool-sprite /usr/local/bin/draw-sheet /usr/local/bin/draw-sheet
