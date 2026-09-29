#!/usr/bin/env bash
# Builds gg's release artifacts for this machine's architecture into a directory.
#
#   scripts/ci/gg-dist.sh <out-dir>
#
# Writes `gg-<target>`, the static musl gg for this architecture
# (x86_64-unknown-linux-musl or aarch64-unknown-linux-musl), and
# `gg-reference.tar.gz`, the reference documents `gg reference --out` projects, which a
# backend serves at /gg/reference. The documents hold nothing architecture-specific, so
# the two archives are byte-comparable; scripts/ci/publish-gg.sh uploads the x86_64 one
# under `v<version>/` by name.
#
# BOTH ARCHITECTURES PACK THEM, and the reason is that the documents are consumed
# per-architecture rather than once. The backend image bakes them at /opt/gg-reference and
# is built natively per architecture, so each architecture's service-image job needs a copy
# — scripts/ci/gg-prebuilt.sh stages this one. Packing on one architecture and projecting
# on the other is the arrangement that let `gg reference --out` fail on x86_64 alone and be
# found in an image build rather than in a gate. Projecting here makes the command a gate on
# every architecture that publishes a binary, for about four seconds and 220 KB.
#
# These are the objects scripts/ci/publish-gg.sh uploads under `v<version>/`, and the ones
# the backend and driver images consume through scripts/ci/gg-prebuilt.sh. gg's
# program-language toolchains (scripts/ci/install-gg-toolchains.sh and
# install-gg-build-toolchains.sh), `npm ci` and a musl C toolchain are prerequisites.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/gg-dist.sh <out-dir>" >&2
	exit 1
fi
out="$(mkdir -p "$1" && cd "$1" && pwd)"
readonly out

target="$(uname -m)-unknown-linux-musl"
readonly binary="${out}/gg-${target}"

log "building ${binary}"
./scripts/build-gg-static.sh "$binary"
"$binary" --version

log "packing gg's reference documents"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
"$binary" reference --out "${staging}/gg-reference"
tar -czf "${out}/gg-reference.tar.gz" -C "$staging" gg-reference

# The identity of what this published, recorded at the source. The binary's digest is what
# ties a service image's baked gg back to this build (gg-prebuilt.sh prints the same digest
# on the consuming side), and the document listing is what says the projection produced
# twelve non-empty documents rather than an empty directory.
log "what this architecture published"
ls -l "$out"
sha256sum "$binary"
tar -tzvf "${out}/gg-reference.tar.gz"
