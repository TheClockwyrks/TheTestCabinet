#!/usr/bin/env bash
# Builds The Test Cabinet run-container images: the shared base image first, then
# one image per agent harness FROM that base.
#
# Usage:
#   ./build.sh                # build the base and every harness image
#   ./build.sh claude codex   # build the base and only the named harness images
#
# Configuration via environment variables:
#   IMAGE_PREFIX  image namespace            (default: test-cabinet)
#   IMAGE_TAG     tag applied to every image (default: latest)
#   DOCKER        container build command    (default: docker; set to "podman"
#                 to build with Podman instead)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly IMAGE_PREFIX="${IMAGE_PREFIX:-test-cabinet}"
readonly IMAGE_TAG="${IMAGE_TAG:-latest}"
readonly DOCKER="${DOCKER:-docker}"

# The supported harness slugs. These match the slugs used by the agent harness
# layer in crates/core and by the run records and site.
readonly ALL_HARNESSES=(claude codex cline antigravity goose kilo opencode pi)

readonly BASE_IMAGE="${IMAGE_PREFIX}/base:${IMAGE_TAG}"

build_base() {
	echo "==> building ${BASE_IMAGE}"
	"$DOCKER" build -t "${BASE_IMAGE}" "${SCRIPT_DIR}/base"
}

build_harness() {
	local harness="$1"
	local dir="${SCRIPT_DIR}/${harness}"

	if [[ ! -f "${dir}/Dockerfile" ]]; then
		echo "unknown harness: ${harness} (no ${dir}/Dockerfile)" >&2
		exit 1
	fi

	local image="${IMAGE_PREFIX}/${harness}:${IMAGE_TAG}"
	echo "==> building ${image}"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${image}" \
		"${dir}"
}

main() {
	build_base

	local harnesses=("$@")
	if [[ ${#harnesses[@]} -eq 0 ]]; then
		harnesses=("${ALL_HARNESSES[@]}")
	fi

	for harness in "${harnesses[@]}"; do
		build_harness "${harness}"
	done

	echo "==> done"
}

main "$@"
