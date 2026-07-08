# The Blender character run-container image for The Test Cabinet.
#
# Every `blender-character` asset-generation run executes in this one image. It is the
# base run-container image plus **headless Blender** and the **`tcab-blend`** runner —
# the tool a Blender character run uses to build a skinned, rigged, animated character
# by writing a `build.py` (a `bpy` script) and exporting a standard glTF (see the
# asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/blender-binaries.md`).
#
# Unlike the voxel-family binaries, Blender is NOT compiled from this repo — it is a
# large third-party system package the unprivileged run user cannot install at run time
# (it needs root and links a GL/X stack), so it is baked in here at build time, exactly
# like the Mesa runtime the voxel images bake in. It is pinned to a Blender LTS; a run
# records the image digest, so the exact Blender version is auditable. The build context
# is the repository root so the `COPY` lines below can see `containers/blender/` — see
# `containers/build.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

FROM ${BASE_IMAGE}

# Installing OS packages and unpacking Blender needs root; switch to root for the setup
# and back to the unprivileged `node` run user the base image set.
USER root

# The Blender LTS to bake in. `BLENDER_SERIES` is the download directory (e.g. `4.2`);
# `BLENDER_VERSION` is the full point release. Bump both together to update.
ARG BLENDER_SERIES=4.2
ARG BLENDER_VERSION=4.2.3

# Blender's headless dependencies. Even with `--background` it links an X11/OpenGL stack
# and uses `xz` to unpack; `python3` backs the runner's small config read. Many of these
# overlap the Chromium libraries the base image already carries, but they are named
# explicitly so this image is correct independent of the base's set.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		xz-utils \
		python3 \
		libx11-6 \
		libxi6 \
		libxxf86vm1 \
		libxfixes3 \
		libxrender1 \
		libxkbcommon0 \
		libgl1 \
		libglu1-mesa \
		libsm6 \
	&& rm -rf /var/lib/apt/lists/*

# Download and unpack the portable Blender tarball to `/opt/blender`, then put its
# launcher on PATH. The portable build bundles its own Python, so it does not touch the
# system Python. (Pinning by digest is preferable; the plain download is kept simple for
# offline-development builds and the image digest still pins what shipped.)
RUN curl -fsSL \
		"https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
		-o /tmp/blender.tar.xz \
	&& mkdir -p /opt/blender \
	&& tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
	&& rm /tmp/blender.tar.xz \
	&& ln -s /opt/blender/blender /usr/local/bin/blender

# The bundled glTF export helper (importable from a model's `build.py` as
# `tcab_blend_export`) and the `tcab-blend` runner. Blender's bundled Python resolves the
# helper from `PYTHONPATH` because the runner passes `--python-use-system-env`.
RUN mkdir -p /opt/tcab-blend
COPY containers/blender/tcab_blend_export.py /opt/tcab-blend/tcab_blend_export.py
COPY containers/blender/tcab-blend /usr/local/bin/tcab-blend
RUN chmod +x /usr/local/bin/tcab-blend
ENV PYTHONPATH=/opt/tcab-blend

# Back to the unprivileged run user. The base image already sets `WORKDIR /work` and the
# keep-alive `CMD`, so nothing else is needed here.
USER node
