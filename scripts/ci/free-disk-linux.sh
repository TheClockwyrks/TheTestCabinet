#!/usr/bin/env bash
# Reclaims disk on Microsoft-hosted Ubuntu agents before the Rust jobs build and
# cache their large cargo `target/`.
#
# The hosted ubuntu-24.04 image ships ~80% full with preinstalled SDKs this
# pipeline never touches (.NET, the Android SDK, Haskell/GHC, CodeQL bundles, and
# preloaded Docker images). The workspace's cargo `target/` on top tips `/` past
# the agent's 5% free-space monitor and — the failure this fixes — makes the
# "Cache cargo target" SAVE die when `tar` runs out of room mid-write
# ("Wrote only N of M bytes ... Error is not recoverable"). Deleting the unused
# toolchains frees ~24 GB (57G used -> 33G, leaving ~40G free).
#
# That reclaim alone is NOT sufficient and never was: `target/` reached ~36 GB, so
# the tree plus the tar the cache save writes beside it still ran the disk out.
# The other half of the fix is capping dev/test debug info to line tables
# (CARGO_PROFILE_DEV_DEBUG in azure-pipelines.yml), which takes `target/` to
# ~14 GB. Both are needed: keep this script when touching that setting.
#
# Azure-only and Linux-only: the paths are specific to the Microsoft-hosted
# Ubuntu image, so the Windows `binary` leg skips this (its step is gated on
# Agent.OS). The GitHub workflows have not hit this and are left alone. Every
# removal is best-effort — `rm -rf` ignores missing paths and the Docker prune is
# guarded — so a future image reshuffle can never turn this into a red build.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "disk before reclaim"
df -h /

# Unused language runtimes/SDKs and prebuilt tool bundles. These are the canonical
# large, safe-to-drop directories on the hosted Ubuntu image; none is a build
# dependency of the Rust crates or the contract codegen.
log "removing unused preinstalled toolchains"
sudo rm -rf \
	/usr/share/dotnet \
	/usr/local/lib/android \
	/opt/ghc \
	/usr/local/.ghcup \
	/opt/hostedtoolcache/CodeQL \
	/usr/local/share/powershell \
	/usr/local/share/chromium \
	/usr/local/share/boost

# Preloaded container images: this pipeline builds no containers (that lives in
# the GitHub build-service-images workflow), so the baked-in images are dead
# weight. Guarded so a missing daemon or empty image list never fails the step.
log "pruning preloaded Docker images"
sudo docker image prune --all --force || true

log "disk after reclaim"
df -h /
