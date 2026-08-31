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
#     here and the other ten are in `scripts/ci/install-gg-toolchains.sh` — which
#     this image also runs, several layers below (`languages/gg/install.sh`), so
#     this line is a PREREQUISITE of that layer rather than an exception to it: the
#     installer refuses to proceed without a `ruby` on PATH, and says so naming this
#     file. That script installs the pinned YARD on top of this Ruby; the
#     interpreter itself is deliberately unpinned, because what has to agree between
#     a devcontainer, a CI agent and an image build is the reflector rather than the
#     thing it runs on. Declared here for the reason iproute2 is: it was present by
#     accident for a while, and an undeclared tool disappears silently on a
#     base-image change.
#   - ffmpeg: the normalizer `scripts/build-sample-pack.mjs` shells out to when it
#     bakes an audio palette — `sfx-sample`'s sample library and `music`'s
#     instrument bank — from its committed manifest. It resamples, downmixes,
#     loudness-normalizes and trims each fetched CC0 source into the PCM-16 `.wav`
#     `crates/audio-core/src/sample.rs` decodes. Declared here because the script
#     DEGRADES rather than fails without it: it falls back to a documented raw-copy
#     skeleton that still writes a correct layout and a stable digest, so a pack
#     built on a machine with no ffmpeg is structurally valid and silent. That is
#     the worst possible failure mode for an audio palette — every `add-sample`
#     records fine and renders nothing — and it is invisible until someone listens.
#     A full-stack or audio case authored against a silently-stubbed pack produces
#     assets that are wrong in a way no gate catches.
#   - libicu-dev: ICU, which gg's C# program-language arm needs to run one compiler.
#     The .NET runtime does not link it: `libSystem.Globalization.Native.so` `dlopen`s
#     `libicuuc` and `libicui18n` by name while the CLR is still starting, and calls
#     `FailFast` when neither resolves — so `csc` on a machine without ICU dies of
#     SIGABRT having written nothing, and that arm's suite (nine files, several of
#     which spawn a real Roslyn) cannot run at all. Declared here for the reason
#     iproute2 is, and it is the starkest of the three: ICU has been arriving through
#     `languages/rust/tauri.sh`, which installs `libwebkit2gtk-4.1-dev` for the
#     DESKTOP app's build, which depends on `libwebkit2gtk-4.1-0`, which depends on
#     `libicu78`. Whether gg's C# arm is testable on this machine has been a property
#     of whether the Tauri shell still wants a browser engine — a chain nobody would
#     walk backwards from a compiler that aborted.
#     A RUN IMAGE OWES THE SAME LIBRARIES AND DOES NOT GET THEM FROM HERE: it has no
#     package manager at run time, so `scripts/ci/install-dotnet.sh` vendors the same
#     three under `/opt/gg` and gg names that directory on `LD_LIBRARY_PATH`. The two
#     halves are not interchangeable, and assuming they were is what shipped a broken
#     arm: this file's ICU is why the whole C# suite passes here, and it says nothing
#     whatever about the image the toolchain actually runs in.
#     `libicu-dev` rather than the runtime package, because the runtime package's name
#     carries the ABI version — `libicu72` on Debian bookworm, `libicu78` on this
#     image's Ubuntu 26.04 — so it would have to be edited on every base bump, while
#     the `-dev` name is stable and depends on whichever runtime the release ships.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	build-essential \
	cmake \
	curl \
	ffmpeg \
	git \
	iproute2 \
	jq \
	libicu-dev \
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
