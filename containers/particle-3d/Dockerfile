# The 3D particle run-container image for The Test Cabinet.
#
# Every 3D particle-effect run (a case with `asset_kind = "particle-3d"`) executes in
# this one image. It is the base run-container image plus the baked-in `particle-3d`
# binary, the tool a 3D particle run authors its emitter system with (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`), built
# from `crates/particle-3d` in the `tool-particle` repository. Its preview `render`
# billboards each live particle through `wgpu` from an orbit camera, so this image
# ships the Mesa software-Vulkan runtime, like the rest of the voxel family and unlike
# the pure-2D `particle-2d` image; the tool-particle image carries the binaries alone,
# so the runtime is installed here.
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

# --- The run image: the base, plus Mesa + `particle-3d` ---------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# The preview renderer draws through `wgpu` targeting Mesa's software Vulkan (lavapipe)
# — there is no GPU in the run container, so the image must ship the Mesa Vulkan ICD
# (`mesa-vulkan-drivers`) and the Vulkan loader (`libvulkan1`). Installing OS packages
# needs root, so switch to root for the apt-get and switch back to the unprivileged
# `node` run user the base image set.
USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libvulkan1 \
		mesa-vulkan-drivers \
	&& rm -rf /var/lib/apt/lists/*
USER node

# Force `wgpu` onto the lavapipe (software CPU) Vulkan device deterministically
# in-container by manifest-name glob (arch-agnostic: `lvp_icd.<arch>.json`), and give
# the loader a writable runtime dir. See the voxel-animation image for the rationale.
ENV VK_LOADER_DRIVERS_SELECT=lvp*
ENV XDG_RUNTIME_DIR=/tmp

# Bake in the `particle-3d` binary from the tool-particle image, which carries it
# in `/usr/local/bin`. That directory is on PATH and root-owned (COPY writes as root
# regardless of the inherited `USER node`); the unprivileged run user only executes
# it. The base image already sets `USER node`, `WORKDIR /work`, and the keep-alive
# CMD, so nothing else is needed here.
COPY --from=tool-particle /usr/local/bin/particle-3d /usr/local/bin/particle-3d
