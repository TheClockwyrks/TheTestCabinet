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
#     (the `ring` TLS backend compiles a little C). See
#     https://docs.testcabinet.ai/development/building/#portable-static-tcab-build.
#   - git / ssh: source control, including the fresh per-run repositories.
#   - xz-utils: extracting the Node.js .tar.xz tarball.
#   - iproute2 / lsof / procps: process and listening-socket inspection, which the
#     local-cluster tooling depends on — `ss` for the port guard in
#     `deployments/local/Makefile`'s local-ingest, and `lsof` + `ps`/`pgrep` for
#     `scripts/free-local-forward.sh`. lsof and procps happened to be present in the
#     base image and iproute2 did NOT, which is exactly why all three are declared
#     here: an undeclared tool disappears silently on a base-image change, and a
#     `command -v`-guarded use of it degrades to doing nothing rather than failing.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	build-essential \
	cmake \
	curl \
	git \
	iproute2 \
	jq \
	lsof \
	musl-tools \
	procps \
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
