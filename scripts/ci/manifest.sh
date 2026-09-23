#!/usr/bin/env bash
# Fuses the per-architecture tags of each named image into one multi-arch tag.
#
#   scripts/ci/manifest.sh <sha> <image>...
#
# For every <image> (a repository name under the registry, e.g. tcab-backend or
# test-cabinet-base), `<image>:<sha>-amd64` and `<image>:<sha>-arm64` become the
# manifest list `<image>:<sha>`, which is the tag a deployment pins. The list is
# assembled from registry references alone, so this needs no builder and pulls
# nothing. It runs only once both architectures have pushed, so `<sha>` never names
# a single-architecture image. The caller is already logged in to the registry.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ $# -lt 2 ]]; then
	echo "usage: scripts/ci/manifest.sh <sha> <image>..." >&2
	exit 1
fi
readonly SHA="$1"
shift

for image in "$@"; do
	repo="${CI_REGISTRY}/${image}"
	log "assembling ${repo}:${SHA} from :${SHA}-amd64 and :${SHA}-arm64"
	docker buildx imagetools create --tag "${repo}:${SHA}" \
		"${repo}:${SHA}-amd64" "${repo}:${SHA}-arm64"
	docker buildx imagetools inspect "${repo}:${SHA}"
done
