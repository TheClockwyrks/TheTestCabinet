#!/usr/bin/env bash
# Builds The Test Cabinet run-container images:
#   - the base image, the shared Node foundation every other image is `FROM`
#     (directly, or via base-wasm) except the self-contained blender image;
#   - the base-wasm image, which every end-to-end run executes in — the base plus
#     the shared Rust → WebAssembly toolchain (Rust + `wasm32-unknown-unknown` +
#     wasm-bindgen + wasm-pack + binaryen), so an end-to-end or full-stack build may
#     author its simulation core in Rust and ship it as committed wasm
#     (`base-wasm/Dockerfile` is `FROM` the base built here);
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
#   - the adversarial image, which every adversarial run executes in — base-wasm
#     (which supplies the Rust + `wasm32-unknown-unknown` toolchain a model's
#     controller builds to wasm with) plus the Foray tooling compiled from
#     `crates/`: the baked-in `foray` CLI, the controller buildkit, and the
#     reference modules + map (`adversarial/Dockerfile` is `FROM` base-wasm here);
#     and
#   - the performance image, which every performance run executes in — base-wasm
#     (which supplies the Rust + `wasm32-unknown-unknown` toolchain a model's engine
#     builds to wasm with) plus the Lattice tooling compiled from `crates/`: the
#     baked-in `lattice` CLI, the engine buildkit, the reference engines, and the
#     committed training scenarios (`performance/Dockerfile` is `FROM` base-wasm here);
#     and
#   - one `<name>-gg` VARIANT per run image `gg` is pointed at — that image plus the
#     language toolchains a gg run's responses-as-code programs are compiled with
#     (`gg/Dockerfile`, `FROM` its parent, copying out of the `gg-toolchains` builder).
# With that one exception, none is a per-harness image: a run installs the selected
# harness's CLI into the image at run time (see `harnesses/README.md`). The exception is
# gg, whose programs need a COMPILER on the turn path and whose language is resolved per
# agent, so every toolchain has to be baked in together — and must not be present for any
# other harness, which is why it is a variant rather than a layer on the shared image.
#
# Usage:
#   ./build.sh                # build all images (the base, every asset-generation kind, adversarial,
#                             #   performance, and the `-gg` variants)
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
# override TCAB_CONTAINER_IMAGE_BASE_WASM (end-to-end) / TCAB_CONTAINER_IMAGE_SPRITE /
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
# `test-cabinet-base-wasm:<tag>`, `test-cabinet-sprite:<tag>`,
# `test-cabinet-sprite-sheet:<tag>`,
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
#                 IMAGE_NAME_PREFIXbase, the base-wasm image is
#                 IMAGE_NAME_PREFIXbase-wasm, the sprite image is
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
# The Rust/wasm middle layer built `FROM` the base: the base plus the shared Rust →
# WebAssembly toolchain. End-to-end runs resolve this image, and the full-stack-2d,
# adversarial, and performance images are each built `FROM` it (they no longer install
# a Rust toolchain of their own), so it stays in lockstep with the base within a build.
readonly BASE_WASM_IMAGE="${IMAGE_NAME_PREFIX}base-wasm:${IMAGE_TAG}"
# The full-stack-2d image tag. Referenced by name because the game-jam image is built
# `FROM` it (it inherits the six asset binaries, the audio packs, and the Rust/wasm
# toolchain), so the jam image stays in lockstep with full-stack-2d within a build.
readonly FULL_STACK_2D_IMAGE="${IMAGE_NAME_PREFIX}full-stack-2d:${IMAGE_TAG}"
# The shared asset-tooling BUILDER image. Not a run image and never pushed: it exists
# only as a `COPY --from` source, holding every asset-generation binary compiled in a
# single cargo pass (see containers/tools/Dockerfile). Every asset image is built with
# this tag passed as its TOOLS_IMAGE build arg, so all of them bake binaries from the
# same compile. It is deliberately absent from image-names.sh, which is the list of
# PUBLISHED run images.
readonly TOOLS_IMAGE="${IMAGE_NAME_PREFIX}tools:${IMAGE_TAG}"
# The gg LANGUAGE-TOOLCHAIN builder image. Like TOOLS_IMAGE it is not a run image and
# is never pushed: it exists only as a `COPY --from` source, holding the toolchains
# every `-gg` variant bakes in (see containers/gg-toolchains/Dockerfile). Also
# deliberately absent from image-names.sh, which lists PUBLISHED run images.
readonly GG_TOOLCHAINS_IMAGE="${IMAGE_NAME_PREFIX}gg-toolchains:${IMAGE_TAG}"
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

