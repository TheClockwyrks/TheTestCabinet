#!/usr/bin/env bash
# Builds The Test Cabinet run-container images: the shared base image first, then
# one image per agent harness FROM that base.
#
# Usage:
#   ./build.sh                # build the base and every harness image
#   ./build.sh claude codex   # build the base and only the named harness images
#
# Container images are distributed via a registry and pulled by digest. With
# PUSH=1 the script pushes each built image and pins it by its pushed digest,
# prints the resulting reference, and (when TCAB_BACKEND_URL is set) POSTs
# { harness, reference } to the backend's /containers endpoint so runners can
# resolve and pull it. Without PUSH the script just builds locally (the offline
# development path), tagging under the local IMAGE_PREFIX.
#
# Configuration via environment variables:
#   PUSH          set to 1 to push images and pin them by digest (default: unset)
#   IMAGE_REGISTRY  registry/namespace pushed images live under, e.g.
#                 ghcr.io/theclockwyrks (required when PUSH=1)
#   IMAGE_PREFIX  local image namespace for build-only mode (default: test-cabinet)
#   IMAGE_TAG     tag applied to every image (default: latest)
#   IMAGE_NAME_PREFIX  per-image name prefix in the registry
#                 (default: test-cabinet-); the base is IMAGE_NAME_PREFIXbase,
#                 a harness is IMAGE_NAME_PREFIX<harness>
#   TCAB_BACKEND_URL  when set under PUSH=1, the backend each pushed reference is
#                 POSTed to (its /containers endpoint)
#   DOCKER        container build command (default: docker; set to "podman"
#                 to build with Podman instead)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly PUSH="${PUSH:-}"
readonly IMAGE_REGISTRY="${IMAGE_REGISTRY:-}"
readonly IMAGE_PREFIX="${IMAGE_PREFIX:-test-cabinet}"
readonly IMAGE_TAG="${IMAGE_TAG:-latest}"
readonly IMAGE_NAME_PREFIX="${IMAGE_NAME_PREFIX:-test-cabinet-}"
readonly DOCKER="${DOCKER:-docker}"

# The supported harness slugs. These match the slugs used by the agent harness
# layer in crates/core and by the run records and site.
readonly ALL_HARNESSES=(claude codex cline antigravity goose kilo opencode pi)

# The local base tag every harness builds FROM (passed as a build arg). In
# build-only mode this is also the image left in the local store; in push mode it
# is an intermediate the registry image is then tagged from and pushed.
readonly BASE_IMAGE="${IMAGE_PREFIX}/base:${IMAGE_TAG}"

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

# POST { harness, reference } to the backend's /containers endpoint, when a
# backend URL is configured. The backend trusts every caller that can reach it
# (private-network model), so no auth header is attached.
post_reference() {
	local harness="$1"
	local reference="$2"
	if [[ -z "${TCAB_BACKEND_URL:-}" ]]; then
		return 0
	fi
	echo "==> POST ${harness} -> ${TCAB_BACKEND_URL%/}/containers" >&2
	curl -fsS -X POST "${TCAB_BACKEND_URL%/}/containers" \
		-H "Content-Type: application/json" \
		-d "{\"harness\":\"${harness}\",\"reference\":\"${reference}\"}" >&2
}

# Build (and in push mode push + register) one image. `name` is the registry
# image name component (e.g. `base` or a harness slug); `harness` is the slug
# registered with the backend, or empty for the shared base (which is not a
# harness and is never registered).
build_image() {
	local local_image="$1"
	local name="$2"
	local harness="$3"

	if [[ -z "${PUSH}" ]]; then
		return 0
	fi
	local reference
	reference="$(push_and_pin "${local_image}" "${name}")"
	echo "==> ${name} reference: ${reference}"
	if [[ -n "${harness}" ]]; then
		post_reference "${harness}" "${reference}"
	fi
}

build_base() {
	echo "==> building ${BASE_IMAGE}"
	"$DOCKER" build -t "${BASE_IMAGE}" "${SCRIPT_DIR}/base"
	# The base is the shared FROM image, not a harness; it is pushed (so harness
	# images can build FROM the registry copy if desired) but not registered as a
	# pullable harness reference.
	build_image "${BASE_IMAGE}" "base" ""
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
	build_image "${image}" "${harness}" "${harness}"
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
