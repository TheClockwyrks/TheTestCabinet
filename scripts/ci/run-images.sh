#!/usr/bin/env bash
# Builds every run-container image for this machine's architecture and pushes each
# to the registry as `test-cabinet-<name>:<sha>-<arch>`.
#
#   scripts/ci/run-images.sh <gg-binary> <sha>
#
# The images are the ones containers/image-names.sh lists, which is the set a run
# resolves, plus the gg toolchain builder the `-gg` variants copy out of. They are
# built by containers/build.sh with `--gg-selfcheck`, which drives `gg selfcheck`
# inside each `-gg` environment representative between its build and its push, so a
# variant carrying a dead language arm never reaches the registry. <gg-binary> is the
# static gg the pipeline built for this architecture.
#
# The build is native: the pipeline runs this once on an amd64 agent and once on an
# arm64 agent, and scripts/ci/manifest.sh fuses the arch tags into the multi-arch
# `<sha>` that TCAB_CONTAINER_TAG pins. The audio store is built by its own job
# (`containers/build.sh audio-store`), because the driver image needs it before the
# run images are done. The caller is already logged in to the registry.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/run-images.sh <gg-binary> <sha>" >&2
	exit 1
fi
readonly GG_BINARY="$1"
readonly SHA="$2"

arch="$(ci_arch)"
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

mapfile -t names < <(./containers/image-names.sh)

log "building ${#names[@]} run images as ${CI_REGISTRY}/test-cabinet-<name>:${SHA}-${arch}"
PUSH=1 IMAGE_REGISTRY="$CI_REGISTRY" IMAGE_TAG="${SHA}-${arch}" \
	./containers/build.sh --gg-selfcheck "$GG_BINARY" "${names[@]}" 2>&1 | tee "$log_file"

# The self-check has to have run, not merely have been asked for. A refactor that
# drops the flag above would still build and push every image, so each environment
# representative's `gg selfcheck ok:` line is required by name. The names are written
# out rather than read from build.sh, because a list derived from the thing under test
# would agree with it however wrong it became.
for image in sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg; do
	if ! grep -Fq "gg selfcheck ok: ${image}" "$log_file"; then
		echo "run-images.sh: containers/build.sh pushed without running gg selfcheck in ${image}." >&2
		echo "Restore --gg-selfcheck on the build above; see containers/build.sh's header." >&2
		exit 1
	fi
	echo "gg selfcheck ran in ${image}"
done
