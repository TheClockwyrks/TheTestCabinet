#!/usr/bin/env bash
# Installs apt-managed packages needed to build and work on The Test Cabinet.
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
#   - build-essential / cmake: native build deps for some Rust crates.
#   - musl-tools: provides musl-gcc for the portable static `tcab` build
#     (the `ring` TLS backend compiles a little C). See DEVELOPMENT.md.
#   - git / ssh: source control, including the fresh per-run repositories.
#   - xz-utils: extracting the Node.js .tar.xz tarball.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	build-essential \
	cmake \
	curl \
	git \
	jq \
	musl-tools \
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
