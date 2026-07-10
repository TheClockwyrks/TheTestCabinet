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
#   ./build.sh <name>...      # build ONLY the named images (e.g. `./build.sh voxel-animation`,
#                             #   `./build.sh adversarial performance`). Names are the short
#                             #   image names (the IMAGE_NAME_PREFIX suffix / the containers/<name>
#                             #   directory). The FROM-base invariant is upheld either way: `base`
#                             #   is (re)built when it is named, and auto-built when a non-base
#                             #   image is named but no base image is present locally yet. This is
#                             #   how deployments/local/Makefile rebuilds one test type — or one
#                             #   asset-generation kind — without paying for the whole set.
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

# Build the 2D full-stack image: the base plus the six 2D asset-generation binaries
# (draw, draw-sheet, particle-2d, sfx-synth, sfx-sample, music) AND the two audio packs
# those tools need (the combat-core sample pack for `sfx-sample`, the gm-lite instrument
# bank for `music`). It is the union of a plain asset image and BOTH audio images, so it
# presigns two content-addressed packs from the private R2 bucket at build time (see
# build_audio_image for the mechanism and credentials) and passes both — plus the base —
# to the one Dockerfile. Like the audio images, a missing pin or a failed presign for
# EITHER pack is a HARD error: a full-stack image is never shipped with an empty audio
# palette. Publish a pack with `node scripts/build-sample-pack.mjs <pack> --publish` and
# commit the pin before building this image.
build_full_stack_2d() {
	local image="${IMAGE_NAME_PREFIX}full-stack-2d:${IMAGE_TAG}"
	local lock="${SCRIPT_DIR}/sample-packs/packs.lock.json"
	local sample_ref="combat-core@0.1.0" bank_ref="gm-lite@0.1.0"

	# Both packs must be pinned (not a skip): the image bakes both.
	local ref
	for ref in "${sample_ref}" "${bank_ref}"; do
		if [[ ! -f "${lock}" ]] || ! grep -q "\"${ref}\"" "${lock}"; then
			echo "ERROR: cannot build ${image}: pack ${ref} is not published (no pin in ${lock#"${SCRIPT_DIR}/"})." >&2
			echo "       Publish it with: node scripts/build-sample-pack.mjs <pack> --publish" >&2
			exit 1
		fi
	done

	# Presign a download URL + digest for each pack (two lines each: URL, then digest).
	local presign lines
	if ! presign="$(node "${SCRIPT_DIR}/../scripts/presign-sample-pack.mjs" "${sample_ref}")"; then
		echo "ERROR: ${sample_ref} is pinned but presigning failed (need node + the PRESIGN R2 credentials)." >&2
		exit 1
	fi
	mapfile -t lines <<<"${presign}"
	local sample_url="${lines[0]}" sample_sha="${lines[1]}"
	if ! presign="$(node "${SCRIPT_DIR}/../scripts/presign-sample-pack.mjs" "${bank_ref}")"; then
		echo "ERROR: ${bank_ref} is pinned but presigning failed (need node + the PRESIGN R2 credentials)." >&2
		exit 1
	fi
	mapfile -t lines <<<"${presign}"
	local bank_url="${lines[0]}" bank_sha="${lines[1]}"

	echo "==> building ${image} (FROM ${BASE_IMAGE}) with ${sample_ref} + ${bank_ref}"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		--build-arg "SAMPLE_PACK=${sample_ref}" \
		--build-arg "SAMPLE_PACK_URL=${sample_url}" \
		--build-arg "SAMPLE_PACK_SHA256=${sample_sha}" \
		--build-arg "INSTRUMENT_BANK=${bank_ref}" \
		--build-arg "INSTRUMENT_BANK_URL=${bank_url}" \
		--build-arg "INSTRUMENT_BANK_SHA256=${bank_sha}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/full-stack-2d/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" full-stack-2d)"
		echo "==> full-stack-2d reference: ${reference}"
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

# Build the Blender character image. UNLIKE every other run image, this one is NOT built
# `FROM` the shared base: it is a self-contained `ubuntu:26.04` image (see
# `containers/blender/Dockerfile` for why — Ubuntu is the only distro shipping a modern,
# arch-parity Blender via `apt` on the aarch64 hosts this project runs on). So it takes no
# `BASE_IMAGE` build arg and does not depend on the base being built first. The build
# context is still the repository root so its `COPY` lines can see `containers/blender/`.
build_blender() {
	local image="${IMAGE_NAME_PREFIX}blender:${IMAGE_TAG}"
	echo "==> building ${image} (self-contained; FROM ubuntu:26.04, NOT the base)"
	"$DOCKER" build \
		-t "${image}" \
		-f "${SCRIPT_DIR}/blender/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" blender)"
		echo "==> blender reference: ${reference}"
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

