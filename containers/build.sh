#!/usr/bin/env bash
# Builds The Test Cabinet run-container images:
#   - the base image, which every end-to-end run executes in;
#   - the asset-generation image, which every asset-generation run executes in —
#     the base image plus the baked-in `draw` binary (`asset-gen/Dockerfile` is
#     `FROM` the base built here); and
#   - the adversarial image, which every adversarial run executes in — the base
#     image plus the Rust + `wasm32-unknown-unknown` toolchain so a model's
#     controller builds to wasm in-container (`adversarial/Dockerfile` is `FROM`
#     the base built here).
# None is a per-harness image: a run installs the selected harness's CLI into
# the image at run time (see `harnesses/README.md`).
#
# Usage:
#   ./build.sh                # build the base, asset-generation, and adversarial images
#
# The images are distributed via a registry and pulled by the runner, which
# resolves the one for a run's test type from its own registry configuration
# (TCAB_CONTAINER_REGISTRY / TCAB_CONTAINER_TAG, or a per-test-type override
# TCAB_CONTAINER_IMAGE_BASE / TCAB_CONTAINER_IMAGE_ASSET_GEN /
# TCAB_CONTAINER_IMAGE_ADVERSARIAL; see docs/components/core/execution.md). The
# backend plays no part in container distribution, so this script never talks to
# it.
#
# With PUSH=1 the script pushes each built image to IMAGE_REGISTRY and prints its
# pushed digest reference. Without PUSH it just builds locally (the offline
# development path): the images are named `test-cabinet-base:<tag>`,
# `test-cabinet-asset-gen:<tag>`, and `test-cabinet-adversarial:<tag>`, which is
# what a runner resolves when TCAB_CONTAINER_REGISTRY is set to an empty string.
#
# Configuration via environment variables:
#   PUSH          set to 1 to push the images and pin them by digest (default: unset)
#   IMAGE_REGISTRY  registry/namespace the pushed images live under, e.g.
#                 ghcr.io/theclockwyrks (required when PUSH=1). Matches the
#                 runner's default TCAB_CONTAINER_REGISTRY.
#   IMAGE_TAG     tag applied to the images (default: latest)
#   IMAGE_NAME_PREFIX  image name prefix (default: test-cabinet-); the base is
#                 IMAGE_NAME_PREFIXbase, the asset-generation image is
#                 IMAGE_NAME_PREFIXasset-gen, and the adversarial image is
#                 IMAGE_NAME_PREFIXadversarial
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

# The image tags left in the local store (build-only mode) or tagged from and
# pushed (push mode). The asset-generation and adversarial images are built `FROM`
# the local base tag below, so all three stay in lockstep within a single build.
readonly BASE_IMAGE="${IMAGE_NAME_PREFIX}base:${IMAGE_TAG}"
readonly ASSET_GEN_IMAGE="${IMAGE_NAME_PREFIX}asset-gen:${IMAGE_TAG}"
readonly ADVERSARIAL_IMAGE="${IMAGE_NAME_PREFIX}adversarial:${IMAGE_TAG}"

# In push mode IMAGE_REGISTRY is required: a digest reference must be
# registry-qualified to be pullable by a runner.
if [[ -n "${PUSH}" && -z "${IMAGE_REGISTRY}" ]]; then
	echo "PUSH=1 requires IMAGE_REGISTRY (e.g. ghcr.io/theclockwyrks)" >&2
	exit 1
fi

# Push a locally-built image to the registry under a tag, then resolve and print
# its pushed digest reference (repo@sha256:...). The digest is read back from the
# pushed manifest so the reference pins exactly what landed in the registry.
# Arguments: the local image tag, and the image's short name (e.g. base,
# asset-gen, adversarial) used to build its registry repository.
push_and_pin() {
	local local_image="$1"
	local name="$2"
	local repo="${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}"
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
	# The build context is the repository root (not just `base/`) so the build
	# stays consistent with the asset-generation build below, which needs the root
	# to compile `draw` from `crates/`. A repo-root `.dockerignore` keeps the
	# context lean (no target/, node_modules/).
	"$DOCKER" build -t "${BASE_IMAGE}" -f "${SCRIPT_DIR}/base/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${BASE_IMAGE}" base)"
		echo "==> base reference: ${reference}"
	fi
}

build_asset_gen() {
	echo "==> building ${ASSET_GEN_IMAGE} (FROM ${BASE_IMAGE})"
	# Built `FROM` the base image just built above (passed as the BASE_IMAGE build
	# arg, the local tag) plus the `draw` binary compiled from `crates/`, so the
	# build context is the repository root. Building from the local base tag avoids
	# a registry round-trip and keeps the asset-generation image pinned to the base
	# produced in this same invocation.
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${ASSET_GEN_IMAGE}" \
		-f "${SCRIPT_DIR}/asset-gen/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${ASSET_GEN_IMAGE}" asset-gen)"
		echo "==> asset-gen reference: ${reference}"
	fi
}

build_adversarial() {
	echo "==> building ${ADVERSARIAL_IMAGE} (FROM ${BASE_IMAGE})"
	# Built `FROM` the base image just built above (passed as the BASE_IMAGE build
	# arg, the local tag) plus the Rust + `wasm32-unknown-unknown` toolchain a
	# model's controller compiles to wasm with. The adversarial image bakes in no
	# binary of its own — the controller is built in-container at run time — so it
	# needs no repository context, but the build context stays the repository root
	# for consistency with the other images (a repo-root `.dockerignore` keeps it
	# lean). Building from the local base tag avoids a registry round-trip and keeps
	# the adversarial image pinned to the base produced in this same invocation.
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${ADVERSARIAL_IMAGE}" \
		-f "${SCRIPT_DIR}/adversarial/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${ADVERSARIAL_IMAGE}" adversarial)"
		echo "==> adversarial reference: ${reference}"
	fi
}

# The base must be built before the asset-generation and adversarial images,
# which are both `FROM` it.
build_base
build_asset_gen
build_adversarial
echo "==> done"
