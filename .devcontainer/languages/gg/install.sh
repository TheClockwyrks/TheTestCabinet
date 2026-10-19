#!/usr/bin/env bash
# Installs the toolchains of gg's eleven program-language arms, and the build
# toolchains of its C# guest, into the image.
#
# This directory is named for gg rather than for a language because its two
# siblings each install one language and this one installs the languages gg
# drives, together: gg's crates/gg/build.rs reflects a signature catalogue out
# of each arm's own SDK with that arm's own documentation tool on every build
# of the crate, so in an image with ten of the eleven the `gg/` checkout cannot
# `cargo build --workspace`, cannot `cargo clippy --workspace`, and fails the
# gates that run both. A prerequisite of working in the gg checkout is a
# prerequisite of the image, not an hour of downloads a developer waits through
# after the container is created.
#
# Most of the arms' toolchains are already in the image by the time this runs: the template's
# language images, which ubuntu.dockerfile copies over the toolchain image, hold the Swift
# toolchain, wasi-sdk, the .NET SDK, the JDK, TeaVM, the Kotlin compiler, purs, spago, YARD,
# componentize-py and wit-bindgen at the versions the arms pin. gg's scripts/ci/gg-image-toolchains.sh runs first and links each arm's
# default home to the image's tree with the installer's version stamp beside it, so the installers
# after it find those arms installed and fetch only what no image holds. A pin the image does not
# hold fails it, and the build with it, rather than letting an installer download the arm here.
#
# It delegates rather than installs. gg's scripts/ci/install-gg-toolchains.sh
# is the one pinned list, shared with gg's pipeline (scripts/ci/gg-ci-toolchains.sh)
# and gg's toolchains image, and a per-arm script here would be the second list
# that arrangement exists to abolish: the twelfth arm would install everywhere
# but here. So this file names the link script and the two installer entry
# points and nothing else. The pins are in each arm's
# gg/packages/gg-sandbox-*/<lang>-version.sh, where the reflectors and the run
# images read them too.
#
# The installers are pinned by the gg repository, so they are read from the gg
# checkout, which is not mounted while the image builds. What makes that
# workable is gg's scripts/ci/tcab-lib.sh: it resolves the repository root from
# its own path, so the partial tree ubuntu.dockerfile stages from `gg/` at
# /tmp/scripts/gg-repo (the installers, their shared shell, every arm's pins and
# rust-toolchain.toml) behaves like a checkout as far as they are concerned.
# GG_REPO_SLICE points them at a real checkout instead (`GG_REPO_SLICE=$PWD/gg`
# from the superrepo's root), to run what the image build runs by hand.
#
# Everything installs under $HOME, which is what the reflectors look for first
# and all that three of the arms (uv, the YARD gem, rustup's wasm32 target) can
# use at all, so this runs as the container user and devcontainer.json's
# `"updateRemoteUserUID": false` is load-bearing: a uid rewrite at start would
# orphan the gigabytes this lays down. The two things the installer's header
# asks a caller to arrange, ~/.local/bin and ~/.cargo/bin on the PATH, the
# toolchain image's ENV has already arranged for every process in the image.
#
# The one prerequisite of a gg build that cannot be baked is `npm ci` in the gg
# checkout: two of the eleven catalogues are reflected with the pinned
# `typescript` in gg's npm workspace, which lives in the checkout. post-create.sh
# runs it, and the installer's closing note about node_modules is that, not a
# failure.
set -euo pipefail

readonly SLICE="${GG_REPO_SLICE:-/tmp/scripts/gg-repo}"

# The arms the template's language images hold, linked at the default homes the installers check.
bash "$SLICE/scripts/ci/gg-image-toolchains.sh"

# The eleven arms: what a gg run and gg's own reflectors execute.
bash "$SLICE/scripts/ci/install-gg-toolchains.sh"

# The C# guest's build toolchains, which are deliberately not on that list: a
# whole .NET SDK and an unpruned wasi-sdk that relinking Mono's IL interpreter
# into the guest needs and that no run does. Without them the build still
# succeeds, because gg's packages/gg-sandbox-csharp/build.sh fetches both into its
# own .build/ the first time anybody compiles gg, and a silent 1.4 GB download
# on somebody's first build is what this image exists to abolish.
bash "$SLICE/scripts/ci/install-gg-build-toolchains.sh"