# Build one image by its short name, dispatching to the right builder: the audio
# images (sfx-sample/music) carry their pack ref + build-arg names; base,
# adversarial, and performance have dedicated builders; everything else is a plain
# asset-generation image built `FROM` the base.
build_one() {
	case "$1" in
		base)         build_base ;;
		adversarial)  build_adversarial ;;
		performance)  build_performance ;;
		# The full-stack-2d image bakes six binaries AND two content-addressed audio
		# packs pulled from the private R2 bucket at build time (see
		# build_full_stack_2d). Both packs must be published + pinned first.
		full-stack-2d) build_full_stack_2d ;;
		# The sfx-sample and music images bake a content-addressed audio pack pulled
		# from the private R2 bucket at build time (see build_audio_image). Each pack
		# ref must match the SAMPLE_PACK / INSTRUMENT_BANK default in its Dockerfile and
		# be published + pinned in packs.lock.json first.
		sfx-sample)   build_audio_image sfx-sample combat-core@0.1.0 SAMPLE_PACK SAMPLE_PACK_URL SAMPLE_PACK_SHA256 ;;
		music)        build_audio_image music gm-lite@0.1.0 INSTRUMENT_BANK INSTRUMENT_BANK_URL INSTRUMENT_BANK_SHA256 ;;
		# The Blender character image is self-contained (FROM ubuntu:26.04, NOT the base),
		# so it has its own builder and takes no BASE_IMAGE arg — see build_blender.
		blender)      build_blender ;;
		# Every other name is a plain asset-generation image `FROM` the base.
		*)            build_asset_image "$1" ;;
	esac
}

# The full set of images, in dependency order (base first — every other image is
# `FROM` it). With no arguments the script builds all of them; with arguments it
# builds only the named subset.
ALL_NAMES=(
	base
	full-stack-2d
	sprite sprite-sheet
	voxel voxel-animation
	mc mc-animation sn sn-animation dc dc-animation
	ui material
	mc-skinned sn-skinned dc-skinned
	blender
	particle-2d particle-3d
	sfx-synth sfx-sample music
	adversarial performance
)

# Whether an image tag is present in the local image store (used to decide whether
# the FROM base has to be built before a selected non-base image).
image_present() { "$DOCKER" image inspect "$1" >/dev/null 2>&1; }

# Resolve the selection: no args → everything; otherwise exactly the named images.
if [[ $# -eq 0 ]]; then
	selected=("${ALL_NAMES[@]}")
else
	selected=("$@")
fi

# Reject an unknown name up front with a clear message, so a mistyped selection
# (e.g. `voxel-anim` for `voxel-animation`) fails fast instead of building nothing.
for name in "${selected[@]}"; do
	found=""
	for known in "${ALL_NAMES[@]}"; do
		[[ "$name" == "$known" ]] && { found=1; break; }
	done
	if [[ -z "${found}" ]]; then
		echo "unknown image '${name}'. Known images: ${ALL_NAMES[*]}" >&2
		exit 1
	fi
done

# Uphold the FROM-base invariant. Rebuild base first if it was selected; otherwise,
# if any base-dependent image was selected but no base image exists yet, build it so the
# `FROM ${BASE_IMAGE}` in those Dockerfiles resolves. An existing base is reused
# untouched — select `base` explicitly to rebuild it after a base-level change.
select_has() { local x; for x in "${selected[@]}"; do [[ "$x" == "$1" ]] && return 0; done; return 1; }

# Whether the selection includes any image built `FROM` the base. Every image is, EXCEPT
# `blender`, which is a self-contained `ubuntu:26.04` image (see build_blender) — so a
# selection of only `blender` must NOT drag in a base build.
select_needs_base() {
	local x
	for x in "${selected[@]}"; do
		[[ "$x" != base && "$x" != blender ]] && return 0
	done
	return 1
}

if select_has base; then
	build_base
elif select_needs_base && ! image_present "${BASE_IMAGE}"; then
	echo "==> base image ${BASE_IMAGE} not present; building it first (every image but blender is FROM it)"
	build_base
fi

# Build each selected image (base is already handled above).
for name in "${selected[@]}"; do
	[[ "$name" == base ]] && continue
	build_one "$name"
done
echo "==> done"