# Build the shared asset-tooling builder: every asset-generation binary the run
# images bake in, compiled in ONE cargo pass over the shared dependency graph, and
# exported as a `scratch` image the asset builds `COPY --from`.
#
# This is NOT a run image. It is never pushed and never appears in image-names.sh —
# a run never executes in it; it is only ever a source for `COPY --from`.
#
# It is ALWAYS rebuilt when any consuming image is selected, rather than reused when
# present the way the base is. The base is a stable OS+toolchain layer, but this
# image holds the compiled tooling, so reusing a stale one would silently bake
# yesterday's `voxel-anim` into today's run image — exactly the gap `run-images`
# exists to close. A no-change rebuild is cheap: the Dockerfile's cargo cache mounts
# mean cargo re-links at most the crates that actually changed.
build_tools() {
	echo "==> building ${TOOLS_IMAGE} (shared asset tooling; not pushed)"
	"$DOCKER" build \
		-t "${TOOLS_IMAGE}" \
		-f "${SCRIPT_DIR}/tools/Dockerfile" "${SCRIPT_DIR}/.."
}

# Build the gg language-toolchain builder: every compiler a `gg` run's
# responses-as-code programs may be compiled with, assembled under one prefix and
# exported as a `scratch` image the `-gg` variants `COPY --from`.
#
# This is NOT a run image. It is never pushed and never appears in image-names.sh —
# a run never executes in it; it is only ever a source for `COPY --from`.
#
# Built once and copied into every variant, for the same reason the asset tooling is:
# the tree is identical on each of them, so assembling it per variant would be the same
# work repeated. Its content being identical is also why the registry stores the copied
# layer once however many variants are published.
build_gg_toolchains() {
	echo "==> building ${GG_TOOLCHAINS_IMAGE} (gg language toolchains; not pushed)"
	# Every toolchain's version comes from the package that owns it rather than from a
	# default in the Dockerfile, so a pin is edited in one place. PureScript's matters
	# more than most: externs are a compiler-version-private format, so the `purs` in
	# this image and the `purs` that compiled the committed library set inside gg's
	# binary must be the same release or nothing compiles at all.
	# Java's pins are not build args: its block runs `scripts/ci/install-java.sh`, which
	# reads `packages/gg-sandbox-java/java-version.sh` itself — one list of ~29 jars, read
	# by the image and by a developer's machine rather than copied into both. Kotlin's
	# block does the same with `scripts/ci/install-kotlin.sh`, which RUNS the Java one:
	# that arm compiles to JVM bytecode and hands it to the same TeaVM, so there is one
	# JDK in this image rather than two.
	# Rust's pin is not this arm's to choose: it is `rust-toolchain.toml`'s, read here through
	# packages/gg-sandbox-rust/rust-version.sh. The compiler in this image and the compiler
	# that built the `.rlib` set inside gg's binary must be the same release — an `.rlib` is a
	# compiler-version-private format — so having only one Rust release in the repository is
	# what makes the two impossible to get out of step.
	# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
	source "${SCRIPT_DIR}/../packages/gg-sandbox-purescript/purescript-version.sh"
	# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
	source "${SCRIPT_DIR}/../packages/gg-sandbox-rust/rust-version.sh"
	"$DOCKER" build \
		--build-arg "PURS_VERSION=${PURS_VERSION}" \
		--build-arg "ESBUILD_VERSION=${ESBUILD_VERSION}" \
		--build-arg "RUST_VERSION=${GG_RUST_VERSION}" \
		--build-arg "RUST_TARGET=${GG_RUST_TARGET}" \
		-t "${GG_TOOLCHAINS_IMAGE}" \
		-f "${SCRIPT_DIR}/gg-toolchains/Dockerfile" "${SCRIPT_DIR}/.."
}

