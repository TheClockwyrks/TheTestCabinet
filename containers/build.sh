#!/usr/bin/env bash
# Builds The Test Cabinet run-container images:
#   - the base image, which every end-to-end run executes in;
#   - the sprite image, which every single-sprite asset-generation run
#     (`asset_kind = "sprite"`) executes in — the base image plus the baked-in
#     `draw` binary (`sprite/Dockerfile` is `FROM` the base built here);
#   - the sprite-sheet image, which every sprite-sheet asset-generation run
#     (`asset_kind = "sprite-sheet"`) executes in — the base image plus the
#     baked-in `draw-sheet` binary (`sprite-sheet/Dockerfile` is `FROM` the base);
#     and
#   - the voxel image, which every static voxel-model asset-generation run
#     (`asset_kind = "voxel-model"`) executes in — the base image plus the
#     baked-in `voxel` binary (`voxel/Dockerfile` is `FROM` the base); and
#   - the voxel-animation image, which every animated voxel-animation
#     asset-generation run (`asset_kind = "voxel-animation"`) executes in — the
#     base image plus the baked-in `voxel-anim` binary (`voxel-animation/Dockerfile`
#     is `FROM` the base); and
#   - the six surface-extraction meshing images — mc / mc-animation (Marching
#     Cubes), sn / sn-animation (Surface Nets), and dc / dc-animation (Dual
#     Contouring) — which every meshing asset-generation run executes in
#     (`asset_kind = "mc-model"`/`"mc-animation"`/`"sn-model"`/`"sn-animation"`/
#     `"dc-model"`/`"dc-animation"`): the base image plus the baked-in meshing
#     binary (`mc`/`mc-anim`/`sn`/`sn-anim`/`dc`/`dc-anim`) and the Mesa
#     software-Vulkan (lavapipe) runtime the previews render with (each
#     `<name>/Dockerfile` is `FROM` the base); and
#   - the adversarial image, which every adversarial run executes in — the base
#     image plus the Rust + `wasm32-unknown-unknown` toolchain (so a model's
#     controller builds to wasm in-container) and the Foray tooling compiled from
#     `crates/`: the baked-in `foray` CLI, the controller buildkit, and the
#     reference modules + map (`adversarial/Dockerfile` is `FROM` the base here);
#     and
#   - the performance image, which every performance run executes in — the base
#     image plus the Rust + `wasm32-unknown-unknown` toolchain and the Lattice
#     tooling compiled from `crates/`: the baked-in `lattice` CLI, the engine
#     buildkit, the reference engines, and the committed training scenarios
#     (`performance/Dockerfile` is `FROM` the base here).
# None is a per-harness image: a run installs the selected harness's CLI into the
# image at run time (see `harnesses/README.md`).
#
# Usage:
#   ./build.sh                # build all images (the base, every asset-generation kind, adversarial, and performance)
#
# The images are distributed via a registry and pulled by the runner, which
# resolves the one for a run's test type and asset kind from its own registry
# configuration (TCAB_CONTAINER_REGISTRY / TCAB_CONTAINER_TAG, or a per-image
# override TCAB_CONTAINER_IMAGE_BASE / TCAB_CONTAINER_IMAGE_SPRITE /
# TCAB_CONTAINER_IMAGE_SPRITE_SHEET / TCAB_CONTAINER_IMAGE_VOXEL /
# TCAB_CONTAINER_IMAGE_VOXEL_ANIMATION / TCAB_CONTAINER_IMAGE_MC /
# TCAB_CONTAINER_IMAGE_MC_ANIMATION / TCAB_CONTAINER_IMAGE_SN /
# TCAB_CONTAINER_IMAGE_SN_ANIMATION / TCAB_CONTAINER_IMAGE_DC /
# TCAB_CONTAINER_IMAGE_DC_ANIMATION / TCAB_CONTAINER_IMAGE_ADVERSARIAL /
# TCAB_CONTAINER_IMAGE_PERFORMANCE; see
# docs/components/core/execution.md). The
# backend plays no part in container distribution, so this script never talks to
# it.
#
# With PUSH=1 the script pushes each built image to IMAGE_REGISTRY and prints its
# pushed digest reference. Without PUSH it just builds locally (the offline
# development path): the images are named `test-cabinet-base:<tag>`,
# `test-cabinet-sprite:<tag>`, `test-cabinet-sprite-sheet:<tag>`,
# `test-cabinet-voxel:<tag>`, `test-cabinet-voxel-animation:<tag>`,
# `test-cabinet-mc:<tag>`, `test-cabinet-mc-animation:<tag>`,
# `test-cabinet-sn:<tag>`, `test-cabinet-sn-animation:<tag>`,
# `test-cabinet-dc:<tag>`, `test-cabinet-dc-animation:<tag>`,
# `test-cabinet-adversarial:<tag>`, and `test-cabinet-performance:<tag>`, which is
# what a runner resolves when TCAB_CONTAINER_REGISTRY is set to an empty string.
#
# Configuration via environment variables:
#   PUSH          set to 1 to push the images and pin them by digest (default: unset)
#   IMAGE_REGISTRY  registry/namespace the pushed images live under, e.g.
#                 ghcr.io/theclockwyrks (required when PUSH=1). Matches the
#                 runner's default TCAB_CONTAINER_REGISTRY.
#   IMAGE_TAG     tag applied to the images (default: latest)
#   IMAGE_NAME_PREFIX  image name prefix (default: test-cabinet-); the base is
#                 IMAGE_NAME_PREFIXbase, the sprite image is
#                 IMAGE_NAME_PREFIXsprite, the sprite-sheet image is
#                 IMAGE_NAME_PREFIXsprite-sheet, the voxel image is
#                 IMAGE_NAME_PREFIXvoxel, the voxel-animation image is
#                 IMAGE_NAME_PREFIXvoxel-animation, the six meshing images are
#                 IMAGE_NAME_PREFIX{mc,mc-animation,sn,sn-animation,dc,dc-animation},
#                 the adversarial image is IMAGE_NAME_PREFIXadversarial, and the
#                 performance image is IMAGE_NAME_PREFIXperformance
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

