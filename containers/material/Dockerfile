# The PBR-material run-container image for The Test Cabinet.
#
# Every material asset-generation run (a case with `asset_kind = "material"`) executes
# in this one image. It is the base run-container image plus the baked-in `texture` and
# `pbr` binaries, the two tools a material run uses to build a tileable PBR material —
# `texture` for seamless map painting and `pbr` for baking normal/AO maps, setting
# uniforms, assembling `material.json`, and rendering the lit 3D preview (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/material-binaries.md`). Both are
# built from `crates/paint` in the `tool-paint` repository. Because `pbr` renders a lit
# 3D preview of the material on a test surface through `wgpu`, this image ships the Mesa
# software-Vulkan runtime, like the voxel family and unlike the pure-2D `ui` image; the
# tool-paint image carries the binaries alone, so the runtime is installed here.
#
# The binaries are baked in rather than installed at run time because, unlike a harness
# CLI, they are part of The Test Cabinet itself and core validates the emitted
# maps/`material.json` with the same library they use. This image copies them out of
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

# --- The run image: the base, plus Mesa + `texture` + `pbr` -----------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# The `pbr` preview renderer draws through `wgpu` targeting Mesa's software Vulkan
# (lavapipe) — there is no GPU in the run container, so the image must ship the Mesa
# Vulkan ICD (`mesa-vulkan-drivers`, which provides lavapipe) and the Vulkan loader
# (`libvulkan1`) the binary links against at run time. Installing OS packages needs
# root, so switch to root for the apt-get and switch back to the unprivileged `node`
# run user the base image set, leaving the run user unchanged.
USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libvulkan1 \
		mesa-vulkan-drivers \
	&& rm -rf /var/lib/apt/lists/*
USER node

# Force `wgpu` onto the lavapipe (software CPU) Vulkan device deterministically
# in-container by manifest-name glob (arch-agnostic: `lvp_icd.<arch>.json`), and give
# the loader a writable runtime dir so it does not warn on every render. See the
# voxel-animation image for the full rationale.
ENV VK_LOADER_DRIVERS_SELECT=lvp*
ENV XDG_RUNTIME_DIR=/tmp

# Bake in the two binaries from the tool-paint image, which carries them in
# `/usr/local/bin`. That directory is on PATH and root-owned (COPY writes as root
# regardless of the inherited `USER node`); the unprivileged run user only
# executes them. The base image already sets `USER node`, `WORKDIR /work`, and
# the keep-alive CMD, so nothing else is needed here.
COPY --from=tool-paint /usr/local/bin/texture /usr/local/bin/texture
COPY --from=tool-paint /usr/local/bin/pbr /usr/local/bin/pbr
