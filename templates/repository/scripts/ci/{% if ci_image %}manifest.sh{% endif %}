#!/usr/bin/env bash
# Fuses the per-architecture tags of each named image into one multi-arch tag.
#
#   scripts/ci/manifest.sh <sha> <image>...
#
# For every <image>, a repository name under the registry,
# `<image>:<sha>-amd64` and `<image>:<sha>-arm64` become the manifest list
# `<image>:<sha>`, which is the tag a deployment pins. The list is assembled
# from registry references alone, so this needs no builder and pulls nothing.
# The pipeline runs it once both architectures have pushed, so `<sha>` never
# names a single-architecture image. The caller is already logged in to the
# registry. IMAGE_REGISTRY names another registry than the project's.
set -euo pipefail

if [[ $# -lt 2 ]]; then
	echo "usage: scripts/ci/manifest.sh <sha> <image>..." >&2
	exit 1
fi
readonly SHA="$1"
shift
readonly registry="${IMAGE_REGISTRY:-testcabinet.azurecr.io}"

for image in "$@"; do
	repo="${registry}/${image}"
	echo "manifest.sh: assembling ${repo}:${SHA} from :${SHA}-amd64 and :${SHA}-arm64"
	docker buildx imagetools create --tag "${repo}:${SHA}" \
		"${repo}:${SHA}-amd64" "${repo}:${SHA}-arm64"
	docker buildx imagetools inspect "${repo}:${SHA}"
done