# Build one `<parent>-gg` variant: the parent run image plus the gg toolchain tree
# (see containers/gg/Dockerfile). One parameterized Dockerfile serves them all — the
# variants differ only in what they are `FROM` — so this takes the variant's name and
# the parent tag to layer onto.
#
# Arguments: the variant's short name (e.g. `base-wasm-gg`) and its parent's local tag.
build_gg_variant() {
	local name="$1"
	local parent="$2"
	local image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	echo "==> building ${image} (FROM ${parent})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${parent}" \
		--build-arg "GG_TOOLCHAINS_IMAGE=${GG_TOOLCHAINS_IMAGE}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/gg/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" "${name}")"
		echo "==> ${name} reference: ${reference}"
	fi
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

# Build the Rust/wasm base image `FROM` the base built above plus the shared Rust →
# WebAssembly toolchain (Rust + the `wasm32-unknown-unknown` target + wasm-bindgen +
# wasm-pack + binaryen). End-to-end runs resolve this image directly, and the
# full-stack-2d, adversarial, and performance images are built `FROM` it. Building
# from the local base tag avoids a registry round-trip and keeps this image pinned to
# the base produced in this same invocation. The context is the repository root only
# for `.dockerignore` parity with the other images; this image compiles nothing from
# `crates/` (it installs the public toolchain), so the context is otherwise unused.
build_base_wasm() {
	echo "==> building ${BASE_WASM_IMAGE} (FROM ${BASE_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${BASE_WASM_IMAGE}" \
		-f "${SCRIPT_DIR}/base-wasm/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${BASE_WASM_IMAGE}" base-wasm)"
		echo "==> base-wasm reference: ${reference}"
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
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}" \
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
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}" \
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

# Build the music image, which bakes EVERY instrument bank as a per-name subdirectory
# so a `music` case's `instrument_bank` selects which palette it plays (see
# `select_pack_dir` in crates/audio-core/src/config.rs and containers/music/Dockerfile).
# Each bank is a separately-pinned, content-addressed pack presigned from the private R2
# bucket at build time; a missing pin or a failed presign for ANY bank is a HARD error
# (the image is never shipped with a missing palette). The FIRST bank is the default
# recorded in TCAB_INSTRUMENT_BANK. Each bank's build-arg prefix pairs with the matching
# ARG block in the Dockerfile, and each name must match its per-name subdir there.
build_music_image() {
	local image="${IMAGE_NAME_PREFIX}music:${IMAGE_TAG}"
	local lock="${SCRIPT_DIR}/sample-packs/packs.lock.json"
	# The banks baked into the music image, and the Dockerfile ARG prefix each maps to.
	local banks=("gm-lite@0.1.0" "cinematic@0.1.0" "synthwave@0.1.0")
	local prefixes=("INSTRUMENT_BANK" "INSTRUMENT_BANK_CINEMATIC" "INSTRUMENT_BANK_SYNTHWAVE")

	local build_args=(
		--build-arg "BASE_IMAGE=${BASE_IMAGE}"
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}"
	)
	local i ref presign lines
	for i in "${!banks[@]}"; do
		ref="${banks[$i]}"
		if [[ ! -f "${lock}" ]] || ! grep -q "\"${ref}\"" "${lock}"; then
			echo "ERROR: cannot build ${image}: bank ${ref} is not published (no pin in ${lock#"${SCRIPT_DIR}/"})." >&2
			echo "       Publish it with: node scripts/build-sample-pack.mjs <bank> --publish" >&2
			exit 1
		fi
		if ! presign="$(node "${SCRIPT_DIR}/../scripts/presign-sample-pack.mjs" "${ref}")"; then
			echo "ERROR: ${ref} is pinned but presigning failed (need node + the PRESIGN R2 credentials)." >&2
			exit 1
		fi
		mapfile -t lines <<<"${presign}"
		build_args+=(
			--build-arg "${prefixes[$i]}=${ref}"
			--build-arg "${prefixes[$i]}_URL=${lines[0]}"
			--build-arg "${prefixes[$i]}_SHA256=${lines[1]}"
		)
	done

	echo "==> building ${image} (FROM ${BASE_IMAGE}) with banks: ${banks[*]}"
	"$DOCKER" build "${build_args[@]}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/music/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" music)"
		echo "==> music reference: ${reference}"
	fi
}

