# The UI run-container image for The Test Cabinet.
#
# Every UI asset-generation run (a case with `asset_kind = "ui"`) executes in this one
# image. It is the base run-container image plus the baked-in `paint` and `ui`
# binaries, the two tools a UI run interleaves over a shared workspace — `paint` for
# layered raster work and `ui` for crisp vector shapes, text, and nine-slice (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md`). Both are
# built from `crates/paint` in the `tool-paint` repository. The UI tools do only 2D
# raster compositing, so — like the sprite image and unlike the voxel family — this
# image needs no Mesa/Vulkan runtime.
#
# The binaries are baked in rather than installed at run time because, unlike a harness
# CLI, they are part of The Test Cabinet itself and core validates the emitted
# PNGs/`ui.json` with the same library they use. This image copies them out of
# `tool-paint:<commit>`, the image tool-paint's pipeline publishes, at the commit the
# driver pins, which is the superrepo's `tool-paint` gitlink, so the binaries and what
# validates their output stay in lockstep (a run records the orchestrator commit and
# the image digest, so a mismatch is auditable). See `containers/build.sh` and
# `scripts/ci/tool-images.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# `TOOL_PAINT_IMAGE` is the `tool-paint` image the binaries are copied out of:
# `testcabinet.azurecr.io/tool-paint:<commit>` at the commit the driver pins, or,
# for a local build without PUSH, the image `build.sh` has just built from the
# `tool-paint/` checkout (`scripts/ci/tool-images.sh` names the reference).
# Declared BEFORE the first `FROM` for the same reason `BASE_IMAGE` is: an `ARG`
# after a `FROM` is scoped to that stage.
ARG TOOL_PAINT_IMAGE=test-cabinet-tool-paint:latest

# Resolve the tool image to a named stage. `COPY --from=` cannot interpolate a
# build arg directly ("variable expansion is not supported for --from"), so it
# has to arrive through a `FROM`; the `COPY --from=tool-paint` lines below then
# name this stage.
FROM ${TOOL_PAINT_IMAGE} AS tool-paint

# --- The run image: the base, plus `paint` + `ui` ---------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the two binaries from the tool-paint image, which carries them in
# `/usr/local/bin`. That directory is on PATH and root-owned (COPY writes as root
# regardless of the inherited `USER node`); the unprivileged run user only
# executes them. The base image already sets `USER node`, `WORKDIR /work`, and
# the keep-alive CMD, so nothing else is needed here.
COPY --from=tool-paint /usr/local/bin/paint /usr/local/bin/paint
COPY --from=tool-paint /usr/local/bin/ui /usr/local/bin/ui
