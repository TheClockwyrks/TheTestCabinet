# The 3D particle run-container image for The Test Cabinet.
#
# Every 3D particle-effect run (a case with `asset_kind = "particle-3d"`) executes in
# this one image. It is the base run-container image plus the baked-in `particle-3d`
# binary, the tool a 3D particle run authors its emitter system with (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`). Its
# preview `render` billboards each live particle through `wgpu` from an orbit camera,
# so this image ships the Mesa software-Vulkan runtime, like the rest of the voxel
# family and unlike the pure-2D `particle-2d` image.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted
# `system.json` with the same library it uses. Building from one commit keeps them in
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

# Bake in the `particle-3d` binary from the tools image. `/usr/local/bin` is on
# PATH and root-owned (COPY writes as root regardless of the inherited `USER
# node`); the unprivileged run user only executes it. The base image already
# sets `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is
# needed here.
COPY --from=tools /out/particle-3d /usr/local/bin/particle-3d