# Build the 2D full-stack image: base-wasm plus the six 2D asset-generation binaries
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

	echo "==> building ${image} (FROM ${BASE_WASM_IMAGE}) with ${sample_ref} + ${bank_ref}"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_WASM_IMAGE}" \
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}" \
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

# Build the game-jam image: the full-stack-2d image plus nothing but its own
# identity (see containers/game-jam/Dockerfile). A game jam is a full-stack-style
# build but not a full-stack test case, so it resolves its own image; giving it a
# dedicated tag lets a deployment pin it independently. It is built `FROM` the
# full-stack-2d image built alongside it (passed as the BASE_IMAGE build arg, the
# local tag), so it inherits the six asset binaries, the baked audio packs, and the
# Rust/wasm toolchain — and needs NO R2 credentials of its own (those packs are
# already baked into the parent). The build context is the repository root like the
# others.
build_game_jam() {
	local image="${IMAGE_NAME_PREFIX}game-jam:${IMAGE_TAG}"
	echo "==> building ${image} (FROM ${FULL_STACK_2D_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${FULL_STACK_2D_IMAGE}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/game-jam/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${image}" game-jam)"
		echo "==> game-jam reference: ${reference}"
	fi
}

build_adversarial() {
	echo "==> building ${ADVERSARIAL_IMAGE} (FROM ${BASE_WASM_IMAGE})"
	# Built `FROM` the base-wasm image built above (passed as the BASE_IMAGE build
	# arg, the local tag) — which already carries the Rust + `wasm32-unknown-unknown`
	# toolchain a model's controller compiles to wasm with — plus the Foray tooling
	# the image's first stage compiles from `crates/`: the `foray` CLI, the controller
	# buildkit (`foray-core` + `foray-controller-sdk`), and the reference wasm modules
	# + map. Like the asset-generation images it therefore needs the repository root as
	# its build context (a repo-root `.dockerignore` keeps it lean). Building from the
	# local base-wasm tag avoids a registry round-trip and keeps the adversarial image
	# pinned to the base-wasm produced in this same invocation.
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_WASM_IMAGE}" \
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
	echo "==> building ${PERFORMANCE_IMAGE} (FROM ${BASE_WASM_IMAGE})"
	# Built `FROM` the base-wasm image built above (passed as the BASE_IMAGE build
	# arg, the local tag) — which already carries the Rust + `wasm32-unknown-unknown`
	# toolchain a model's engine compiles to wasm with — plus the Lattice tooling the
	# image's first stage compiles from `crates/`: the `lattice` CLI, the engine
	# buildkit (`lattice-core` + `lattice-sdk`), and the reference engine wasm modules.
	# It also bakes the committed training scenarios from the case's version folder
	# under `test-cases/`. Like the adversarial image it therefore needs the repository
	# root as its build context (a repo-root `.dockerignore` keeps it lean). Building
	# from the local base-wasm tag avoids a registry round-trip and keeps the
	# performance image pinned to the base-wasm produced in this same invocation.
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_WASM_IMAGE}" \
		-t "${PERFORMANCE_IMAGE}" \
		-f "${SCRIPT_DIR}/performance/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${PERFORMANCE_IMAGE}" performance)"
		echo "==> performance reference: ${reference}"
	fi
}

