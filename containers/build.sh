#!/usr/bin/env bash
# Builds The Test Cabinet run-container images: the shared base image first, then
# one image per agent harness FROM that base.
#
# Usage:
#   ./build.sh                # build the base and every harness image
#   ./build.sh claude codex   # build the base and only the named harness images
#
# Container images are distributed via a registry and pulled by the runner, which
# resolves them from its own registry configuration (TCAB_CONTAINER_REGISTRY /
# TCAB_CONTAINER_TAG / TCAB_CONTAINER_IMAGE_<HARNESS>; see
# docs/components/core/execution.md). The backend plays no part in container
# distribution, so this script never talks to it.
#
# With PUSH=1 the script pushes each built image to IMAGE_REGISTRY and prints the
# pushed digest reference. Without PUSH it just builds locally (the offline
# development path): images are named `test-cabinet-<name>:<tag>`, which is what a
# runner resolves when TCAB_CONTAINER_REGISTRY is set to an empty string.
#
# Configuration via environment variables:
#   PUSH          set to 1 to push images and pin them by digest (default: unset)
#   IMAGE_REGISTRY  registry/namespace pushed images live under, e.g.
#                 ghcr.io/theclockwyrks (required when PUSH=1). Matches the
#                 runner's default TCAB_CONTAINER_REGISTRY.
#   IMAGE_TAG     tag applied to every image (default: latest)
#   IMAGE_NAME_PREFIX  per-image name prefix (default: test-cabinet-); the base is
#                 IMAGE_NAME_PREFIXbase, a harness is IMAGE_NAME_PREFIX<harness>
#   DOCKER        container build command (default: docker; set to "podman"
#                 to build with Podman instead)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly PUSH="${PUSH:-}"
readonly IMAGE_REGISTRY="${IMAGE_REGISTRY:-}"
readonly IMAGE_TAG="${IMAGE_TAG:-latest}"
readonly IMAGE_NAME_PREFIX="${IMAGE_NAME_PREFIX:-test-cabinet-}"
readonly DOCKER="${DOCKER:-docker}"

# The supported harness slugs. These match the slugs used by the agent harness
# layer in crates/core and by the run records and site.
readonly ALL_HARNESSES=(claude codex cline antigravity goose kilo opencode pi)

# The local base tag every harness builds FROM (passed as a build arg). In
# build-only mode this is also the image left in the local store; in push mode it
# is an intermediate the registry image is then tagged from and pushed.
readonly BASE_IMAGE="${IMAGE_NAME_PREFIX}base:${IMAGE_TAG}"

# In push mode IMAGE_REGISTRY is required: a digest reference must be
# registry-qualified to be pullable by a runner.
if [[ -n "${PUSH}" && -z "${IMAGE_REGISTRY}" ]]; then
	echo "PUSH=1 requires IMAGE_REGISTRY (e.g. ghcr.io/theclockwyrks)" >&2
	exit 1
fi

# The fully-qualified registry repository for an image name (without a tag).
registry_repo() {
	local name="$1"
	echo "${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}"
}

# Push a locally-built image to the registry under a tag, then resolve and print
# its pushed digest reference (repo@sha256:...). The digest is read back from the
# pushed manifest so the reference pins exactly what landed in the registry.
push_and_pin() {
	local local_image="$1"
	local repo
	repo="$(registry_repo "$2")"
	local pushed="${repo}:${IMAGE_TAG}"

	echo "==> tagging ${local_image} as ${pushed}" >&2
	"$DOCKER" tag "${local_image}" "${pushed}"
	echo "==> pushing ${pushed}" >&2
	"$DOCKER" push "${pushed}" >&2

	# Resolve the pushed image's digest into a pullable repo@digest reference.
	local digest
	digest="$("$DOCKER" inspect --format '{{index .RepoDigests 0}}' "${pushed}")"
	if [[ -z "${digest}" ]]; then
		echo "could not resolve a pushed digest for ${pushed}" >&2
		exit 1
	fi
	echo "${digest}"
}

# In push mode, push one built image and print its pinned digest reference. In
# build-only mode this is a no-op (the local image is left in place). `name` is
# the registry image name component (e.g. `base` or a harness slug).
publish_image() {
	local local_image="$1"
	local name="$2"

	if [[ -z "${PUSH}" ]]; then
		return 0
	fi
	local reference
	reference="$(push_and_pin "${local_image}" "${name}")"
	echo "==> ${name} reference: ${reference}"
}

build_base() {
	echo "==> building ${BASE_IMAGE}"
	"$DOCKER" build -t "${BASE_IMAGE}" "${SCRIPT_DIR}/base"
	publish_image "${BASE_IMAGE}" "base"
}

build_harness() {
	local harness="$1"
	local dir="${SCRIPT_DIR}/${harness}"

	if [[ ! -f "${dir}/Dockerfile" ]]; then
		echo "unknown harness: ${harness} (no ${dir}/Dockerfile)" >&2
		exit 1
	fi

	local image="${IMAGE_NAME_PREFIX}${harness}:${IMAGE_TAG}"
	echo "==> building ${image}"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${image}" \
		"${dir}"
	publish_image "${image}" "${harness}"
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
