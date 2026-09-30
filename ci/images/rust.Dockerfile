# The Rust track's CI image: everything the gates in the `rust` job of
# azure-pipelines.yml reach for, and nothing else.
#
# This is not the devcontainer. The devcontainer is a place to work — it carries
# coding agents, the Azure CLI, gh, k3d, kubelogin, lazygit and a shell
# configured for a person, none of which a gate invokes. Pulling and unpacking
# that on every run of every track costs more than the checks themselves take.
# So CI gets its own image per track, built from the same install scripts and
# the same version pins, holding only what the checks execute.
#
# The pins come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh and
# passed in as the build arguments below. There is no second place a version is
# decided, which is what keeps the compiler in this image the one
# rust-toolchain.toml names. See ci/images/README.md.
#
# Built for linux/amd64 only: Azure's hosted agents are amd64, and the
# devcontainer stays multi-architecture by being built on the machine that runs
# it. scripts/ci/ci-image.sh builds and pushes this file.
FROM docker.io/library/ubuntu:26.04

# apt must never stop for a prompt during the build — tzdata asks for a region
# otherwise. This is an ARG rather than an ENV so it holds for the build and
# does not leak into the environment a gate runs in. It carries its own default,
# which is what keeps ci/images/build-args.sh from treating it as a version pin.
ARG DEBIAN_FRONTEND=noninteractive

ARG RUST_VERSION
ARG NEXTEST_VERSION
ARG NEXTEST_SHA256_AMD64
ARG NEXTEST_SHA256_ARM64

# Built as root, with no USER line, and the steps do not run as root. Azure runs
# `useradd -m -u 1001 vsts_azpcontainer` against a container job and execs every
# step as that user, whatever the image's default user is and whatever `--user`
# the container resource asks for. HOME below is still this image's, so a step
# runs as uid 1001 with HOME=/root, and every tool keeping a cache under HOME
# writes there. That is why /root is widened at the end of this file. The
# UID/GID-matching apparatus in .devcontainer/system/init-user.sh exists to make
# a developer's edits land with the right ownership on a bind mount, which buys
# a CI image nothing, so it is neither copied nor run here.
ENV HOME=/root \
	USER=root \
	LANG=C.UTF-8

# Where the toolchain lives, and the hard contract this image owes the pipeline:
# /usr/local/cargo/bin is on the PATH and holds `cargo`, `rustup` and
# `cargo-nextest`.
#
# A job that caches the crate registry repoints CARGO_HOME at its cache
# directory. That works only because the toolchain is not under CARGO_HOME:
# RUSTUP_HOME stays where this image put it, and cargo's subcommand lookup finds
# `cargo-nextest` on the PATH rather than under the CARGO_HOME of the moment.
# Install Rust into a home directory instead and the toolchain vanishes on the
# first run of every job.
ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo

# The PATH has to be complete here. In the devcontainer the interactive shell's
# rc file fills it in; a pipeline step reads no rc file, and nothing
# reconstructs a PATH on its way into the job container. Anything a gate calls
# is on this line or it does not exist.
ENV PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Where tools/uv.sh puts what it installs, and where uv puts the tool
# environments and the CPython it fetches for them. /usr/local rather than a
# home directory, because which user Azure runs a step as is the agent's
# decision and a tool under /root would be one user's alone.
ENV UV_INSTALL_DIR=/usr/local/bin \
	UV_TOOL_DIR=/usr/local/share/uv/tools \
	UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python

