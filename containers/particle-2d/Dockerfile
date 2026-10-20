# The 2D particle run-container image for The Test Cabinet.
#
# Every 2D particle-effect run (a case with `asset_kind = "particle-2d"`) executes in
# this one image. It is the base run-container image plus the baked-in `particle-2d`
# binary, the tool a 2D particle run authors its emitter system with (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`), built
# from `crates/particle-2d` in the `tool-particle` repository. The 2D binary composites
# its preview in a 2D raster path, so — like the sprite image and unlike the 3D
# `particle-3d` image — it needs no Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted
# `system.json` with the same library it uses. This image copies it out of
# `tool-particle:<commit>`, the image tool-particle's pipeline publishes, at the commit
# the driver pins, which is the superrepo's `tool-particle` gitlink, so the binary and
# what validates its output stay in lockstep (a run records the orchestrator commit and
# the image digest, so a mismatch is auditable). See `containers/build.sh` and
# `scripts/ci/tool-images.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# `TOOL_PARTICLE_IMAGE` is the `tool-particle` image the binary is copied out of:
# `testcabinet.azurecr.io/tool-particle:<commit>` at the commit the driver pins, or,
# for a local build without PUSH, the image `build.sh` has just built from the
# `tool-particle/` checkout (`scripts/ci/tool-images.sh` names the reference).
# Declared BEFORE the first `FROM` for the same reason `BASE_IMAGE` is: an `ARG`
# after a `FROM` is scoped to that stage.
ARG TOOL_PARTICLE_IMAGE=test-cabinet-tool-particle:latest

# Resolve the tool image to a named stage. `COPY --from=` cannot interpolate a
# build arg directly ("variable expansion is not supported for --from"), so it
# has to arrive through a `FROM`; the `COPY --from=tool-particle` line below then
# names this stage.
FROM ${TOOL_PARTICLE_IMAGE} AS tool-particle

# --- The run image: the base, plus `particle-2d` ----------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `particle-2d` binary from the tool-particle image, which carries it
# in `/usr/local/bin`. That directory is on PATH and root-owned (COPY writes as root
# regardless of the inherited `USER node`); the unprivileged run user only executes
# it. The base image already sets `USER node`, `WORKDIR /work`, and the keep-alive
# CMD, so nothing else is needed here.
COPY --from=tool-particle /usr/local/bin/particle-2d /usr/local/bin/particle-2d
