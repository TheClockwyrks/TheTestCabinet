# The static voxel-model run-container image for The Test Cabinet.
#
# Every static voxel-model asset-generation run (a case with `asset_kind =
# "voxel-model"`) executes in this one image. It is the base run-container image
# plus exactly one addition: the baked-in `voxel` binary, the 3D voxel-modeling
# tool a static voxel run uses (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/`). Animated voxel runs use
# the separate voxel-animation image, which bakes in `voxel-anim` instead — see
# `containers/voxel-animation/Dockerfile`.
#
# `voxel` is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and its modeling logic must match the
# orchestrator's: the orchestrator regenerates an asset-gen run's scored voxel
# data and preview with the *same* library this binary uses. Building both from
# one commit keeps them in lockstep (a run records the orchestrator commit and the
# image digest, so a mismatch is auditable). The baked-in tooling is compiled by
# the shared builder (`containers/tools/Dockerfile`) — see `containers/build.sh`.
#
# This image inherits everything from the base — the toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it
# only adds `voxel`. End-to-end runs use the base image directly; the image a run
# resolves is selected by its test type, asset kind, and asset dimension (see
# crate `harness::resolve_run_image`).

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

# --- The run image: the base, plus `voxel` ----------------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# The preview renderer draws through `wgpu` targeting Mesa's software Vulkan
# (lavapipe) — there is no GPU in the run container, so the image must ship the
# Mesa Vulkan ICD (`mesa-vulkan-drivers`, which provides lavapipe) and the Vulkan
# loader (`libvulkan1`) the binary links against at run time. Installing OS
# packages needs root, so switch to root for the apt-get and switch back to the
# unprivileged `node` run user the base image set, leaving the run user unchanged.
USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libvulkan1 \
		mesa-vulkan-drivers \
	&& rm -rf /var/lib/apt/lists/*
USER node

# Force `wgpu` onto the lavapipe (software CPU) Vulkan device deterministically
# in-container: no GPU or display is present, and the base+Mesa install ships
# an ICD for every driver, so restrict the loader to the lavapipe driver by
# manifest-name glob. This is arch-agnostic (the manifest is `lvp_icd.<arch>.json`,
# e.g. `lvp_icd.x86_64.json` or `lvp_icd.aarch64.json`), unlike pinning an
# absolute VK_ICD_FILENAMES path, so it selects lavapipe on both x86_64 and arm64
# (this project's local dev and prod are arm64). XDG_RUNTIME_DIR gives the loader
# a writable runtime dir so it does not warn on every render.
ENV VK_LOADER_DRIVERS_SELECT=lvp*
ENV XDG_RUNTIME_DIR=/tmp

# Bake in the `voxel` binary from the tools image. `/usr/local/bin` is on PATH
# and root-owned (COPY writes as root regardless of the inherited `USER node`);
# the unprivileged run user only executes it, never writes it. A static voxel
# run invokes it as the model's modeling tool. The base image already sets `USER
# node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed
# here.
COPY --from=tools /out/voxel /usr/local/bin/voxel