# The base, adversarial, and performance image tags left in the local store
# (build-only mode) or tagged from and pushed (push mode). The sprite,
# sprite-sheet, adversarial, and performance images are each built `FROM` the local
# base tag below, so they stay in lockstep with the base within a single build. The
# sprite and sprite-sheet tags are composed inline by `build_asset_image`; only the
# base, adversarial, and performance tags are referenced by name here.
readonly BASE_IMAGE="${IMAGE_NAME_PREFIX}base:${IMAGE_TAG}"
readonly ADVERSARIAL_IMAGE="${IMAGE_NAME_PREFIX}adversarial:${IMAGE_TAG}"
readonly PERFORMANCE_IMAGE="${IMAGE_NAME_PREFIX}performance:${IMAGE_TAG}"

# In push mode IMAGE_REGISTRY is required: a digest reference must be
# registry-qualified to be pullable by a runner.
if [[ -n "${PUSH}" && -z "${IMAGE_REGISTRY}" ]]; then
	echo "PUSH=1 requires IMAGE_REGISTRY (e.g. ghcr.io/theclockwyrks)" >&2
	exit 1
fi

# Push a locally-built image to the registry under a tag, then resolve and print
# its pushed digest reference (repo@sha256:...). The digest is read back from the
# pushed manifest so the reference pins exactly what landed in the registry.
# Arguments: the local image tag, and the image's short name (e.g. base, sprite,
# sprite-sheet, adversarial) used to build its registry repository.
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
	# stays consistent with the asset-generation builds below, which need the root
	# to compile the drawing binaries from `crates/`. A repo-root `.dockerignore`
	# keeps the context lean (no target/, node_modules/).
	"$DOCKER" build -t "${BASE_IMAGE}" -f "${SCRIPT_DIR}/base/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${BASE_IMAGE}" base)"
		echo "==> base reference: ${reference}"
	fi
}

# Build one asset-generation image `FROM` the base built above plus a drawing
# binary compiled from `crates/`. The argument is the image's short name
# (`sprite` / `sprite-sheet` / `voxel` / `voxel-animation` / `mc` / `mc-animation`
# / `sn` / `sn-animation` / `dc` / `dc-animation`), which is both its name suffix
# and the directory holding its Dockerfile. The build context is the
# repository root so the compile
# stage can see `crates/`; building from the local base tag avoids a registry
# round-trip and keeps the image pinned to the base produced in this invocation.
build_asset_image() {
	local name="$1"
	local image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	echo "==> building ${image} (FROM ${BASE_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/${name}/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" "${name}")"
		echo "==> ${name} reference: ${reference}"
	fi
}

