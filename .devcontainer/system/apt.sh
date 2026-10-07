#!/usr/bin/env bash
# Installs apt-managed packages needed to build and work on this project.
set -euo pipefail

apt-get update -y

# General purpose packages.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	ca-certificates \
	locales \
	pkg-config \
	socat \
	tzdata

# Developer tools and build dependencies.
#   - build-essential: the C toolchain and linker Rust links its binaries with.
#   - git / ssh: source control.
#   - make / python3 / shellcheck: what `make gate` runs.
#   - socat: the bridges tools/host-runtime.sh and tools/ssh-agent.sh build.
#   - xz-utils: extracting the Node.js .tar.xz tarball.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	build-essential \
	ccache \
	curl \
	git \
	jq \
	make \
	python3 \
	ripgrep \
	shellcheck \
	ssh \
	sudo \
	tar \
	tmux \
	tree \
	unzip \
	vim \
	wget \
	xz-utils \
	zip

# The SSH client's configuration, written in the layer that installs it. The
# client warns on every connection to a server that offers no post-quantum key
# exchange, and the forges this project fetches from and pushes to offer none,
# so every fetch, push and submodule update would print a warning nothing in
# here can act on. `WarnWeakCrypto no` stops it, for every account in the
# container, and a key exchange is still negotiated exactly as before.
cat > /etc/ssh/ssh_config.d/50-warn-weak-crypto.conf <<'EOF'
# Written by the devcontainer's system/apt.sh. The forges this project reaches
# offer no post-quantum key exchange, so the warning OpenSSH prints for that on
# every connection is noise here.
WarnWeakCrypto no
EOF

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
#   - ruby: gg's Ruby arm reflects its signature catalogue with YARD, and
#     crates/gg/build.rs reflects all eleven catalogues as a step of building
#     the crate, so without an interpreter `cargo build --workspace` fails.
#     It is the one gg toolchain that is a distribution package rather than a
#     pinned download: scripts/ci/install-gg-toolchains.sh, which
#     languages/gg/install.sh runs several layers below, refuses to proceed
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
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	cmake \
	ffmpeg \
	iproute2 \
	libicu-dev \
	lsof \
	procps \
	ruby