# Build one image by its short name, dispatching to the right builder: the sfx-sample
# image carries its pack ref + build-arg names; music bakes every instrument bank
# (build_music_image); base, adversarial, and performance have dedicated builders;
# everything else is a plain asset-generation image built `FROM` the base.
build_one() {
	case "$1" in
		base)         build_base ;;
		base-wasm)    build_base_wasm ;;
		adversarial)  build_adversarial ;;
		performance)  build_performance ;;
		# The full-stack-2d image bakes six binaries AND two content-addressed audio
		# packs pulled from the private R2 bucket at build time (see
		# build_full_stack_2d). Both packs must be published + pinned first.
		full-stack-2d) build_full_stack_2d ;;
		# The game-jam image is built `FROM` the full-stack-2d image (see
		# build_game_jam); the layered build below ensures full-stack-2d is present
		# first when only game-jam is selected.
		game-jam)     build_game_jam ;;
		# The sfx-sample and music images bake a content-addressed audio pack pulled
		# from the private R2 bucket at build time (see build_audio_image). Each pack
		# ref must match the SAMPLE_PACK / INSTRUMENT_BANK default in its Dockerfile and
		# be published + pinned in packs.lock.json first.
		sfx-sample)   build_audio_image sfx-sample combat-core@0.1.0 SAMPLE_PACK SAMPLE_PACK_URL SAMPLE_PACK_SHA256 ;;
		# The music image bakes ALL instrument banks (one per-name subdir) so a case's
		# `instrument_bank` selects its palette — see build_music_image.
		music)        build_music_image ;;
		# The Blender character image is self-contained (FROM ubuntu:26.04, NOT the base),
		# so it has its own builder and takes no BASE_IMAGE arg — see build_blender.
		blender)      build_blender ;;
		# The gg variants: the image named by the prefix, plus the gg language
		# toolchains. Every run image has one and each is `FROM` the image whose name it
		# suffixes, so one rule serves them all — image-names.sh lists every variant
		# immediately after the image it derives from, and the layered rules below build
		# a missing parent first.
		*-gg)         build_gg_variant "$1" "${IMAGE_NAME_PREFIX}${1%-gg}:${IMAGE_TAG}" ;;
		# Every other name is a plain asset-generation image `FROM` the base.
		*)            build_asset_image "$1" ;;
	esac
}

# The full set of images, in dependency order (base first — every other image is
# `FROM` it). With no arguments the script builds all of them; with arguments it
# builds only the named subset.
# The canonical image list lives in image-names.sh so build.sh and the manifest job
# in build-containers.yml can't drift (see that script's header).
mapfile -t ALL_NAMES < <("${SCRIPT_DIR}/image-names.sh")

# The images that do NOT bake a binary out of the shared tooling builder: the two
# base layers, the self-contained blender image, the adversarial and performance
# images (which compile their own wasm-targeting tooling in their own stages), and
# game-jam (which inherits everything from full-stack-2d). Everything else in
# ALL_NAMES is an asset image that `COPY --from=tools`. Expressed as the exceptions
# rather than the members so a newly-added asset kind is covered by default.
#
# The `-gg` variants are exceptions too, by pattern rather than by name: each adds one
# COPY of the toolchain tree onto an already-built parent and bakes no asset binary of
# its own. `select_needs_tools` applies that pattern, so a new run image's variant is
# covered without being named here.
readonly NON_TOOLS_IMAGES=(base base-wasm blender adversarial performance game-jam)

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
	# `tools` is accepted although it is not in ALL_NAMES: it is the shared tooling
	# BUILDER, not a published run image, so `./build.sh tools` is a way to rebuild
	# just it. The layer-0 rule below is what actually builds it (which is also why
	# the main build loop skips it).
	for known in "${ALL_NAMES[@]}" tools; do
		[[ "$name" == "$known" ]] && { found=1; break; }
	done
	if [[ -z "${found}" ]]; then
		echo "unknown image '${name}'. Known images: ${ALL_NAMES[*]}" >&2
		exit 1
	fi
