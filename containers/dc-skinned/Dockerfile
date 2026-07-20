# The Dual Contouring skinned-character run-container image for The Test Cabinet.
#
# Every Dual Contouring skinned run (a case with `asset_kind = "dc-skinned"`) executes
# in this one image. It is the base run-container image plus the baked-in `dc-skin`
# binary, the tool a skinned run uses to sculpt one continuous body field, bind it to a
# model-invented skeleton, and animate it as a deforming skin (see the asset-generation
# docs under
# `apps/docs/src/content/docs/testing/asset-generation/skinned-binaries.md`). Its
# preview `render` draws the skinned mesh through `wgpu`, so this image ships the Mesa
# software-Vulkan runtime, like the rest of the voxel family. The Marching Cubes /
# Surface Nets siblings are the `mc-skinned` / `sn-skinned` images.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted
# `mesh.glb`/`rig.json` with the same library it uses. Building from one commit keeps
# them in lockstep (a run records the orchestrator commit and the image digest, so a
# mismatch is auditable). The build context is the repository root so the compile stage
# can see `crates/` — see `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the `dc-skin` binary from this repository -------------
FROM docker.io/library/rust:1.97.1-bookworm AS skin-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can resolve
# the workspace graph; `-p test-cabinet-dc-skin --bin dc-skin` compiles only this binary
# and its dependencies. The glibc target matches the bookworm-based base image below —
# do not statically link musl here.
COPY . .
RUN cargo build --release -p test-cabinet-dc-skin --bin dc-skin

# --- Stage 2: the base run image, plus Mesa + `dc-skin` ---------------------
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

# Bake in the `dc-skin` binary compiled in stage 1. `/usr/local/bin` is on PATH and
# root-owned (COPY writes as root regardless of the inherited `USER node`); the
# unprivileged run user only executes it. The base image already sets `USER node`,
# `WORKDIR /work`, and the keep-alive CMD, so nothing else is needed here.
COPY --from=skin-build /build/target/release/dc-skin /usr/local/bin/dc-skin
