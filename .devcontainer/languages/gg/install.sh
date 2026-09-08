#!/usr/bin/env bash
# Installs the toolchains of gg's eleven program-language arms into the image.
#
# WHY THIS DIRECTORY IS CALLED `gg` RATHER THAN A LANGUAGE. Its two siblings here
# install one language each; this one installs *the languages gg drives* — every
# arm of the responses-as-code capability, together. They arrive together because
# they are needed together: `crates/gg/build.rs` reflects a signature catalogue out
# of each arm's own SDK, with that arm's own documentation tool, on every build of
# the crate. Eleven of eleven or none — an image with ten cannot `cargo build
# --workspace`, cannot `cargo clippy --workspace`, and fails the pre-commit hooks
# that run both.
#
# WHY IT IS A DELEGATOR AND NOT AN INSTALLER. `scripts/ci/install-gg-toolchains.sh`
# is the ONE pinned list, and it is deliberately shared: the devcontainer image (via
# this file), `scripts/ci/rust-test.sh`, `scripts/ci/contract-drift.sh`, the Azure
# rust job, the GitHub release workflow and the driver service image's gg stage all
# provision from it. Writing a `.devcontainer/languages/<arm>/install.sh` per arm —
# the shape the `rust` sibling uses, and the obvious thing to reach for — would
# create the second source of truth this arrangement exists to abolish, and it would
# drift the day an arm is added: the twelfth arm would install everywhere except
# here. So this file names one entry point and one path convention and nothing else.
# It contains no version, no installer name and no arm name on purpose. Look for
# those in the arm's own `packages/gg-sandbox-*/<lang>-version.sh`, where the
# reflectors and the run images read them too.
#
# WHY THE REPOSITORY ARRIVES AT /tmp/scripts/gg-repo. The installers are pinned *by
# the repository*, so they have to be read *from* the repository — which at image
# build time is not mounted and cannot be. What makes that workable is
# `scripts/ci/lib.sh`: it resolves `REPO_ROOT` from its own `${BASH_SOURCE[0]}` and
# `cd`s there, so a PARTIAL tree containing only `scripts/ci`, the arms' version
# files and `rust-toolchain.toml` behaves exactly like a checkout as far as those
# scripts are concerned. `containers/gg-toolchains/Dockerfile` has staged five of
# these same installers that way for a while; this is the same trick over the whole
# set. `.devcontainer/ubuntu.dockerfile` COPYs that slice in and deletes it again in
# the RUN below — which keeps a stale half-repository out of the final filesystem but
# saves nothing, because each COPY is its own layer and a later delete can only write a
# whiteout over it. THREE of the four parts of the slice are GLOBS in the Dockerfile's
# COPYs (`scripts/ci/install-*.sh` + `lib.sh`, `scripts/gg-*.sh`, `./packages`), so a
# new arm needs no edit there — and so the ~3.4 GB layer's cache key contains the pins,
# the installers and gg's shared build shell, and nothing else. In
# `.devcontainer/ubuntu.dockerfile.dockerignore` the same three families are
# ENUMERATED, one line per file, because a `!` pattern with a wildcard makes BuildKit's
# context sender walk the entire working tree; scripts/ci/build-context.sh fails when a
# tracked file in one of those families is missing from the list.
#
# The fourth part is also an enumeration, of seven files, and deliberately: the two arms whose
# `componentize-*` pin lives in a `build.sh`, the Python arm's `requirements.txt`, the Rust
# arm's separate `Cargo.toml`/`Cargo.lock`, and the PureScript arm's `spago.yaml`/`spago.lock`
# — the inputs `install-gg-build-tools.sh` warms the package-manager-delivered half of the
# build toolchain from. A glob wide enough to admit them (`!/packages/gg-sandbox*/build.sh`)
# would put ten build scripts in this layer's cache key, and every one of those changes far
# more often than a pin does. That file's own comment carries the same argument.
#
# WHAT THIS DELIBERATELY DOES NOT DO. `npm ci`, which is the one prerequisite of a
# gg build that cannot be baked: two of the eleven catalogues (TypeScript and
# JavaScript) are reflected with the pinned `typescript` in the npm workspaces, and
# those workspaces live in the repository — which is a bind mount that exists only
# once the container is running. It stays in `devcontainer.json`'s
# `postCreateCommand`, beside the reconciling call to the installer below. The
# installer says so itself at the end of its run, so a build that ends with a
# paragraph about `node_modules` has not failed.
#
# NO ENVIRONMENT IS SET HERE, and that is a decision rather than an omission.
# Everything installs under `$HOME` — which is what the reflectors
# `crates/gg/build.rs` runs look for first, and what three of the arms (uv, the YARD
# gem and the rustup `wasm32` component) can use AT ALL without editing the pinned
# list. That means this must run as the container user, after `USER $USERNAME`, and
# it means `devcontainer.json`'s `"updateRemoteUserUID": false` is load-bearing: a
# runtime UID rewrite would orphan ~3.4 GB of image-owned files. The two things the
# installer's header says a caller must arrange — `$HOME/.local/bin` on `PATH` for
# `purs` and `esbuild`, and `$HOME/.cargo/bin` on it for the `rustc`/`rustup` that
# `install-rust-wasm.sh` refuses to proceed without — the Dockerfile has already
# arranged with one `ENV PATH` several layers above, which is the right place for both:
# an environment set in this file would end with this process and reach nothing.
set -euo pipefail

# Where `.devcontainer/ubuntu.dockerfile` stages the repository slice. Overridable
# so this file can be run against a real checkout by hand (`GG_REPO_SLICE=$PWD
# bash .devcontainer/languages/gg/install.sh`) when debugging what the image build
# does, which is otherwise a 30-minute round trip.
readonly SLICE="${GG_REPO_SLICE:-/tmp/scripts/gg-repo}"

bash "$SLICE/scripts/ci/install-gg-toolchains.sh"

# AND THE SECOND LIST, WHICH IS NOT AN ARM AND MUST NOT JOIN THE ELEVEN. Everything above is what a
# gg RUN and gg's reflectors execute. Building gg additionally builds every arm's ARTIFACTS — the
# guest components and compiled library sets a model's program actually meets, which stopped being
# committed for the same reason the catalogues did — and one of them, the C# guest, is Mono's IL
# interpreter relinked with a whole .NET SDK against an UNPRUNED wasi-sdk. Neither is on the list
# above, deliberately: ~1.4 GB that no run image needs, in its own prefix, so the eleven-arm list
# keeps its meaning (see `scripts/ci/install-gg-build-toolchains.sh`'s header, which argues it).
#
# IT IS BAKED HERE RATHER THAN LEFT TO THE DEVELOPER FOR THE REASON EVERYTHING ELSE HERE IS: without
# it `cargo build --workspace` still succeeds, and `packages/gg-sandbox-csharp/build.sh` quietly
# fetches both into that package's `.build/` the first time anybody compiles gg. A silent 1.4 GB
# download on somebody's first build is exactly the first-run experience this image exists to
# abolish. It is the single biggest thing in this image and it is still the right trade.
bash "$SLICE/scripts/ci/install-gg-build-toolchains.sh"
