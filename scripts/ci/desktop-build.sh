#!/usr/bin/env bash
# Builds and tests the Tauri desktop app — BOTH of its halves: the React UI
# (`apps/desktop`, which consumes `@test-cabinet/ui` from source) and the Rust
# shell (`crates/desktop`).
#
# WHY THIS EXISTS. The desktop app used to be validated nowhere except the
# GitHub Release workflow, which is the last place a break can be discovered:
# `release.yml` fanned out to three platforms, all three failed in the UI's
# `tsc -b`, and no earlier gate had ever compiled `apps/desktop` or
# `crates/desktop`. A green primary CI has to mean the desktop app builds too,
# so this script covers it on every change.
#
# The desktop app is the ONE component whose CI coverage is split across the two
# systems: Azure runs this on Linux and Windows, and macOS is validated only when
# the Release workflow bundles it, because Azure has no macOS agents. That is the
# single documented gap — see scripts/ci/README.md.
#
# WHY THE npm PACKAGES ARE BUILT FIRST. The desktop UI reaches
# `@test-cabinet/run-record`, `@test-cabinet/run-stats`, and the two runtimes
# through `@test-cabinet/ui`, and each of those publishes its entry points from a
# built `dist/`. On a clean checkout (which is what CI is) their imports resolve
# to nothing and the UI's typecheck collapses into a hundred cascading errors.
# The list of packages and the order to build them in is the root
# `build:packages` script's to know — the same one `web-build.sh` and
# `web-test.sh` defer to. NEVER inline the list here: a duplicated copy that went
# stale by one package (`run-stats`) is exactly what broke the release.
#
# The UI is built before anything Rust runs: it is the fastest-failing half, and
# it is the same `beforeBuildCommand` the Tauri CLI invokes during a release
# bundle, so a failure here reads identically to the one a release would hit.
#
# What this does NOT cover, and deliberately: producing the platform installers
# (`.deb`/`.msi`/`.dmg`) and the k3d/kubectl sidecars they bundle. That is
# release-time packaging — it needs the Tauri CLI and reaches out to the network
# — and it stays in `release.yml`.
#
# Critical validation: a failure here means the desktop app is broken.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build the workspace runtime packages the desktop UI imports"
npm run build:packages

log "build @test-cabinet/desktop (tsc -b && vite build)"
npm run build -w @test-cabinet/desktop

# The Rust shell. `rust-lint.sh` and `rust-test.sh` both pass
# `--exclude test-cabinet-desktop` so their runners need no GUI system libraries;
# this job installs those libraries, so it owns the excluded crate — including
# its unit tests, which no other job runs.
log "cargo clippy -p test-cabinet-desktop (warnings denied)"
cargo clippy --locked -p test-cabinet-desktop --all-targets -- -D warnings

log "cargo doc -p test-cabinet-desktop (warnings denied)"
cargo doc --locked -p test-cabinet-desktop --no-deps

log "cargo build -p test-cabinet-desktop"
cargo build --locked -p test-cabinet-desktop

log "cargo nextest run -p test-cabinet-desktop"
cargo nextest run --locked -p test-cabinet-desktop

log "cargo test --doc -p test-cabinet-desktop"
cargo test --locked -p test-cabinet-desktop --doc

log "desktop app builds and tests cleanly"
