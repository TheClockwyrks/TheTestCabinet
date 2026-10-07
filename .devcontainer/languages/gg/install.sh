#!/usr/bin/env bash
# Installs the toolchains of gg's eleven program-language arms, and the build
# toolchains of its C# guest, into the image.
#
# This directory is named for gg rather than for a language because its two
# siblings each install one language and this one installs the languages gg
# drives, together: crates/gg/build.rs reflects a signature catalogue out of
# each arm's own SDK with that arm's own documentation tool on every build of
# the crate, so an image with ten of the eleven cannot `cargo build
# --workspace`, cannot `cargo clippy --workspace`, and fails the commit hooks
# that run both. A prerequisite of working in the repository is a prerequisite
# of the image, not an hour of downloads a developer waits through after the
# container is created.
#
# It delegates rather than installs. scripts/ci/install-gg-toolchains.sh is
# the one pinned list, shared with the pipeline's scripts/ci/gg-ci-toolchains.sh
# and the driver image's gg stage, and a per-arm script here would be the second
# list that arrangement exists to abolish: the twelfth arm would install
# everywhere but here. So this file names the two entry points and nothing
# else. The pins are in each arm's packages/gg-sandbox-*/<lang>-version.sh,
# where the reflectors and the run images read them too.
#
# The installers are pinned by the repository, so they are read from the
# repository, which is not mounted while the image builds. What makes that
# workable is scripts/ci/tcab-lib.sh: it resolves the repository root from its
# own path, so the partial tree ubuntu.dockerfile stages at /tmp/scripts/gg-repo
# (the installers, their shared shell, every arm's pins and rust-toolchain.toml)
# behaves like a checkout as far as they are concerned. GG_REPO_SLICE points
# them at a real checkout instead, to run what the image build runs by hand.
#
# Everything installs under $HOME, which is what the reflectors look for first
# and all that three of the arms (uv, the YARD gem, rustup's wasm32 target) can
# use at all, so this runs as the container user and devcontainer.json's
# `"updateRemoteUserUID": false` is load-bearing: a uid rewrite at start would
# orphan the gigabytes this lays down. The two things the installer's header
# asks a caller to arrange, ~/.local/bin and ~/.cargo/bin on the PATH, the
# Dockerfile's ENV has already arranged for every process in the image.
#
# The one prerequisite of a gg build that cannot be baked is `npm ci`: two of
# the eleven catalogues are reflected with the pinned `typescript` in the npm
# workspace, which lives in the checkout. post-create.sh runs it, and the
# installer's closing note about node_modules is that, not a failure.
set -euo pipefail

readonly SLICE="${GG_REPO_SLICE:-/tmp/scripts/gg-repo}"

# The eleven arms: what a gg run and gg's own reflectors execute.
bash "$SLICE/scripts/ci/install-gg-toolchains.sh"

# The C# guest's build toolchains, which are deliberately not on that list: a
# whole .NET SDK and an unpruned wasi-sdk that relinking Mono's IL interpreter
# into the guest needs and that no run does. Without them the build still
# succeeds, because packages/gg-sandbox-csharp/build.sh fetches both into its
# own .build/ the first time anybody compiles gg, and a silent 1.4 GB download
# on somebody's first build is what this image exists to abolish.
bash "$SLICE/scripts/ci/install-gg-build-toolchains.sh"
