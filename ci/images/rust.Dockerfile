# The Rust track's CI image: everything the `rust`, `rustlint`, `rustdoc`,
# `binary_linux` and `gg_amd64` jobs of azure-pipelines.yml execute, and nothing
# else. See ci/images/README.md for what is in it and why, and
# scripts/ci/ci-image.sh for how it is built, tagged and pushed.
#
# This is not the devcontainer. The devcontainer is a place to work: it carries
# coding agents, the Azure CLI, gh, k3d, lazygit, a Docker client and a shell set
# up for a person, none of which a gate runs. It is also built for whoever is
# sitting at it, with their uid. This image is built once, for linux/amd64, on a
# hosted agent, and pulled by every Rust job, so it holds the toolchains and no
# more: the pinned Rust toolchain with rustfmt, clippy and cargo-nextest, Node
# for the two ECMAScript arms of gg, and gg's eleven program-language toolchains
# together with the C# guest's build toolchains, installed by the same scripts
# and from the same pins the devcontainer installs them from.
#
# The pins come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, read by ci/images/build-args.sh and passed
# in as the build arguments below, so a version is decided in one place. gg's
# own pins live in packages/gg-sandbox-*/<lang>-version.sh, read by the
# installers themselves.
FROM docker.io/library/ubuntu:26.04

# apt must never stop for a prompt during the build (tzdata asks for a region).
# An ARG with a default rather than an ENV, so it holds for the build and does
# not leak into the environment a gate runs in, and so build-args.sh does not
# treat it as a pin.
ARG DEBIAN_FRONTEND=noninteractive

ARG NODE_VERSION
ARG NEXTEST_VERSION
ARG RUST_VERSION

# ROOT THROUGHOUT, WITH HOME PINNED TO /root. Azure runs a container job's steps
# as a user it adds to the container with the agent's own uid, and leaves the
# environment the image set, so every step sees HOME=/root. gg's toolchains want
# exactly that: three of the eleven arms (uv, the YARD gem, the rustup wasm32
# component) install under $HOME and nowhere else, and the reflectors in
# crates/gg/build.rs look for the rest under $HOME/.local/share first. Installing
# as root under /root and then opening /root to every user is what lets a step
# running as the agent's uid read the toolchains and write the caches beside
# them. Every RUN that writes under /root ends with the chmod in the same layer,
# because a chmod in a later layer would copy every file it touched into that
# layer and double the image.
#
# RUSTUP_HOME and CARGO_HOME are stated rather than left to rustup's defaults so
# that they survive whatever HOME a step is given, and the PATH is complete
# here: a pipeline step reads no rc file, so anything a gate calls is on this
# line or it does not exist. /root/.local/bin carries uv, purs and esbuild.
ENV LANG=C.UTF-8 \
	HOME=/root \
	RUSTUP_HOME=/root/.rustup \
	CARGO_HOME=/root/.cargo \
	PATH=/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# The apt packages. Written here rather than by splitting
