#!/usr/bin/env bash
# Builds The Test Cabinet run-container image: the single shared base image every
# run executes in. There is no longer a per-harness image — a run installs the
# selected harness's CLI into this base image at run time (see
# `harnesses/README.md`), so this script builds and publishes only the base.
#
# Usage:
#   ./build.sh                # build the base image
#
# The image is distributed via a registry and pulled by the runner, which
# resolves it from its own registry configuration (TCAB_CONTAINER_REGISTRY /
# TCAB_CONTAINER_TAG / TCAB_CONTAINER_IMAGE; see
# docs/components/core/execution.md). The backend plays no part in container
# distribution, so this script never talks to it.
#
# With PUSH=1 the script pushes the built image to IMAGE_REGISTRY and prints the
# pushed digest reference. Without PUSH it just builds locally (the offline
# development path): the image is named `test-cabinet-base:<tag>`, which is what a
# runner resolves when TCAB_CONTAINER_REGISTRY is set to an empty string.
#
# Configuration via environment variables:
#   PUSH          set to 1 to push the image and pin it by digest (default: unset)
#   IMAGE_REGISTRY  registry/namespace the pushed image lives under, e.g.
#                 ghcr.io/theclockwyrks (required when PUSH=1). Matches the
#                 runner's default TCAB_CONTAINER_REGISTRY.
#   IMAGE_TAG     tag applied to the image (default: latest)
#   IMAGE_NAME_PREFIX  image name prefix (default: test-cabinet-); the base is
#                 IMAGE_NAME_PREFIXbase
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

# The base image tag left in the local store (build-only mode) or tagged from and
# pushed (push mode).
readonly BASE_IMAGE="${IMAGE_NAME_PREFIX}base:${IMAGE_TAG}"

# In push mode IMAGE_REGISTRY is required: a digest reference must be
# registry-qualified to be pullable by a runner.
if [[ -n "${PUSH}" && -z "${IMAGE_REGISTRY}" ]]; then
	echo "PUSH=1 requires IMAGE_REGISTRY (e.g. ghcr.io/theclockwyrks)" >&2
	exit 1
fi

# Push the locally-built base image to the registry under a tag, then resolve and
# print its pushed digest reference (repo@sha256:...). The digest is read back
# from the pushed manifest so the reference pins exactly what landed in the
# registry.
push_and_pin() {
	local local_image="$1"
	local repo="${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}base"
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

build_base() {
	echo "==> building ${BASE_IMAGE}"
	"$DOCKER" build -t "${BASE_IMAGE}" "${SCRIPT_DIR}/base"

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${BASE_IMAGE}")"
		echo "==> base reference: ${reference}"
	fi
}

build_base
echo "==> done"
