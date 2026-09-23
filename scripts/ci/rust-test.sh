#!/usr/bin/env bash
# Builds and tests every headless Rust crate: the `tcab` CLI, the `tcab-backend`
# server, the `tcab-dispatcher`/`tcab-driver`/`tcab-artifacts` run-topology
# services, and the `test-cabinet-core`/`test-cabinet-telemetry` libraries they
# share.
#
# Scoped with `--workspace --exclude test-cabinet-desktop`: the only crate left
# out is the Tauri desktop shell (`crates/desktop`), so the per-change CI runners
# do not need the desktop app's heavy GUI system libraries (see rust-lint.sh).
# This is the critical Rust validation the Azure pipeline runs.
#
# Tests run with cargo-nextest (the repo's runner; see .config/nextest.toml —
# no retries, flaky-result=fail, fail-fast=false, and a per-test hard timeout;
# a test that fails and then passes fails the run). nextest does not
# execute doctests, so those run separately with `cargo test --doc`. The pipeline
# installs nextest first (scripts/ci/install-nextest.sh).
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# gg's eleven program-language arms want eleven toolchains on this agent, and — since the signature
# catalogues stopped being committed — they are a BUILD requirement rather than a test requirement.
# `crates/gg/build.rs` reflects each arm's catalogue out of that arm's own SDK with that arm's own
# documentation tool on every build of the crate, so the `cargo build` below does not start without
# them. They earn their place twice over, because the arms' tests then drive the same compilers on
# the way through: a model's program is compiled by a real `purs`, a real `javac` and TeaVM, a real
# Kotlin compiler onto the same TeaVM, a real `rustc` targeting `wasm32-unknown-unknown`, a real
# `swiftc` against the Swift SDK for WebAssembly, a real `clang++` from wasi-sdk, and a real Roslyn.
# None of them can ride inside gg's binary the way the Ruby arm's Opal compiler does — each is
# hundreds of megabytes with a separate build per platform — so every machine that builds gg
# installs them, this agent exactly as a gg run image does
# (containers/gg-toolchains/Dockerfile).
#
# One script rather than the eight calls that used to be here, so this agent, a developer's
# devcontainer, the pipeline's gg jobs and the driver image's gg build stage all provision from one
# pinned list: each arm's pin lives in its own packages/gg-sandbox-*/<lang>-version.sh, and the
# installers are idempotent, so an agent that already has them pays nothing.
#
# TWO scripts now, and the second one is below rather than folded into the first on purpose — read
# its note before merging them.
log "install gg's program-language toolchains (crates/gg does not build without them)"
./scripts/ci/install-gg-toolchains.sh
# `purs` and `esbuild` land in $HOME/.local/bin and are found on PATH; everything else installs under
# a prefix `crates/gg` looks for by name, so this is the only export needed. A child process cannot
# set its parent's PATH, which is why the line is here rather than in the installer.
export PATH="$HOME/.local/bin:$PATH"

# AND THE SECOND LIST, WHICH IS NEW AND IS NOT PART OF THE ELEVEN. The line above installs what a gg
# RUN and gg's reflectors execute. Building gg additionally means building every arm's ARTIFACTS —
# the guest components, the SDK jars, the compiled library sets a model's program meets — because
# those stopped being committed too, and one of them, the C# guest, is relinked from Mono's runtime
# pack with a whole .NET SDK and an UNPRUNED wasi-sdk. Neither is on the eleven-arm list and neither
# should be: ~1.4 GB that no run image needs, kept in its own prefix so the run list keeps its
# meaning (see that script's header).
#
# WITHOUT THIS LINE THE BUILD STILL SUCCEEDS, WHICH IS EXACTLY WHY IT IS HERE.
# `packages/gg-sandbox-csharp/build.sh` falls back to fetching both into its own `.build/` when
# neither prefix is populated, so the failure mode is not a red build — it is a silent ~1.4 GB
# download on every agent, every run. Idempotent like every installer here, so an agent hydrated
# from the CI image's `build-toolchains` tag pays nothing.
log "install the csharp arm's build toolchains (its guest is relinked by the build, not committed)"
./scripts/ci/install-gg-build-toolchains.sh

log "cargo build"
cargo build --locked --workspace --exclude test-cabinet-desktop

log "cargo nextest run"
cargo nextest run --locked --workspace --exclude test-cabinet-desktop

log "cargo test --doc"
cargo test --locked --workspace --exclude test-cabinet-desktop --doc
