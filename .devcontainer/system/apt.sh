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
