# The static Surface Nets run-container image for The Test Cabinet.
#
# Every static Surface Nets asset-generation run (a case with
# `asset_kind = "sn-model"`) executes in this one image. It is the base
# run-container image plus exactly one addition: the baked-in `sn` binary, the
# static surface-extraction meshing tool a Surface Nets run uses (a smooth,
# mid-fidelity, watertight mesher — the `SurfaceNetsMesher` from
# `crates/voxel-mesh`; see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/`). Animated Surface Nets
# runs use the separate sn-animation image, which bakes in `sn-anim` instead —
# see `containers/sn-animation/Dockerfile`.
#
# `sn` is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself: building it from the same commit as
# the rest of the toolchain keeps its meshing and preview-rendering library in
# lockstep with the codebase (a run records the commit and the image digest, so a
# mismatch is auditable). The build context is the repository root so the compile
# stage can see `crates/` — see `containers/build.sh`.
#
# This image inherits everything from the base — the toolchain, the unprivileged
# `node` run user, the `/work` working directory, and the keep-alive CMD — so it
# only adds `sn` (and the Mesa software-Vulkan runtime its previews render with).
# End-to-end runs use the base image directly; the image a run resolves is
# selected by its test type and asset kind (see crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the `FROM` for the run image below can
# consume — an `ARG` declared after a `FROM` is scoped to that stage and would be
# blank in a later `FROM`. `build.sh` passes the base image it just built (e.g.
# the local `test-cabinet-base:latest`, or a registry-qualified tag) so this image
# is always `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `sn` binary from this repository ------------------
FROM docker.io/library/rust:1.97.1-bookworm AS sn-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph; `-p test-cabinet-sn --bin sn` compiles only the
# `sn` binary and its dependencies. The glibc target matches the bookworm-based
# base image below — do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-sn --bin sn

# --- Stage 2: the base run image, plus `sn` ---------------------------------
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

# Bake in the `sn` binary compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it, never writes it. A static Surface Nets
# run invokes it as the model's meshing tool. The base image already sets
# `USER node`, `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed
# here.
COPY --from=sn-build /build/target/release/sn /usr/local/bin/sn
