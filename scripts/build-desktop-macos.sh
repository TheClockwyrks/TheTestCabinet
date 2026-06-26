#!/usr/bin/env bash
# Build the Tauri desktop app on a macOS host.
#
# The desktop shell links the system WebView, so it must be built on the host's
# native toolchain — it cannot be built inside the Linux devcontainer. Run this
# script from a checkout on your macOS host (Apple Silicon or Intel) to produce a
# `.dmg` installer and the `.app` bundle, mirroring the steps the Release workflow
# runs (`.github/workflows/release.yml`, the `desktop` job).
#
# Prerequisites on the host:
#   - Rust (rustup + cargo)            https://rustup.rs
#   - Node.js 22+ and npm              https://nodejs.org
#   - Xcode Command Line Tools         xcode-select --install
#   - A container runtime to RUN it    (Docker or a Docker-compatible one) — only
#     needed when you launch the app, which stands up its own k3d cluster; the
#     build itself does not need it.
#
# The Tauri CLI (`cargo tauri`) is installed on demand if missing.
#
# Usage:
#   scripts/build-desktop-macos.sh
#
# Environment overrides:
#   VERSION                 stamp the installer version (e.g. v0.1.0); default
#                           leaves tauri.conf.json's value (0.0.0).
#   TCAB_DESKTOP_IMAGE_TAG  GHCR service-image tag the built app pulls at runtime;
#                           default `latest` (the app's own fallback for local
#                           builds). The Release workflow pins this to the commit's
#                           immutable image set instead.
set -euo pipefail

# Work from the repo root regardless of where the script is invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "this script builds the macOS desktop app; run it on a macOS host (got $(uname -s))."

# Resolve the host's Rust target triple — Apple Silicon vs Intel — so the right
# k3d/kubectl sidecars are fetched and Tauri finds them under their `<name>-<triple>`
# names.
case "$(uname -m)" in
  arm64) TARGET="aarch64-apple-darwin" ;;
  x86_64) TARGET="x86_64-apple-darwin" ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

# Fail early with an actionable message if a host prerequisite is missing, rather
# than partway through a long build.
command -v cargo >/dev/null || die "cargo not found — install Rust from https://rustup.rs"
command -v node  >/dev/null || die "node not found — install Node.js 22+ from https://nodejs.org"
command -v npm   >/dev/null || die "npm not found — it ships with Node.js"
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools not found — run: xcode-select --install"

log "Host target: $TARGET"

# Ensure the host Rust target is installed (usually already is; harmless if so).
log "Adding Rust target $TARGET"
rustup target add "$TARGET"

# The Tauri CLI is a Cargo subcommand that drives the whole build (UI + Rust shell
# + installer). Install it once if it isn't already available.
if cargo tauri --version >/dev/null 2>&1; then
  log "Tauri CLI present: $(cargo tauri --version)"
else
  log "Installing Tauri CLI (cargo install tauri-cli)"
  cargo install tauri-cli --version "^2" --locked
fi

# Install the npm workspace (the UI the desktop bundles lives here).
log "npm ci"
npm ci

# The desktop UI imports the run-record package's compiled types, so build it
# before the Tauri build runs the UI's own vite build (its beforeBuildCommand).
log "Building @test-cabinet/run-record"
npm run build -w @test-cabinet/run-record

# The shipped app stands up its own k3d cluster, so it bundles k3d and kubectl as
# Tauri externalBin sidecars. Fetch the host-triple build of each into
# crates/desktop/binaries/ before the bundle runs (the committed config omits
# externalBin so a plain `cargo tauri build` needs no binaries — they are added via
# --config below).
log "Fetching cluster sidecars (k3d, kubectl) for $TARGET"
node scripts/fetch-desktop-sidecars.mjs "$TARGET"

# Build the .dmg. Run from the crate that holds tauri.conf.json so the CLI resolves
# it. `--bundles dmg` narrows the config's "all" targets to the macOS installer.
# `--config` adds the sidecar externalBin entries and — if VERSION is set — stamps
# the installer version. TCAB_DESKTOP_IMAGE_TAG (baked in at compile time) pins the
# GHCR service images the app pulls; it defaults to `latest` for local builds.
config='{"bundle":{"externalBin":["binaries/k3d","binaries/kubectl"]}}'
if [[ -n "${VERSION:-}" ]]; then
  version_number="${VERSION#v}"
  config="{\"version\":\"${version_number}\",\"bundle\":{\"externalBin\":[\"binaries/k3d\",\"binaries/kubectl\"]}}"
fi

log "Building desktop app (cargo tauri build --bundles dmg)"
( cd crates/desktop && cargo tauri build --bundles dmg --config "$config" )

# Point the user at the artifacts. Tauri writes them under target/release/bundle/.
log "Done. Artifacts:"
find target/release/bundle -type f -name '*.dmg' -print 2>/dev/null || true
find target/release/bundle -type d -name '*.app' -print 2>/dev/null || true

cat <<'NOTE'

The app is not code-signed, so on first launch Gatekeeper may report it as
"damaged". After dragging it to /Applications, clear the quarantine attribute once:

  xattr -dr com.apple.quarantine "/Applications/The Test Cabinet.app"

To run it you need a container runtime (Docker or compatible) running — the app
stands up its own k3d cluster on launch.
NOTE
