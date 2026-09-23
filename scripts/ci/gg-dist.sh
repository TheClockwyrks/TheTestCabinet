#!/usr/bin/env bash
# Builds gg's release artifacts for this machine's architecture into a directory.
#
#   scripts/ci/gg-dist.sh <out-dir>
#
# Writes `gg-<target>`, the static musl gg for this architecture
# (x86_64-unknown-linux-musl or aarch64-unknown-linux-musl). On x86_64 it also writes
# `gg-reference.tar.gz`, the reference documents `gg reference --out` projects, which
# a backend serves at /gg/reference. The documents hold nothing architecture-specific,
# so one architecture publishes them.
#
# These are the objects scripts/ci/publish-gg.sh uploads under `v<version>/`. gg's
# program-language toolchains (scripts/ci/install-gg-toolchains.sh and
# install-gg-build-toolchains.sh), `npm ci` and a musl C toolchain are prerequisites.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

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

if [[ "$(uname -m)" == x86_64 ]]; then
	log "packing gg's reference documents"
	staging="$(mktemp -d)"
	trap 'rm -rf "$staging"' EXIT
	"$binary" reference --out "${staging}/gg-reference"
	tar -czf "${out}/gg-reference.tar.gz" -C "$staging" gg-reference
fi

ls -l "$out"