# .devcontainer/system/apt.sh, whose one list is toolchains plus a developer's
# ergonomics (ripgrep, tmux, vim, ssh, sudo), and short enough to state with
# reasons:
#
#   - build-essential, cmake, pkg-config: the linker and C compiler `ring` and
#     wasmtime's dependencies build with, and the tool their build scripts
#     resolve system libraries through.
#   - ca-certificates, curl, wget, tar, gzip, unzip, xz-utils, zip: every
#     download below and the archives they arrive in. unzip is what the C# arm's
#     Mono runtime pack (a .nupkg) is opened with.
#   - git: the suite shells out to it, cargo fetches git dependencies, and the
#     gates read the checkout through it.
#   - ffmpeg: the audio stage shells out to it and its tests drive it.
#   - jq: the shell scripts under scripts/ read JSON with it.
#   - libicu-dev: without it the C# arm's `csc` aborts on start.
#   - libstdc++6: Azure mounts its own Node into a container job and runs every
#     `task:` of the job with it, and that build links against libstdc++.
#   - locales, tzdata: a UTF-8 locale and a timezone database.
#   - musl-tools: `musl-gcc` links the static gg binary the `gg_amd64` job builds.
#   - python3: the Rust, Swift and C++ reflectors are Python scripts, run by the
#     Python uv provides but present on the machine for the scripts that ask for
#     a system interpreter by name.
#   - ruby: the Ruby arm reflects its catalogue with YARD, and the interpreter is
#     the one toolchain the gg installer refuses to install itself.
RUN apt-get update -y && \
	apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		cmake \
		curl \
		ffmpeg \
		git \
		gzip \
		jq \
		libicu-dev \
		libstdc++6 \
		locales \
		musl-tools \
		pkg-config \
		python3 \
		ruby \
		tar \
		tzdata \
		unzip \
		wget \
		xz-utils \
		zip && \
	rm -rf /var/lib/apt/lists/*

# Node, from the official tarball, into /usr/local. Building crates/gg needs it:
# the TypeScript and JavaScript catalogues are reflected with the workspace's
# pinned `typescript`, and the PureScript reflector is a Node script. The job
# runs `npm ci` itself, because the workspaces live in the checkout.
RUN case "$(uname -m)" in \
		x86_64) arch=x64 ;; \
		aarch64) arch=arm64 ;; \
		*) echo "no Node build for $(uname -m)" >&2; exit 1 ;; \
	esac && \
	curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" -o /tmp/node.tar.xz && \
	mkdir -p /usr/local/node && \
	tar -xJf /tmp/node.tar.xz -C /usr/local/node --strip-components=1 && \
	ln -s /usr/local/node/bin/node /usr/local/node/bin/npm /usr/local/node/bin/npx /usr/local/bin/ && \
	rm -f /tmp/node.tar.xz && \
	node --version && npm --version

# The Rust toolchain rust-toolchain.toml names, with the components the lint and
# doc gates run, installed up front rather than materialized by rustup on the
# first cargo call of every job. The host's musl target is what the static gg
# binary is built for, and wasm32-unknown-unknown mirrors what
# .devcontainer/languages/rust/targets.sh gives a developer; the gg Rust arm's
# own wasm32-wasip1 standard library is added by its installer below.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
	sh -s -- -y --no-modify-path --profile minimal \
		--default-toolchain "$RUST_VERSION" \
		--component rustfmt --component clippy && \
	rustup target add "$(uname -m)-unknown-linux-musl" wasm32-unknown-unknown && \
	rustc --version && cargo --version && cargo clippy --version && \
	chmod -R a+rwX /root

# cargo-nextest, the repository's test runner, from the same pinned installer the
# Windows leg of the binary gate runs on the hosted agent.
COPY scripts/ci/install-nextest.sh /tmp/scripts/
RUN NEXTEST_VERSION="$NEXTEST_VERSION" bash /tmp/scripts/install-nextest.sh && \
	cargo nextest --version && \
	rm -rf /tmp/scripts && \
	chmod -R a+rwX /root

# gg's eleven program-language toolchains and the C# guest's build toolchains,
# about 3.4 GB and the largest thing in this image, from the one pinned list
# every surface installs from (scripts/ci/install-gg-toolchains.sh; its header
# is the argument). They are last and their own layers, so a pin moving in one
# arm's version file rebuilds this and nothing above it.
#
# THE SLICE. The installers are pinned by the repository, so a partial checkout
# is staged for them: the installers and the two files they source, gg's shared
# build shell, every arm's version file with the nine build-tool inputs beside
# them, and the rust-toolchain.toml the Rust arm's pin defers to.
# scripts/ci/lib.sh resolves the repository root from its own path, which is
# what lets the partial tree stand in for a checkout.
# ci/images/rust.Dockerfile.dockerignore is what narrows the context to that
# slice, one line per file, and scripts/ci/build-context.sh holds the list
# complete. It is the same slice .devcontainer/ubuntu.dockerfile stages.
#
# The downloads are staged under /tmp so the layer ships the toolchains and not
# the archives they came in. What stays under /root besides the toolchains is
# wanted: uv's cache holds the CPython and the pinned griffe the Python arm
# reflects with, and cargo's registry holds the Rust arm's crate closure, which
# that arm's build resolves offline.
#
# /TMP LEAVES THIS LAYER EMPTY. The installers run tools that scratch under the
# temporary directory at a path they derive from the account, not from the run
# (spago's is /tmp/root/spago-nodejs/), and a directory root made there stays
# root's: /root is opened below, /tmp is not, and mkdir under a root-owned
# directory is EACCES for the step user. So the run scratches under one TMPDIR
# of its own and the layer ends by removing everything under /tmp, which leaves
# the step user the sticky, world-writable /tmp of the base image, where every
# path it derives is its own to make.
COPY scripts/ci/install-*.sh scripts/ci/lib.sh scripts/ci/fetch.sh /tmp/gg-repo/scripts/ci/
COPY scripts/gg-*.sh /tmp/gg-repo/scripts/
COPY packages /tmp/gg-repo/packages
COPY rust-toolchain.toml /tmp/gg-repo/rust-toolchain.toml
RUN mkdir -p /tmp/image-build && \
	TMPDIR=/tmp/image-build TCAB_DOWNLOAD_CACHE=/tmp/downloads bash /tmp/gg-repo/scripts/ci/install-gg-toolchains.sh && \
	TMPDIR=/tmp/image-build TCAB_DOWNLOAD_CACHE=/tmp/downloads bash /tmp/gg-repo/scripts/ci/install-gg-build-toolchains.sh && \
	rm -rf /root/.npm && \
	find /tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} + && \
	chmod -R a+rwX /root

# git refuses a repository owned by another uid, and the checkout belongs to the
# agent rather than to whichever uid a step runs as.
RUN git config --system --add safe.directory '*'