done

# Put the selection into canonical (image-names.sh) order and drop duplicates. That order
# is dependency order, so this is what makes a parent build before the image that is
# `FROM` it whichever way the names were typed: `./build.sh sprite-gg sprite` must not
# bake the variant on top of yesterday's sprite. `tools` sorts first — it is the builder
# everything else copies out of.
ordered=()
for known in tools "${ALL_NAMES[@]}"; do
	for name in "${selected[@]}"; do
		if [[ "$name" == "$known" ]]; then
			ordered+=("$known")
			break
		fi
	done
done
selected=("${ordered[@]}")

# Uphold the FROM-base and FROM-base-wasm invariants. Rebuild base (then base-wasm)
# first if selected; otherwise, if any dependent image was selected but its parent
# image does not exist yet, build the parent so the `FROM ${BASE_IMAGE}` in those
# Dockerfiles resolves. An existing parent is reused untouched — select `base` /
# `base-wasm` explicitly to rebuild it after a change at that layer.
select_has() { local x; for x in "${selected[@]}"; do [[ "$x" == "$1" ]] && return 0; done; return 1; }

# What the layered rules below actually have to reason about, which is not quite the
# selection. A `-gg` variant is one COPY of the toolchain tree onto its parent, so it
# brings no base-layer needs of its own — but when its parent is neither selected nor
# already built, that parent has to be built first and ITS needs are real. `gg_parents`
# collects exactly those parents (layer 4 builds them); `targets` is what every
# `select_needs_*` predicate walks, so each one keeps naming plain images only and a new
# run image's variant needs no rule of its own.
gg_parents=()
targets=()
for name in "${selected[@]}"; do
	if [[ "$name" == *-gg ]]; then
		parent="${name%-gg}"
		if ! select_has "${parent}" && ! image_present "${IMAGE_NAME_PREFIX}${parent}:${IMAGE_TAG}"; then
			gg_parents+=("${parent}")
			targets+=("${parent}")
		fi
	else
		targets+=("$name")
	fi
done

# Whether anything to be built is built `FROM` the base (directly, or via base-wasm).
# Everything is, EXCEPT `blender`, which is a self-contained `ubuntu:26.04` image (see
# build_blender) — so a selection of only `blender` (or only `blender-gg`) must NOT drag
# in a base build.
select_needs_base() {
	local x
	for x in "${targets[@]}"; do
		[[ "$x" != base && "$x" != blender ]] && return 0
	done
	return 1
}

# Whether anything to be built is built `FROM` base-wasm (the Rust/wasm middle layer):
# the full-stack-2d, adversarial, and performance images. `game-jam` is `FROM`
# full-stack-2d (which is `FROM` base-wasm), so it needs base-wasm present too. Such a
# selection needs base-wasm present, which in turn needs base — all handled below.
select_needs_base_wasm() {
	local x
	for x in "${targets[@]}"; do
		case "$x" in
			full-stack-2d | game-jam | adversarial | performance) return 0 ;;
		esac
	done
	return 1
}

# Whether the selection includes any gg variant. Each is one `COPY` of the gg
# language-toolchain tree onto an already-built run image, so the toolchain builder has
# to exist first.
select_needs_gg_toolchains() {
	local x
	for x in "${selected[@]}"; do
		case "$x" in
			*-gg) return 0 ;;
		esac
	done
	return 1
}

# Whether anything to be built is the game-jam image, which is built `FROM` the
# full-stack-2d image — so full-stack-2d must be present first (it in turn needs
# base-wasm and base, covered above).
select_needs_full_stack_2d() {
	local x
	for x in "${targets[@]}"; do
		[[ "$x" == game-jam ]] && return 0
	done
	return 1
}

