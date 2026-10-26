#!/usr/bin/env bash
# Installs the apt packages this project's own builds and tools need beyond the
# ones the toolchain image ubuntu.dockerfile builds on carries. Run as root, as
# a step of that Dockerfile.
set -euo pipefail

apt-get update -y

# The C side of a static Rust build against this architecture's musl target,
# which languages/rust/targets.sh adds.
#   - musl-tools: musl-gcc, the linker such a build links with and the C
#     compiler a crate that compiles C of its own calls. It targets this
#     machine's architecture alone, so each architecture's static binary is
#     built on a machine of that architecture.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	musl-tools

# What this project's own builds and tools reach for beyond the template's
# list. Each is declared here because it was once present by accident, and a
# tool that arrives with the base image disappears silently on a base bump.
#   - ruby: gg's Ruby arm reflects its signature catalogue with YARD, and gg's
#     crates/gg/build.rs reflects all eleven catalogues as a step of building
#     the crate, so without an interpreter the gg/ checkout does not build.
#     It is the one gg toolchain that is a distribution package rather than a
#     pinned download: gg's scripts/ci/install-gg-toolchains.sh, which
#     languages/gg/install.sh runs a few steps later, refuses to proceed
#     without it and installs the pinned YARD on top of it. The interpreter
#     itself is deliberately unpinned; what has to agree across the
#     devcontainer, a CI agent and an image is the reflector, not what runs it.
#   - libicu-dev: the ICU gg's C# arm needs to run Roslyn. The .NET runtime
#     does not link it: it `dlopen`s `libicuuc` and `libicui18n` by name while
#     the CLR is still starting and aborts when neither resolves, so `csc` on a
#     machine without ICU dies of SIGABRT having written nothing. The `-dev`
#     name rather than the runtime package's, whose name carries the ABI
#     version and would have to move on every base bump.
#   - ffmpeg: the normalizer scripts/build-sample-pack.mjs shells out to when
#     it bakes an audio palette. The script degrades rather than fails without
#     it, writing a structurally valid pack that renders silence, which is the
#     one failure no gate catches.
#   - cmake: native build dependencies of some Rust crates.
#   - iproute2, lsof, procps: `ss`, `lsof` and `ps` for the local cluster
#     tooling (deployments/local/Makefile) and scripts/free-local-forward.sh,
#     each of which guards its use with `command -v` and does nothing when the
#     tool is missing.
#   - postgresql: the server binaries (`initdb`, `pg_ctl`) the backend's tests
#     start a throwaway PostgreSQL server with, to run two replicas over one
#     database. Only the binaries are used; the cluster the package creates is
#     never started.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	cmake \
	ffmpeg \
	iproute2 \
	libicu-dev \
	lsof \
	postgresql \
	procps \
	ruby