# The apt packages, written here rather than by splitting
# .devcontainer/system/apt.sh. That script installs one list for a machine that
# is both toolchains plus a developer's ergonomics — ripgrep, tmux, vim, tree,
# ssh, sudo — and splitting it would risk the devcontainer to save nothing. This
# list is short enough to state with its reasons in place.
#
#   - ca-certificates, curl, wget: rustup-init, the cargo-nextest release
#     archive and the uv installer are all downloads.
#   - git: the gate runner shells out to `git rev-parse` before any gate does
#     anything else, and cargo fetches git dependencies.
#   - jq: the shell scripts under scripts/ read JSON with it.
#   - tar, gzip, unzip, xz-utils: what the downloads above arrive in.
#   - locales, tzdata: a UTF-8 locale and a timezone database, so a test that
#     formats a date agrees with one run in the devcontainer.
#   - build-essential, pkg-config: the linker cargo links a binary with, and the
#     tool the crates below resolve their system libraries through.
#   - musl-tools: musl-gcc, the linker a static build against this
#     architecture's musl target links with, and the C compiler a crate that
#     compiles C of its own calls for that target. The target itself is added
#     by languages/rust/targets.sh below.
#
# The project's own packages, installed in the same step as the toolchain's,
# after them: what the project's tests and builds reach for on this track and
# the toolchain does not. The devcontainer installs a list of its own,
# .devcontainer/system/apt.sh, which this list leaves as it is.
#
#   - cmake
#   - ffmpeg
#   - libicu-dev
#   - python3
#   - ruby
#   - zip
#
# libstdc++6 is named rather than left to build-essential, which happens to pull
# it in. Azure mounts its own Node into a container job and runs every `task:`
# of the job with it, and that build links against libstdc++, so a reader
# trimming build-essential would take the job's tasks down with it.
#
# Deliberately absent: node and npm. Nothing on this track builds a bundle, and
# the server crate reads none of one, so no check here waits on the web
# workspace.
RUN apt-get update -y && \
	apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		gzip \
		jq \
		libstdc++6 \
		locales \
		musl-tools \
		pkg-config \
		tar \
		tzdata \
		unzip \
		wget \
		xz-utils \
		cmake \
		ffmpeg \
		libicu-dev \
		python3 \
		ruby \
		zip && \
	rm -rf /var/lib/apt/lists/*

# Each install script is copied in immediately before the step that runs it, so
# an edit to one of them rebuilds that step and the ones after it rather than
# the toolchain layer below.
COPY .devcontainer/languages/rust/ /tmp/scripts/rust/

# The toolchain and the test runner, from the scripts the devcontainer uses.
# languages/rust/install.sh runs rustup.sh and cargo-nextest.sh, and
# targets.sh between them. targets.sh adds this architecture's musl standard
# library, so a static build compiles on this track as it does in the
# devcontainer.
#
# Both are safe to reuse here now that cargo-nextest.sh reads CARGO_HOME instead
# of assuming a home directory: rustup-init honours CARGO_HOME and RUSTUP_HOME
# itself, and cargo-nextest.sh takes the nextest binary out of its release
# archive into CARGO_HOME/bin once the archive matches the checksum the anchor
# pins, which this image receives as a build argument like the version. Each
# one resolves its own architecture out of the image and each one runs what it
# installed once before it finishes, which is what catches a download for the
# wrong architecture here rather than in a gate.
#
# clippy is added explicitly, which the devcontainer does not do. There,
# rust-toolchain.toml's `components` list makes rustup materialize clippy the
# first time cargo runs in the workspace, and it stays in the container's home
# afterwards. A pipeline job starts from the image every time, so leaving it out
# would mean downloading clippy on every single run of the lint gate.
#
# Nothing above compiles a crate, so cargo should leave no registry cache in
# CARGO_HOME; whatever one a later script comes to leave goes out in the same
# layer rather than into the image. The two directories are made world-writable
# the way the official Rust images make them, so a step that runs as another
# user can still materialize a component.
RUN bash /tmp/scripts/rust/install.sh && \
	rustup component add clippy && \
	rm -rf "$CARGO_HOME/registry" "$CARGO_HOME/git" /tmp/scripts/rust && \
	chmod -R a+w "$CARGO_HOME" "$RUSTUP_HOME"

# uv, and on top of it pre-commit. Every gate is invoked as
# `uv run --quiet --project ci gate run <id>`, so uv is the one command the
# pipeline calls directly.
#
# tools/uv.sh is safe to reuse: it installs a static binary and takes its
# destination from UV_INSTALL_DIR. The CPython it fetches to run pre-commit
# under lands wherever UV_PYTHON_INSTALL_DIR points, which is why that is set
# above rather than left to default under a home directory. That interpreter is
# also the one `uv run --project ci` resolves, so the gate runner's environment
# is built here rather than downloaded on the first step of every run.
COPY .devcontainer/tools/uv.sh /tmp/scripts/
RUN bash /tmp/scripts/uv.sh && \
	rm -rf /tmp/scripts

# git refuses a repository owned by another uid, and running as root is not an
# exemption. Every gate reaches git — the runner shells out to
# `git rev-parse --show-toplevel` before any gate does anything else — and the
# checkout belongs to the agent, not to this image.
RUN git config --system --add safe.directory '*'

# HOME for every step, and not writable by the uid that runs them until this
# line. Recursive, because the directories the build already created under it
# are the ones a step reaches for: `uv` made /root/.cache, and pre-commit's
# store goes inside it. Widening /root alone leaves that one root-owned, which
# is a permission error one directory deeper rather than none. `a+rwX` adds
# execute to the directories and not to the files in them, and it is a+ rather
# than an owner because the uid is Azure's to choose and this image holds
# nothing secret.
RUN chmod -R a+rwX /root
