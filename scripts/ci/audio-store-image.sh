#!/usr/bin/env bash
# Builds the audio store for this machine's architecture and pushes it to the
# registry as `test-cabinet-audio-store:<sha>-<arch>`.
#
#   scripts/ci/audio-store-image.sh <sha>
#
# The audio store is every published audio pack as a data-only image, which the
# driver image bakes and a run's declared packs are staged out of. Staging it
# downloads each clip from the audio object store through presigned read URLs and
# verifies it against containers/sample-packs/objects.lock.json, so it needs
# CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AUDIO_R2_BUCKET,
# CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID and
# CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY in the environment, and `npm ci`.
#
# It is built on its own, ahead of the run images, because the driver's service
# image copies it in. scripts/ci/manifest.sh fuses the two arch tags into
# `test-cabinet-audio-store:<sha>`. The caller is already logged in to the registry.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/audio-store-image.sh <sha>" >&2
	exit 1
fi
readonly SHA="$1"

PUSH=1 IMAGE_REGISTRY="$CI_REGISTRY" IMAGE_TAG="${SHA}-$(ci_arch)" \
	./containers/build.sh audio-store
