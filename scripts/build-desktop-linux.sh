#!/usr/bin/env bash
# Build the Tauri desktop app on a Linux host.
#
# The desktop shell links the system WebView (WebKitGTK), so it must be built on
# a Linux host with the GTK/WebKit toolchain — it cannot be built on macOS or
# Windows, nor inside the repo's devcontainer (a bundle built there links against
# the container's system libraries rather than your host's). Run this from a
# checkout on your Linux host to produce a `.deb` installer, mirroring the steps
# the Release workflow runs (`.github/workflows/release.yml`, the `desktop` job's
# Linux leg).
#
# Prerequisites on the host:
#   - The C build toolchain             a C compiler + pkg-config (build-essential)
#   - Rust (rustup + cargo)             https://rustup.rs
#   - Node.js 22+ and npm               https://nodejs.org
#   - Tauri's Linux GUI libraries       installed on demand below via
#                                       .devcontainer/languages/rust/tauri.sh
#                                       (reused from the repo; needs sudo/apt)
#   - A container runtime to RUN it     (Docker or a Docker-compatible one) — only
#     needed when you launch the app, which stands up its own k3d cluster; the
#     build itself does not need it.
#
# The Tauri CLI (`cargo tauri`) is installed on demand if missing.
#
# Usage:
#   scripts/build-desktop-linux.sh
#
# Environment overrides:
#   VERSION                 stamp the installer version (e.g. v0.1.0); default
#                           leaves tauri.conf.json's value (0.0.0).
#   BUNDLES                 comma-separated Tauri bundle targets; default `deb`.
#                           The Release workflow ships only the .deb — the
#                           AppImage builder reaches out to the network and is the
#                           flaky one in CI — but you can request e.g. `deb,rpm`.
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

[[ "$(uname -s)" == "Linux" ]] || die "this script builds the Linux desktop app; run it on a Linux host (got $(uname -s))."

# Resolve the host's Rust target triple — x86_64 vs arm64 — so the right
# k3d/kubectl sidecars are fetched and Tauri finds them under their `<name>-<triple>`
# names.
case "$(uname -m)" in
  x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
  aarch64 | arm64) TARGET="aarch64-unknown-linux-gnu" ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

BUNDLES="${BUNDLES:-deb}"

# Fail early with an actionable message if a host prerequisite is missing, rather
# than partway through a long build. On a bare Linux host the C compiler and
# pkg-config are NOT preinstalled — cargo needs the former to link and the Tauri
# build needs the latter to locate the GUI libs — so check them explicitly.
command -v cc         >/dev/null || die "no C compiler found — sudo apt install build-essential"
command -v pkg-config >/dev/null || die "pkg-config not found — sudo apt install pkg-config"
command -v cargo      >/dev/null || die "cargo not found — install Rust from https://rustup.rs"
command -v node       >/dev/null || die "node not found — install Node.js 22+ from https://nodejs.org"
command -v npm        >/dev/null || die "npm not found — it ships with Node.js"

log "Host target: $TARGET"

# Tauri v2's Linux backend compiles against the system WebKitGTK/GTK/tray
# libraries. Reuse the repo's curated package list (the same one the Release
# workflow runs on Linux) rather than duplicating it — but only
# run the (sudo apt) installer if the web view lib is actually missing, so a
# re-run on an already-provisioned host skips straight past.
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  log "Tauri GUI libraries present (webkit2gtk-4.1)"
else
  log "Installing Tauri Linux GUI libraries (.devcontainer/languages/rust/tauri.sh)"
  ./.devcontainer/languages/rust/tauri.sh
fi

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

# The desktop UI (via @test-cabinet/ui) imports the compiled types of the
# run-record and voxel-runtime packages, so build them before the Tauri build runs
# the UI's own tsc/vite build (its beforeBuildCommand). Without a built `dist/`,
# their package `exports` subpaths (e.g. `@test-cabinet/voxel-runtime/three`)
# resolve to missing type declarations and tsc fails. (voxel-runtime's `tsc -b`
# also builds its run-record dependency via a project reference.)
log "Building UI package dependencies (run-record, voxel-runtime)"
npm run build -w @test-cabinet/run-record
npm run build -w @test-cabinet/voxel-runtime

# The shipped app stands up its own k3d cluster, so it bundles k3d and kubectl as
# Tauri externalBin sidecars. Fetch the host-triple build of each into
# crates/desktop/binaries/ before the bundle runs (the committed config omits
# externalBin so a plain `cargo tauri build` needs no binaries — they are added via
# --config below).
log "Fetching cluster sidecars (k3d, kubectl) for $TARGET"
node scripts/fetch-desktop-sidecars.mjs "$TARGET"

# Build the .deb. Run from the crate that holds tauri.conf.json so the CLI resolves
# it. `--bundles` narrows the config's "all" targets to the Linux installer(s),
# skipping the flaky AppImage builder. `--config` adds the sidecar externalBin
# entries and — if VERSION is set — stamps the installer version.
# TCAB_DESKTOP_IMAGE_TAG (baked in at compile time) pins the GHCR service images
# the app pulls; it defaults to `latest` for local builds.
config='{"bundle":{"externalBin":["binaries/k3d","binaries/kubectl"]}}'
if [[ -n "${VERSION:-}" ]]; then
  version_number="${VERSION#v}"
  config="{\"version\":\"${version_number}\",\"bundle\":{\"externalBin\":[\"binaries/k3d\",\"binaries/kubectl\"]}}"
fi

log "Building desktop app (cargo tauri build --bundles $BUNDLES)"
( cd crates/desktop && cargo tauri build --bundles "$BUNDLES" --config "$config" )

# Point the user at the artifacts. Tauri writes them under target/release/bundle/.
log "Done. Artifacts:"
find target/release/bundle -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) -print 2>/dev/null || true

cat <<'NOTE'

Install the .deb with:

  sudo apt install ./<path-to>.deb      # or: sudo dpkg -i <path-to>.deb

To run it you need a container runtime (Docker or compatible) running — the app
stands up its own k3d cluster on launch.
NOTE