# Whether anything to be built bakes a binary out of the shared tooling builder — i.e.
# anything but the exceptions in NON_TOOLS_IMAGES. `game-jam` is an exception only
# because it inherits its binaries from full-stack-2d; when a game-jam selection has to
# build that parent, the layer-3 rule below asks for the tooling itself. A `-gg` variant
# never reaches here at all: `targets` holds its parent, not the variant.
select_needs_tools() {
	local x y is_exception
	for x in "${targets[@]}"; do
		is_exception=""
		for y in "${NON_TOOLS_IMAGES[@]}"; do
			[[ "$x" == "$y" ]] && { is_exception=1; break; }
		done
		[[ -z "${is_exception}" ]] && return 0
	done
	return 1
}

# Layer 0 — the shared asset tooling, built before anything that copies out of it.
# ALWAYS rebuilt (never "reused if present"): it carries the compiled binaries, so a
# stale one would bake outdated tooling into an otherwise-fresh run image. Its cargo
# cache mounts make a no-change rebuild near-instant. It is independent of the base,
# so it is built first.
if select_needs_tools; then
	build_tools
fi

# Layer 0b — the gg language toolchains, built before any `-gg` variant copies them out.
# ALWAYS rebuilt, for the same reason the asset tooling is: it carries the compilers a gg
# run's programs are judged by, so a stale one would bake yesterday's toolchain into an
# otherwise-fresh variant. It is independent of the base, so it is built here.
if select_needs_gg_toolchains; then
	build_gg_toolchains
fi

# Layer 1 — the base. `select_needs_base` is true whenever base-wasm or any of its
# dependents is selected (none of them is `base`/`blender`), so this also covers the
# base that base-wasm is `FROM`.
if select_has base; then
	build_base
elif select_needs_base && ! image_present "${BASE_IMAGE}"; then
	echo "==> base image ${BASE_IMAGE} not present; building it first (every image but blender is FROM it, directly or via base-wasm)"
	build_base
fi

# Layer 2 — base-wasm (now that base is present if it was needed).
if select_has base-wasm; then
	build_base_wasm
elif select_needs_base_wasm && ! image_present "${BASE_WASM_IMAGE}"; then
	echo "==> base-wasm image ${BASE_WASM_IMAGE} not present; building it first (full-stack-2d/adversarial/performance are FROM it)"
	build_base_wasm
fi

# Layer 3 — full-stack-2d (the parent of game-jam). When full-stack-2d itself is
# selected it is built in the main loop below; but when only game-jam is selected we
# must build its parent first so the `FROM ${FULL_STACK_2D_IMAGE}` resolves. An
# existing full-stack-2d is reused untouched — select `full-stack-2d` explicitly to
# rebuild it. (Building it needs the R2 pack credentials; a bare game-jam rebuild
# against an already-present full-stack-2d does not.)
if ! select_has full-stack-2d \
	&& select_needs_full_stack_2d \
	&& ! image_present "${FULL_STACK_2D_IMAGE}"; then
	echo "==> full-stack-2d image ${FULL_STACK_2D_IMAGE} not present; building it first (game-jam is FROM it)"
	# full-stack-2d bakes six binaries out of the tooling builder. A game-jam-only
	# selection did not trigger the layer-0 rule (game-jam inherits its binaries and
	# needs no tooling of its own), so build the tooling here before its parent.
	build_tools
	build_full_stack_2d
fi

# Layer 4 — the parent of every selected `-gg` variant that is still missing. Selecting
# only a variant must not silently build it `FROM` an image that is not there; an
# existing parent is reused untouched, exactly as full-stack-2d is above. The
# `image_present` re-check is because the layers above may have just built it.
for name in "${gg_parents[@]}"; do
	image_present "${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}" && continue
	echo "==> ${name} image not present; building it first (${name}-gg is FROM it)"
	build_one "${name}"
done

# Build each selected image. The base layers and the tooling builder are already
# handled above. The canonical order in image-names.sh places full-stack-2d before
# game-jam, so a full build builds the parent before the jam image.
for name in "${selected[@]}"; do
	[[ "$name" == base || "$name" == base-wasm || "$name" == tools ]] && continue
	build_one "$name"
done
echo "==> done"
