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
#   - ruby: gg's Ruby program-language arm reflects its signature catalogue with
#     YARD, and `crates/gg/build.rs` reflects all eleven catalogues as a step of
#     building the crate — so without a Ruby this image cannot `cargo build
#     --workspace` at all. It is the ONE gg toolchain that comes from a
#     distribution package rather than from a pinned download, which is why it is
#     here and the other ten are in `scripts/ci/install-gg-toolchains.sh` (run from
#     `postCreateCommand`, because those are pinned by the repository and the
#     repository is not mounted yet at image-build time). That script installs the
#     pinned YARD on top of this Ruby; the interpreter itself is deliberately
#     unpinned, because what has to agree between a devcontainer, a CI agent and an
#     image build is the reflector rather than the thing it runs on. Declared here
#     for the reason iproute2 is: it was present by accident for a while, and an
#     undeclared tool disappears silently on a base-image change.
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
	ruby \
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