# Build an audio image (sfx-sample / music) that bakes a content-addressed audio
# pack. Unlike a plain asset image, the pack is fetched from the private R2 bucket at
# build time: this resolves the pack's pinned digest + object key from
# `containers/sample-packs/packs.lock.json`, mints a SHORT-LIVED presigned R2 GET URL
# for it (needs the read-only PRESIGN credentials in the environment — see
# `scripts/lib/r2.mjs`), and passes the pack ref, that URL, and the digest as build
# args. The Dockerfile's `ADD --checksum` then pulls + verifies the tarball; no
# credential ever enters an image layer.
#
# The pack MUST be published: a missing pin, or a presign that fails (missing creds,
# no node), is a HARD error that fails the build — an audio image is never shipped
# with an empty palette. Publish a pack with `node scripts/build-sample-pack.mjs
# <pack> --publish` and commit the pin before building its image.
#
# Arguments: <image-name> <pack-ref> <pack-arg> <url-arg> <sha-arg>.
build_audio_image() {
	local name="$1" pack_ref="$2" pack_arg="$3" url_arg="$4" sha_arg="$5"
	local image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	local lock="${SCRIPT_DIR}/sample-packs/packs.lock.json"

	# A missing pin is a hard error (not a skip): the pack must be published first.
	if [[ ! -f "${lock}" ]] || ! grep -q "\"${pack_ref}\"" "${lock}"; then
		echo "ERROR: cannot build ${image}: pack ${pack_ref} is not published (no pin in ${lock#"${SCRIPT_DIR}/"})." >&2
		echo "       Publish it with: node scripts/build-sample-pack.mjs <pack> --publish" >&2
		exit 1
	fi

	# Presign a download URL from the pin. The helper prints two lines: URL, then digest.
	local presign
	if ! presign="$(node "${SCRIPT_DIR}/../scripts/presign-sample-pack.mjs" "${pack_ref}")"; then
		echo "ERROR: ${pack_ref} is pinned but presigning failed (need node + the PRESIGN R2 credentials)." >&2
		exit 1
	fi
	local lines
	mapfile -t lines <<<"${presign}"
	local url="${lines[0]}" sha="${lines[1]}"

	echo "==> building ${image} (FROM ${BASE_IMAGE}) with ${pack_arg}=${pack_ref}"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		--build-arg "${pack_arg}=${pack_ref}" \
		--build-arg "${url_arg}=${url}" \
		--build-arg "${sha_arg}=${sha}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/${name}/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" "${name}")"
		echo "==> ${name} reference: ${reference}"
	fi
}

build_adversarial() {
	echo "==> building ${ADVERSARIAL_IMAGE} (FROM ${BASE_IMAGE})"
	# Built `FROM` the base image just built above (passed as the BASE_IMAGE build
	# arg, the local tag) plus the Rust + `wasm32-unknown-unknown` toolchain a
	# model's controller compiles to wasm with, AND the Foray tooling the image's
	# first stage compiles from `crates/`: the `foray` CLI, the controller buildkit
	# (`foray-core` + `foray-controller-sdk`), and the reference wasm modules + map.
	# Like the asset-generation images it therefore needs the repository root as its
	# build context (a repo-root `.dockerignore` keeps it lean). Building from the
	# local base tag avoids a registry round-trip and keeps the adversarial image
	# pinned to the base produced in this same invocation.
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

build_performance() {
	echo "==> building ${PERFORMANCE_IMAGE} (FROM ${BASE_IMAGE})"
	# Built `FROM` the base image just built above (passed as the BASE_IMAGE build
	# arg, the local tag) plus the Rust + `wasm32-unknown-unknown` toolchain a
	# model's engine compiles to wasm with, AND the Lattice tooling the image's
	# first stage compiles from `crates/`: the `lattice` CLI, the engine buildkit
	# (`lattice-core` + `lattice-sdk`), and the reference engine wasm modules. It
	# also bakes the committed training scenarios from the case's version folder
	# under `test-cases/`. Like the adversarial image it therefore needs the
	# repository root as its build context (a repo-root `.dockerignore` keeps it
	# lean). Building from the local base tag avoids a registry round-trip and keeps
	# the performance image pinned to the base produced in this same invocation.
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${PERFORMANCE_IMAGE}" \
		-f "${SCRIPT_DIR}/performance/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${PERFORMANCE_IMAGE}" performance)"
		echo "==> performance reference: ${reference}"
	fi
}

# The base must be built before the sprite, sprite-sheet, voxel, voxel-animation,
# mc, mc-animation, sn, sn-animation, dc, dc-animation, adversarial, and
# performance images, which are all `FROM` it.
build_base
build_asset_image sprite
build_asset_image sprite-sheet
build_asset_image voxel
build_asset_image voxel-animation
build_asset_image mc
build_asset_image mc-animation
build_asset_image sn
build_asset_image sn-animation
build_asset_image dc
build_asset_image dc-animation
build_asset_image ui
build_asset_image material
build_asset_image mc-skinned
build_asset_image sn-skinned
build_asset_image dc-skinned
build_asset_image particle-2d
build_asset_image particle-3d
build_asset_image sfx-synth
# The sfx-sample (and, once a real instrument bank exists, music) image bakes a
# content-addressed audio pack pulled from the private R2 bucket at build time (see
# build_audio_image). The pack ref must match the SAMPLE_PACK default in the
# Dockerfile and be published + pinned in packs.lock.json first.
build_audio_image sfx-sample combat-core@0.1.0 SAMPLE_PACK SAMPLE_PACK_URL SAMPLE_PACK_SHA256
# The music image is deferred: its gm-lite instrument bank is a placeholder EXAMPLE
# (no real sources) and cannot be published. Author + publish a real bank, then add:
#   build_audio_image music <bank>@<ver> INSTRUMENT_BANK INSTRUMENT_BANK_URL INSTRUMENT_BANK_SHA256
build_adversarial
build_performance
echo "==> done"
