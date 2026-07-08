# The Blender character run-container image for The Test Cabinet.
#
# Every `blender-character` asset-generation run executes in this one image: headless
# Blender plus the `tcab-blend` runner — the tool a Blender character run uses to build a
# skinned, rigged, animated character by writing a `build.py` (a `bpy` script) and
# exporting a standard glTF (see the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/blender-binaries.md`).
#
# UNLIKE EVERY OTHER RUN IMAGE, this one is NOT built `FROM` the shared base image. The
# reason is Blender itself. Blender ships **official Linux desktop builds for x86-64 only**
# — `download.blender.org` has no `linux-arm64` tarball, and neither conda-forge nor the
# PyPI `bpy` wheels cover linux-aarch64 — so on the arm64 hosts this project runs on there
# is no upstream Blender to bake in. The only modern, arch-parity Blender that installs
# cleanly on aarch64 is the **distro package**, and the shared base is Debian bookworm,
# whose `blender` is stuck at 3.4.x. **Ubuntu 26.04 LTS ships Blender 5.0.x for BOTH amd64
# and arm64 via `apt`**, so this image is built directly on `ubuntu:26.04` and installs
# Blender from `apt` — one code path, the same version on both arches, no upstream-tarball
# fetch. The run records the image digest, so the exact Blender version that shipped is
# auditable per run.
#
# Because it does not inherit the shared base, this image RE-CREATES the small slice of the
# run contract a `blender-character` run actually needs — the unprivileged `node` user, a
# Node.js toolchain for the harness's run-time install, git/curl, and the `/work` working
# directory (see the sections below). It deliberately omits what only end-to-end and the
# other asset kinds need (the Chromium link libraries, the shippable `/opt/tcab-packages`
# tree): a Blender run neither drives a browser nor consumes a produced-asset runtime.
#
# The build context is the repository root so the `COPY` lines below can see
# `containers/blender/`, and `build.sh` builds it with a dedicated builder (not the
# `FROM`-base one) — see `containers/build.sh`.

FROM docker.io/library/ubuntu:26.04

# All setup is done as root; the final `USER node` below drops to the run user.
USER root
ENV DEBIAN_FRONTEND=noninteractive

# Blender + the base run tooling. On Ubuntu 26.04 the `blender` package is 5.0.x on both
# amd64 and arm64, so a single `apt-get install` gives arch parity with no upstream fetch.
# `python3-numpy` is REQUIRED, not optional: Ubuntu builds Blender against the SYSTEM
# Python (3.14 here) and does not bundle numpy, but the glTF I/O add-on `tcab-blend` drives
# imports numpy — without it the export raises `ModuleNotFoundError: numpy` and the run
# emits nothing. `git` (each run is a fresh repository), `curl`/`ca-certificates`/`unzip`
# (the curl-piped harness installers), `python3` (a test/init step may shell out to it),
# and `xz-utils` (unpacking the Node tarball below) round out the tooling the shared base
# would otherwise have provided. A `blender --background --version` smoke test fails the
# build early if Blender cannot even launch on this arch, rather than shipping an image
# that only fails at run time.
# `libegl1` + `libgl1` give the preview render a headless GL context. Blender 5.0 renders
# even the CPU Workbench engine through an EGL/OpenGL context, and the `blender` package
# pulls the Mesa software rasterizer (`libgl1-mesa-dri`, llvmpipe) and the X libs but NOT
# libEGL/libGL themselves; without these two the export still writes `character.glb` but
# the preview `model.png` render fails with `libEGL.so.1: cannot open shared object file`.
# This is the Blender analogue of the Mesa/lavapipe software runtime the voxel images bake
# in for their headless previews.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		blender \
		python3-numpy \
		libegl1 \
		libgl1 \
		ca-certificates \
		curl \
		git \
		python3 \
		unzip \
		xz-utils \
	&& rm -rf /var/lib/apt/lists/* \
	&& blender --background --version

# Node.js, installed from the official dist tarball (arch-aware) rather than `apt`, which
# on Ubuntu 26.04 carries Node 22 with an ancient bundled npm (9.x). A run installs its
# selected harness's CLI at run time and most harnesses do so with `npm install -g`, so
# this matches the shared base's Node 24 and its modern npm. Pinned by version; the arch is
# resolved from `dpkg --print-architecture` to the Node dist naming (amd64→x64, arm64→arm64).
ARG NODE_VERSION=24.18.0
RUN set -eux; \
	arch="$(dpkg --print-architecture)"; \
	case "$arch" in \
		amd64) node_arch=x64 ;; \
		arm64) node_arch=arm64 ;; \
		*) echo "unsupported architecture for the Blender image: $arch" >&2; exit 1 ;; \
	esac; \
	curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
		-o /tmp/node.tar.xz; \
	tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
	rm /tmp/node.tar.xz; \
	node --version; \
	npm --version

# Recreate the run user the shared base normally provides: an unprivileged `node` user and
# group at uid/gid 1000. The runner runs the harness as `node` and `chown node:node /work`
# (see `crates/core/src/container.rs`), so the name and uid must match. Ubuntu ships a
# default `ubuntu` account on uid 1000, so remove it first to free the id. User-writable
# npm-global and `~/.local/bin` install locations let a harness's run-time `npm install -g`
# or curl installer land a CLI on PATH without root — exactly as the base sets up.
RUN userdel --remove ubuntu 2>/dev/null || true; \
	groupadd --gid 1000 node; \
	useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash node; \
	mkdir -p /home/node/.npm-global /home/node/.local/bin /work; \
	chown -R node:node /home/node /work
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global \
	PATH=/home/node/.npm-global/bin:/home/node/.local/bin:/usr/local/bin:$PATH

# The bundled glTF export helper (importable from a model's `build.py` as
# `tcab_blend_export`) and the `tcab-blend` runner. Blender's bundled Python resolves the
# helper from `PYTHONPATH` because the runner passes `--python-use-system-env`.
RUN mkdir -p /opt/tcab-blend
COPY containers/blender/tcab_blend_export.py /opt/tcab-blend/tcab_blend_export.py
COPY containers/blender/tcab-blend /usr/local/bin/tcab-blend
RUN chmod +x /usr/local/bin/tcab-blend
ENV PYTHONPATH=/opt/tcab-blend

# Drop to the unprivileged run user, set the working directory the seeded repository is
# copied into, and keep the container alive until the testing harness stops it — the run
# contract the shared base would otherwise define.
USER node
WORKDIR /work
CMD ["sleep", "infinity"]
