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
#   ./build.sh audio-store    # build the data-only AUDIO STORE image: every published audio
#                             #   pack, which a run's declared packs are staged out of. Not a run
#                             #   image, so it is absent from image-names.sh and a plain
#                             #   `./build.sh` skips it — staging it downloads the clips from the
#                             #   audio object store and needs the presign credentials. Under
#                             #   PUSH=1 a full build includes it.
#   ./build.sh --gg-selfcheck <PATH-TO-GG> [<name>...]
#                             #   additionally drive `gg selfcheck` inside each environment
#                             #   representative it builds, BEFORE that image is pushed. See
#                             #   "Gating the `-gg` variants" below.
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
#
# ONE IMAGE UNDER containers/ IS DELIBERATELY NOT BUILT HERE: containers/gg-ci, the image
# that carries gg's eleven program-language toolchains under a staged $HOME so a CI job
# that must COMPILE test-cabinet-gg can copy them in. It is not a run image, nothing
# `COPY --from`s it, and it is ~1.9 GB — so `make run-images` must not start building it.
# It has its own workflow (.github/workflows/build-gg-ci-image.yml) with its own trigger,
# and `./build.sh gg-ci` is rejected as an unknown name by the check below, which is the
# intended answer rather than an oversight.
#
# GATING THE `-gg` VARIANTS ON `gg selfcheck` (`--gg-selfcheck <PATH-TO-GG>`).
#
# A `-gg` variant's whole content beyond its parent is a compiler tree, and nothing about
# building that tree asks whether it RUNS where it was copied to. It went wrong exactly
# that way: the C# arm's `csc` aborted at CLR start-up in every Debian-lineage run image
# for want of an ICU the toolchain did not carry, while the installer's own verification
# compile passed — because that compile ran in the builder stage, which `apt-get install`s
# the arm's dependencies and then exports `/opt/gg` without them. The libraries were
# reached by `dlopen`, so they were in no ELF header for `ldd` to miss either. Twenty-five
# images shipped with a dead arm and every check was green.
#
# So: with `--gg-selfcheck`, this script drives `gg selfcheck` — every registered language
# arm's real bootstrap turn, real toolchain, real compiler, real guest — INSIDE the image
# it has just built, as the unprivileged run user, and does it BEFORE `push_and_pin` gets
# the chance to publish it. A variant with a dead arm cannot reach the registry.
#
# IT IS A FLAG AND NOT AN ENVIRONMENT VARIABLE, deliberately. An env var is forgotten
# silently — a workflow edit that drops it leaves a build that still passes and publishes
# exactly the images this exists to keep unpublished, and quietly ceasing to be worth
# anything is the single most likely way this whole change stops mattering. A flag is
# visible in the one command line a reader of `build-containers.yml` reads, and the
# workflow additionally greps this script's output for the per-image `gg selfcheck ok:`
# lines below, so a refactor that stops passing it FAILS rather than skips.
#
# WHICH IMAGES IT RUNS IN is argued at GG_SELFCHECK_IMAGES; what stops a run image from
# quietly becoming an environment nothing checks is `assert_gg_environments`, and what pins
# the two external references those environments are rooted at is `assert_gg_lineages`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly PUSH="${PUSH:-}"
readonly IMAGE_REGISTRY="${IMAGE_REGISTRY:-}"
readonly IMAGE_TAG="${IMAGE_TAG:-latest}"
readonly IMAGE_NAME_PREFIX="${IMAGE_NAME_PREFIX:-test-cabinet-}"
readonly DOCKER="${DOCKER:-docker}"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
# One flag, parsed here so the rest of the script sees only image names in "$@" and the
# selection logic at the bottom is unchanged. `--gg-selfcheck <PATH>` (or
# `--gg-selfcheck=<PATH>`) names a `gg` binary on THIS machine; the header argues why the
# gate is a flag rather than an environment variable, and why it is worth a parser in a
# script that had none.
GG_SELFCHECK_BIN=""
positional=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--gg-selfcheck)
			if [[ $# -lt 2 ]]; then
				echo "--gg-selfcheck needs the path to a gg binary" >&2
				exit 1
			fi
			GG_SELFCHECK_BIN="$2"
			shift 2
			;;
		--gg-selfcheck=*)
			GG_SELFCHECK_BIN="${1#*=}"
			shift
			;;
		# Everything after `--` is an image name, however it is spelled.
		--)
			shift
			positional+=("$@")
			break
			;;
		-*)
			echo "unknown option '$1'. The only option is --gg-selfcheck <PATH-TO-GG>." >&2
			exit 1
			;;
		*)
			positional+=("$1")
			shift
			;;
	esac
done
set -- ${positional[@]+"${positional[@]}"}

# A path that is not there, or is not executable, is a typo — and a gate that quietly
# checked nothing would be worse than no gate, so it is fatal before the first build
# rather than a container failure forty minutes later. The path is resolved to an absolute
# one because it is handed to the container runtime, and made `readonly` because nothing
# below may change what was gated on.
if [[ -n "${GG_SELFCHECK_BIN}" ]]; then
	if [[ ! -f "${GG_SELFCHECK_BIN}" || ! -x "${GG_SELFCHECK_BIN}" ]]; then
		echo "--gg-selfcheck: '${GG_SELFCHECK_BIN}' is not an executable file." >&2
		echo "       Build one with: scripts/build-gg-static.sh <out-path>" >&2
		exit 1
	fi
	GG_SELFCHECK_BIN="$(cd "$(dirname "${GG_SELFCHECK_BIN}")" && pwd)/$(basename "${GG_SELFCHECK_BIN}")"
fi
readonly GG_SELFCHECK_BIN

# THE FOUR IMAGES THE GATE RUNS IN, AND WHY IT IS FOUR AND NOT TWENTY-SIX.
#
# Every `-gg` variant carries the SAME toolchain tree: `containers/gg/Dockerfile` copies
# `/opt/gg` with `--link`, which builds the layer rooted at `scratch` rather than as a diff
# against each parent — so all twenty-six variants get the identical digest for identical
# bytes (that COPY's comment carries the measurement). What can differ between two variants
# is therefore not the toolchain but the ENVIRONMENT it has to run in, and the question this
# list answers is how many distinct environments the twenty-six are.
#
# IT IS NOT "THE NUMBER OF PARENTS", which is what this list first said and got wrong. There
# are two external parents — the Debian `node:*-bookworm-slim` and `blender`'s `ubuntu:26.04`
# — but a run image is not its parent: a dozen of them `apt-get install` packages of their
# own on top of `base`, and a package brings its whole dependency closure with it. Measured
# on the local store, with the C# arm's own missing library as the probe:
#
#   test-cabinet-sprite-gg      no libicu at all
#   test-cabinet-base-wasm-gg   no libicu at all
#   test-cabinet-voxel-gg       libicu{uc,i18n,data}.so.72, dragged in by mesa-vulkan-drivers
#   test-cabinet-blender-gg     libicu{uc,i18n,data}.so.78, dragged in by blender
#
# So `base-wasm-gg` alone did not answer for `voxel-gg`: in one the vendored ICU is what the
# runtime opens and in the other the image's own copy is there to be found instead, and
# "satisfied by a package something unrelated pulled in" is the exact failure class this
# whole gate exists to end. Grouping the twenty-six by the environment their Dockerfiles
# build — the external reference the lineage is rooted at, plus every package `apt` installs
# anywhere along the chain — gives FOUR groups, and these are one of each:
#
#   sprite-gg     node:*-bookworm-slim + the shared base's packages
#   base-wasm-gg  …and base-wasm's binaryen, libssl-dev, pkg-config
#   voxel-gg      …and the mesa stack (libvulkan1, mesa-vulkan-drivers) the render images add
#   blender-gg    ubuntu:26.04 + blender's packages
#
# `base` itself is in no group: it has no `-gg` variant, so no arm ever runs there.
#
# That is the whole argument, and it is only as good as "four groups" — which is why
# `assert_gg_environments` re-derives the grouping from the Dockerfiles on every gated build
# instead of trusting this comment, and `assert_gg_lineages` separately pins the two external
# references the grouping is rooted at. The C# bug was in the ENVIRONMENT (a missing ICU),
# and `--link` says nothing whatever about what a variant is layered onto.
readonly GG_SELFCHECK_IMAGES=(sprite-gg base-wasm-gg voxel-gg blender-gg)

# The external images the run images' lineages are rooted at, and the exact references they
# name. `assert_gg_lineages` requires the set derived from `containers/*/Dockerfile` to be
# exactly this, so a third lineage — or a bump of either of these two — stops a gated build
# and has to be answered rather than absorbed. A bump is worth stopping for: the blender
# image works today only because Ubuntu's own package closure happens to drag in an ICU,
# which is precisely the kind of accident a new base image silently withdraws.
#
# This is a PIN and not the coverage argument. What makes four images answer for twenty-six
# is `assert_gg_environments`, which groups the variants by root *and* by the packages each
# one installs; a root that never moves while a run image gains a package is a change this
# list cannot see and that one can.
readonly GG_LINEAGE_ROOTS=(
	"base=docker.io/library/node:24.18.0-bookworm-slim"
	"blender=docker.io/library/ubuntu:26.04"
)

# Where the binary is installed inside the container under test. `crates/core`'s
# `gg::BINARY_PATH` — the path a real run copies gg to, and the one gg's own scratch files
# are named as siblings of (`/tmp/gg-invocation.json`, `/tmp/gg-cancel`). The check is
# worth as little as it differs from a run, so it does not invent a path of its own.
readonly GG_SELFCHECK_CONTAINER_PATH="/tmp/gg"

# The unprivileged user a run's harness executes as: uid 1000 `node`, created by
# `containers/base/Dockerfile` and recreated with the same name and uid by
# `containers/blender/Dockerfile` (`crates/core/src/container.rs`'s RUN_USER is what both
# are matching). The check runs as that user and not as root, because root would prove
# permissions no run has — a toolchain directory only root can read is a broken arm that a
# root check calls healthy.
readonly GG_SELFCHECK_USER="node"

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
# `FROM` it (it inherits the six asset binaries and the Rust/wasm toolchain), so the
# jam image stays in lockstep with full-stack-2d within a build.
readonly FULL_STACK_2D_IMAGE="${IMAGE_NAME_PREFIX}full-stack-2d:${IMAGE_TAG}"
# The shared asset-tooling BUILDER image. Not a run image and never pushed: it exists
# only as a `COPY --from` source, holding every asset-generation binary compiled in a
# single cargo pass (see containers/tools/Dockerfile). Every asset image is built with
# this tag passed as its TOOLS_IMAGE build arg, so all of them bake binaries from the
# same compile. It is deliberately absent from image-names.sh, which is the list of
# PUBLISHED run images.
readonly TOOLS_IMAGE="${IMAGE_NAME_PREFIX}tools:${IMAGE_TAG}"
# The gg LANGUAGE-TOOLCHAIN builder image: the toolchains every `-gg` variant bakes in
# (see containers/gg-toolchains/Dockerfile, which is where what this image IS is written
# down). Like TOOLS_IMAGE it is not a RUN image — a run never executes in it; it is only
# ever a `COPY --from` source — and it is deliberately absent from image-names.sh for
# that reason, that list being the set of images a run RESOLVES. What keeps it out in
# practice is this script rather than the Rust suite: `build_one` dispatches on the names
# in that list, so an entry there would route `./build.sh` and `make run-images` through
# `build_asset_image` for something that is not an asset image.
#
# UNLIKE TOOLS_IMAGE it IS pushed, and the distinction is worth stating because the two
# sat in the same sentence for a long time. The asset tooling is ~20 Rust binaries
# compiled from this checkout in a cargo pass whose cache mounts make a no-change
# rebuild near-instant, so there is nothing a registry copy would save. This one is
# ~1.9 GB fetched from five upstreams and pruned, and it is IDENTICAL in every `-gg`
# variant — so publishing it means (a) the exact tree inside those variants is
# independently pullable and pinned by digest rather than only inspectable by taking a
# run image apart, and (b) `./build.sh <name>-gg` can be pointed at the published tag
# through the GG_TOOLCHAINS_IMAGE build arg instead of paying for the fetch again. The
# registry stores the layers once however many variants carry them, so the push itself
# costs close to nothing on top of the variants already going up.
#
# THAT LAST SENTENCE IS TRUE ONLY BECAUSE `containers/gg/Dockerfile` COPIES THE TREE WITH
# `--link`. Identical content is not enough: a plain `COPY` is diffed against each
# variant's own parent, which gave the twenty-six variants twenty-six DIFFERENT digests for
# the same bytes and defeated every layer of sharing there is — registry storage, node
# pulls, and the `docker save` a local import feeds on. Read the comment on that `COPY`
# before touching it; it is the line this paragraph depends on.
#
# Because it is not in image-names.sh, the `manifest` job in build-containers.yml — which
# is driven by that list — fuses this one by name, immediately after its loop. See there.
readonly GG_TOOLCHAINS_IMAGE="${IMAGE_NAME_PREFIX}gg-toolchains:${IMAGE_TAG}"
# The AUDIO STORE image: every published audio pack, as data. Like GG_TOOLCHAINS_IMAGE it
# is not a RUN image — nothing executes in it and nothing resolves it for a run; it is a
# `FROM scratch` tree that the DRIVER image copies in at `/opt/tcab-audio` and that
# `scripts/fetch-audio-store.sh` pulls onto a local checkout. And like it, it IS pushed,
# and it is deliberately absent from image-names.sh for the same mechanical reason:
# `build_one` dispatches on that list by name, so an entry there would route it through
# `build_asset_image`. The manifest job in build-containers.yml fuses this one by name too.
#
# A run container is given the packs its test case declares in `[audio] packs`, staged out
# of this store when the container starts (`crates/core/src/audio_stage.rs`). Publishing
# the store as its own image is what keeps the R2 presign credentials to ONE build: the
# driver image, `make -C deployments/local images` and a contributor's `./build.sh` all
# obtain the store by pulling a public image, so none of them needs a credential and a
# clean clone can build every run image. See containers/audio-store/Dockerfile.
readonly AUDIO_STORE_IMAGE="${IMAGE_NAME_PREFIX}audio-store:${IMAGE_TAG}"
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
# This is NOT a run image and never appears in image-names.sh — a run never executes in
# it; it is only ever a source for `COPY --from`. It IS published under PUSH, though, for
# the reasons set out where GG_TOOLCHAINS_IMAGE is defined above.
#
# Built once and copied into every variant, for the same reason the asset tooling is:
# the tree is identical on each of them, so assembling it per variant would be the same
# work repeated. Its content being identical is also why the registry stores the copied
# layer once however many variants are published.
build_gg_toolchains() {
	echo "==> building ${GG_TOOLCHAINS_IMAGE} (gg language toolchains)"
	# Every toolchain's version comes from the package that owns it rather than from a
	# default in the Dockerfile, so a pin is edited in one place — and for all but one arm
	# that is now arranged so the wrapper cannot get it wrong either. Java's, Kotlin's,
	# Swift's, the C++ arm's, the C# arm's and (as of this change) PureScript's blocks each
	# COPY that arm's version file and RUN the same installer a developer's or CI machine
	# runs, so the list of versions is read by the image rather than passed to it. PureScript
	# was the last holdout and the one where it mattered most: externs are a
	# compiler-version-private format, so the `purs` in this image and the `purs` that
	# compiled the library set inside gg's binary must be the same release or NOTHING
	# compiles — and the two ARG defaults it used to carry were a second answer that a
	# `docker build -f` skipping this wrapper would silently have taken.
	#
	# Rust's is still a build arg, because there is no installer to run: the block is
	# `rustup` inside the image. The pin is not this arm's to choose either — it is
	# `rust-toolchain.toml`'s, read here through packages/gg-sandbox-rust/rust-version.sh.
	# The compiler in this image and the compiler that built the `.rlib` set inside gg's
	# binary must be the same release (an `.rlib` is a compiler-version-private format), so
	# having only one Rust release in the repository is what makes the two impossible to get
	# out of step; the Dockerfile declares `ARG RUST_VERSION` with no default so a build that
	# forgets this line fails rather than guessing.
	# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
	source "${SCRIPT_DIR}/../packages/gg-sandbox-rust/rust-version.sh"
	"$DOCKER" build \
		--build-arg "RUST_VERSION=${GG_RUST_VERSION}" \
		--build-arg "RUST_TARGET=${GG_RUST_TARGET}" \
		-t "${GG_TOOLCHAINS_IMAGE}" \
		-f "${SCRIPT_DIR}/gg-toolchains/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${GG_TOOLCHAINS_IMAGE}" gg-toolchains)"
		echo "==> gg-toolchains reference: ${reference}"
	fi
}

# The path, within the build context, that the audio store is staged to. The stager owns
# the tree under it (`tree/` beside a content-addressed download cache in `.cache/`), and
# the root `.dockerignore` re-includes exactly this directory so the cache never enters a
# build context. Written out here rather than read from the stager's stdout: the tree is
# the same one every time, so a fixed path is one fewer contract between the two.
readonly AUDIO_STORE_OUT="dist/audio-store"
readonly AUDIO_STORE_STAGE_DIR="${AUDIO_STORE_OUT}/tree"

# Build the audio store: every published audio pack, as a data-only image.
#
# This is NOT a run image (see where AUDIO_STORE_IMAGE is defined, and
# containers/audio-store/Dockerfile). It is the one build in this repository that reads
# the private audio object store: `scripts/stage-audio-store.mjs` presigns a SHORT-LIVED
# read-only GET for every published object and verifies each against
# `containers/sample-packs/objects.lock.json` before it lands, so no credential ever
# enters an image layer and the build has no path to the original source.
#
# EVERY published pack must be complete: a clip missing from the registry, an object with
# no record in the lock, a failed download, or a digest mismatch aborts the stager, and
# that is a hard error here rather than a skip — a partial store would stage a run with a
# palette its case declared and did not get. Publish with
# `node scripts/build-sample-pack.mjs <pack> --publish` and commit the updated
# `objects.lock.json` before building this image.
build_audio_store() {
	echo "==> staging the audio store into ${AUDIO_STORE_STAGE_DIR}"
	if ! node "${SCRIPT_DIR}/../scripts/stage-audio-store.mjs" \
		--out "${SCRIPT_DIR}/../${AUDIO_STORE_OUT}"; then
		echo "ERROR: cannot build ${AUDIO_STORE_IMAGE}: staging the audio store failed." >&2
		echo "       Every published pack must be complete (node scripts/build-sample-pack.mjs <pack> --publish)," >&2
		echo "       and this build needs node plus the CLOUDFLARE_AUDIO_R2_PRESIGN credentials." >&2
		echo "       No other image build needs them: the store travels as this image." >&2
		# `return 1` under `set -e` ends the build here, which is the point: an image
		# published from a partial store would stage a run with a palette its case
		# declared and did not get.
		return 1
	fi

	echo "==> building ${AUDIO_STORE_IMAGE} (FROM scratch; the published audio packs)"
	"$DOCKER" build \
		--build-arg "AUDIO_STAGE_DIR=${AUDIO_STORE_STAGE_DIR}" \
		-t "${AUDIO_STORE_IMAGE}" \
		-f "${SCRIPT_DIR}/audio-store/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${AUDIO_STORE_IMAGE}" audio-store)"
		echo "==> audio-store reference: ${reference}"
	fi
}

# ---------------------------------------------------------------------------
# The `-gg` gate
# ---------------------------------------------------------------------------

# Re-derive the external images the run images are rooted at, and refuse a gated build if the
# set is not the pinned one.
#
# This is the FLOOR of the coverage argument rather than the argument. Every run image's
# final stage is either `FROM ${BASE_IMAGE}` — layered onto another image built here, so it
# inherits that image's lineage — or `FROM` a literal external reference, which STARTS a
# lineage. Collect the literals and the set must be exactly GG_LINEAGE_ROOTS. What that
# catches is a new parent, or a bump of one, either of which changes what an image supplies
# for reasons no arm can see. What it CANNOT catch is a run image installing a package of
# its own, which changes the same thing without touching a `FROM` at all; that is
# `assert_gg_environments`, and this function was for a while mistaken for it.
#
# It reads the LAST `FROM` in each file, which is the stage that ships: several images have
# builder stages `FROM docker.io/library/rust:*`, and a builder is not a lineage — nothing
# a run executes is layered onto it.
#
# The audit that produced this gate suggested the equivalent assertion as a Rust unit test
# over `crates/core`'s image resolution. It belongs here instead, and the reason is the same
# one that made `gg selfcheck` a subcommand rather than a test: the fact being asserted is a
# property of the Dockerfiles, and this is the program that reads them. A test would also be
# asserting it somewhere that cannot stop the push. The same goes for its sibling below.
#
# Only fatal under `--gg-selfcheck`. Without the flag no coverage is being claimed, and
# failing an unrelated local `./build.sh sprite` because somebody added an image would be
# an alarm in the wrong place.
assert_gg_lineages() {
	local name dockerfile from
	local -a roots=()
	for name in "${ALL_NAMES[@]}"; do
		# A `-gg` variant is `FROM` its parent (`containers/gg/Dockerfile`), so it starts
		# no lineage of its own — which is the fact the whole gate is built on.
		[[ "${name}" == *-gg ]] && continue
		dockerfile="${SCRIPT_DIR}/${name}/Dockerfile"
		if [[ ! -f "${dockerfile}" ]]; then
			echo "gg selfcheck: no Dockerfile at ${dockerfile#"${SCRIPT_DIR}/"} for run image '${name}'" >&2
			exit 1
		fi
		from="$(grep -E '^FROM[[:space:]]' "${dockerfile}" | tail -n 1 | awk '{print $2}')"
		# `${BASE_IMAGE}`, `${FULL_STACK_2D_IMAGE}`, … — layered onto an image built here.
		[[ "${from}" == \$* ]] && continue
		roots+=("${name}=${from}")
	done

	local expected actual
	expected="$(printf '%s\n' "${GG_LINEAGE_ROOTS[@]}" | sort)"
	actual="$(printf '%s\n' ${roots[@]+"${roots[@]}"} | sort)"
	if [[ "${expected}" != "${actual}" ]]; then
		echo "ERROR: the run images are no longer rooted at exactly the two images pinned here." >&2
		echo "  expected: $(printf '%s ' "${GG_LINEAGE_ROOTS[@]}")" >&2
		echo "  found:    $(printf '%s ' ${roots[@]+"${roots[@]}"})" >&2
		echo "" >&2
		echo "  \`gg selfcheck\` is run in one -gg variant per environment (${GG_SELFCHECK_IMAGES[*]})," >&2
		echo "  and an environment starts with the image its lineage is rooted at. A root that is not in" >&2
		echo "  this list is an environment nothing drives an arm in — which is exactly how the C# arm" >&2
		echo "  came to be dead on one lineage and alive on the other." >&2
		echo "" >&2
		echo "  A NEW parent: add its variant to GG_SELFCHECK_IMAGES and its root to GG_LINEAGE_ROOTS." >&2
		echo "  A BUMPED parent: update GG_LINEAGE_ROOTS — and read the arm installers' vendoring first," >&2
		echo "  since which shared libraries an image happens to supply is a property of that reference." >&2
		exit 1
	fi
}

# The packages one image's Dockerfile installs in the stage that ships.
#
# Only the final stage: several images have builder stages that install a compiler, and a
# builder's packages are in nothing a run executes. Only `apt`, because `apt` is how a
# package's whole dependency closure arrives — the thing that put an ICU into the mesa
# images and into `blender` without either Dockerfile naming one. A tarball unpacked by a
# `RUN curl | tar` (node in `blender`, rustup in `base-wasm`) brings no closure with it and
# is deliberately not counted.
#
# Reading the package names out of the file is what makes this notice a package ADDED later,
# which is the whole point: the assertion below has to fail on an edit to some render image's
# Dockerfile that nobody thought was about gg at all.
gg_image_packages() {
	local file="$1" start
	start="$(grep -n '^FROM[[:space:]]' "${file}" | tail -n 1 | cut -d: -f1)"
	awk -v start="${start}" '
		NR < start { next }
		# A comment, wherever it sits. `containers/blender/Dockerfile` explains itself with the
		# words "a single `apt-get install` gives arch parity", and a scan that read that line
		# would put "arch", "parity" and "gives" into the environment key.
		/^[ \t]*#/ { next }
		{
			line = $0
			if (!collecting) {
				at = index(line, "apt-get install")
				if (at == 0) { next }
				line = substr(line, at + length("apt-get install"))
				collecting = 1
			}
			continued = (line ~ /\\[ \t]*$/)
			sub(/\\[ \t]*$/, "", line)
			count = split(line, word, /[ \t]+/)
			for (at = 1; at <= count; at++) {
				token = word[at]
				if (token == "") { continue }
				# The shell operator that ends the install and starts the `rm -rf` beside it.
				# Everything after it on this line, and every line after it, is another command.
				if (token == "&&" || token == ";") { collecting = 0; continued = 0; break }
				if (token ~ /^-/) { continue }
				if (token ~ /^[a-z0-9][a-z0-9.+-]*$/) { print token }
			}
			if (!continued) { collecting = 0 }
		}
	' "${file}"
}

# The image one run image's final stage is layered onto, as `!<external reference>` when it
# starts a lineage or as the short name of another image built here when it does not.
#
# A `FROM ${SOMETHING_IMAGE}` is resolved through that stage's own `ARG SOMETHING_IMAGE=`
# default, which every run image carries and which names a `test-cabinet-<name>:latest`. That
# literal prefix is matched rather than IMAGE_NAME_PREFIX: the default in the Dockerfile is a
# fixed string, and a build run with a different prefix has not changed what the file says.
gg_image_parent() {
	local file="$1" from variable default
	from="$(grep -E '^FROM[[:space:]]' "${file}" | tail -n 1 | awk '{print $2}')"
	if [[ "${from}" != \$\{*\} ]]; then
		printf '!%s\n' "${from}"
		return
	fi
	variable="${from#\$\{}"
	variable="${variable%\}}"
	default="$(grep -E "^ARG ${variable}=" "${file}" | tail -n 1 | sed 's/^[^=]*=//')"
	if [[ -z "${default}" ]]; then
		echo "gg selfcheck: ${file#"${SCRIPT_DIR}/"} is FROM ${from} with no ARG default to resolve it." >&2
		exit 1
	fi
	default="${default%%:*}"
	printf '%s\n' "${default#test-cabinet-}"
}

# The environment one run image presents to a toolchain: the external reference its lineage
# is rooted at on the first line, then every package installed anywhere along the chain.
gg_image_environment() {
	local name="$1" file parent
	file="${SCRIPT_DIR}/${name}/Dockerfile"
	if [[ ! -f "${file}" ]]; then
		echo "gg selfcheck: no Dockerfile at ${file#"${SCRIPT_DIR}/"} for run image '${name}'" >&2
		exit 1
	fi
	parent="$(gg_image_parent "${file}")"
	case "${parent}" in
	'!'*) printf '%s\n' "${parent#!}" ;;
	*) gg_image_environment "${parent}" ;;
	esac
	gg_image_packages "${file}"
}

# That environment folded into one comparable string.
gg_environment_key() {
	local lines
	lines="$(gg_image_environment "$1")"
	printf '%s [%s]' \
		"$(printf '%s\n' "${lines}" | head -n 1)" \
		"$(printf '%s\n' "${lines}" | tail -n +2 | sort -u | tr '\n' ',' | sed 's/,$//')"
}

# Re-derive the environments the `-gg` variants have, and refuse a gated build if any of them
# is one no representative in GG_SELFCHECK_IMAGES is driven in.
#
# THIS IS THE ASSERTION THE FIRST VERSION OF THE GATE DID NOT HAVE, and its absence was the
# same mistake in miniature as the one the gate exists to catch. The claim was "two images
# cover twenty-six, because /opt/gg is byte-identical and there are two parents", and
# `assert_gg_lineages` was written to keep the "two parents" half honest — which it does, and
# which was never the half that could go wrong quietly. A run image is not its parent: a
# dozen of them `apt-get install` a package on top of `base`, apt brings the package's closure
# with it, and the mesa images have carried an ICU that way the whole time. Re-deriving the
# ROOTS could not notice that and cannot notice the next one, because nothing about a new
# `apt-get install` line in `containers/voxel/Dockerfile` changes any `FROM`.
#
# What is compared is the environment as the Dockerfiles describe it rather than as the built
# image contains it. Reading the real closure would mean `docker run … dpkg-query` per image,
# which is a truer answer and the wrong one to gate on: it can only be asked after the image
# is built, it differs between the two architectures a manifest is assembled from, and a
# package a base image quietly gains at its own next digest would make an unrelated build
# fail with no edit to point at. The Dockerfiles are what a reviewer changes, so they are what
# this stops on.
#
# Only fatal under `--gg-selfcheck`, for the reason `assert_gg_lineages` is.
assert_gg_environments() {
	local name key representative
	local -A covered=()
	for representative in "${GG_SELFCHECK_IMAGES[@]}"; do
		key="$(gg_environment_key "${representative%-gg}")"
		if [[ -n "${covered["${key}"]:-}" ]]; then
			echo "ERROR: ${representative} and ${covered["${key}"]} are the same environment." >&2
			echo "  Every image in GG_SELFCHECK_IMAGES costs a full eleven-arm check (~40s), so two that" >&2
			echo "  answer the same question are one that answers none. Drop one, or check what edit made" >&2
			echo "  them identical: ${key}" >&2
			exit 1
		fi
		covered["${key}"]="${representative}"
	done

	local -a uncovered=()
	for name in "${ALL_NAMES[@]}"; do
		[[ "${name}" == *-gg ]] || continue
		key="$(gg_environment_key "${name%-gg}")"
		[[ -n "${covered["${key}"]:-}" ]] || uncovered+=("${name}")
	done
	if [[ ${#uncovered[@]} -gt 0 ]]; then
		echo "ERROR: ${#uncovered[@]} -gg variant(s) run an arm in an environment nothing checks:" >&2
		printf '           %s\n' "${uncovered[@]}" >&2
		echo "" >&2
		echo "  \`gg selfcheck\` runs in one variant per environment (${GG_SELFCHECK_IMAGES[*]}), where an" >&2
		echo "  environment is the image the lineage is rooted at PLUS every package apt installs along" >&2
		echo "  the way — because apt brings a package's whole closure with it, and a shared library an" >&2
		echo "  image happens to hold that way is what decides whether an arm's own vendored copy is the" >&2
		echo "  one that loads. ${uncovered[0]}'s environment is:" >&2
		echo "      $(gg_environment_key "${uncovered[0]%-gg}")" >&2
		echo "" >&2
		echo "  A run image that gained a package: add its variant to GG_SELFCHECK_IMAGES, or take the" >&2
		echo "  package back out. There is no third answer that keeps this gate meaning anything." >&2
		exit 1
	fi
}

# Whether this variant is one of the environment representatives the gate runs in.
gg_selfcheck_covers() {
	local name="$1" representative
	for representative in "${GG_SELFCHECK_IMAGES[@]}"; do
		[[ "${name}" == "${representative}" ]] && return 0
	done
	return 1
}

# The container the check is running in, so a failure anywhere between `create` and `rm`
# still takes it with it. One EXIT trap for the script; `gg_selfcheck` clears the variable
# on its own way out, so the trap is a no-op on the ordinary path.
GG_SELFCHECK_CONTAINER=""
gg_selfcheck_cleanup() {
	[[ -n "${GG_SELFCHECK_CONTAINER}" ]] || return 0
	"$DOCKER" rm --force "${GG_SELFCHECK_CONTAINER}" >/dev/null 2>&1 || true
	GG_SELFCHECK_CONTAINER=""
}
trap gg_selfcheck_cleanup EXIT

# Drive `gg selfcheck` inside a freshly-built variant, and fail the whole build if any arm
# is broken. Arguments: the variant's short name and its local image tag.
#
# WHY IT INSTALLS THE BINARY THE WAY A RUN DOES — created container, `cp` the bytes in,
# start it, `exec` as the run user — rather than bind-mounting it. Two reasons, and the
# second is the one that would have bitten:
#
#   1. It is what production does. `crates/core`'s container runtime creates the run
#      container, copies gg in at `/tmp/gg` and `exec --user node`s it. A gate whose
#      installation differs from the run's is a gate answering a slightly different
#      question than the one that matters.
#   2. `cp` reads the file on THIS side of the socket. A bind mount is resolved by the
#      DAEMON, and this repository's own devcontainer talks to the host's daemon
#      (Docker-outside-of-Docker), where an in-container path names nothing: the mount
#      silently becomes an empty directory and the gate dies with `permission denied` for
#      a reason that has nothing to do with any arm. `deployments/local/Makefile` carries
#      the same problem for k3d and solves it by translating to the host path; a `cp` needs
#      no translation, so the local target and CI run the identical command.
gg_selfcheck() {
	local name="$1" image="$2"
	echo "==> gg selfcheck: driving every language arm inside ${image} as ${GG_SELFCHECK_USER}" >&2

	# The image's own CMD (`sleep infinity`) is what a run container is started with, so it
	# is what this one is started with; the check itself arrives through `exec`.
	GG_SELFCHECK_CONTAINER="$("$DOCKER" create "${image}")"
	"$DOCKER" cp "${GG_SELFCHECK_BIN}" "${GG_SELFCHECK_CONTAINER}:${GG_SELFCHECK_CONTAINER_PATH}"
	"$DOCKER" start "${GG_SELFCHECK_CONTAINER}" >/dev/null

	# Not `set -e`'s job to end the build here: the report has to be attributable to an
	# image, so the status is caught, the container is removed, and the message names the
	# variant. Everything gg printed has already gone to this script's own stdout/stderr.
	local status=0
	"$DOCKER" exec --user "${GG_SELFCHECK_USER}" "${GG_SELFCHECK_CONTAINER}" \
		"${GG_SELFCHECK_CONTAINER_PATH}" selfcheck || status=$?
	gg_selfcheck_cleanup

	if [[ "${status}" -ne 0 ]]; then
		echo "" >&2
		echo "ERROR: gg selfcheck FAILED in ${image} (exit ${status}); ${name} is NOT publishable." >&2
		echo "       The per-arm report above says which arm and whose defect it is. An arm that" >&2
		echo "       compiles on a developer machine and dies here is the toolchain failing to carry" >&2
		echo "       something the image does not supply — see apps/docs/src/content/docs/gg/languages/" >&2
		echo "       compilation.md#self-contained-toolchains." >&2
		exit 1
	fi
	# The line the workflow greps for. Changing its shape is changing an assertion in
	# .github/workflows/build-containers.yml.
	echo "==> gg selfcheck ok: ${name} — every language arm passed in ${image}"
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

	# BETWEEN THE BUILD AND THE PUSH, AND THAT ORDER IS THE POINT: a variant whose toolchain
	# cannot run in it must never reach a registry, and `set -euo pipefail` plus the `exit 1`
	# inside `gg_selfcheck` is what makes a broken arm end the build here rather than one
	# image later. Only the environment representatives are driven — see GG_SELFCHECK_IMAGES
	# for why four answer for twenty-six, and `assert_gg_environments` for what keeps that true.
	if [[ -n "${GG_SELFCHECK_BIN}" ]] && gg_selfcheck_covers "${name}"; then
		gg_selfcheck "${name}" "${image}"
	fi

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

# Build the 2D full-stack image: base-wasm plus the six 2D asset-generation binaries
# (draw, draw-sheet, particle-2d, sfx-synth, sfx-sample, music). Identical to a plain
# asset image except for its parent — it is `FROM` base-wasm rather than the base, so a
# full-stack build may author its simulation core in Rust — which is why it has a builder
# of its own rather than going through `build_asset_image`.
#
# It bakes NO audio. `sfx-sample` and `music` read the packs the run's test case declares
# in `[audio] packs`, staged into `/opt/audio` when the container starts, so this build
# needs no audio object-store credentials and a new pack version needs no rebuild of it.
build_full_stack_2d() {
	echo "==> building ${FULL_STACK_2D_IMAGE} (FROM ${BASE_WASM_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_WASM_IMAGE}" \
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}" \
		-t "${FULL_STACK_2D_IMAGE}" \
		-f "${SCRIPT_DIR}/full-stack-2d/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		local reference
		reference="$(push_and_pin "${FULL_STACK_2D_IMAGE}" full-stack-2d)"
		echo "==> full-stack-2d reference: ${reference}"
	fi
}

# Build the game-jam image: the full-stack-2d image plus nothing but its own
# identity (see containers/game-jam/Dockerfile). A game jam is a full-stack-style
# build but not a full-stack test case, so it resolves its own image; giving it a
# dedicated tag lets a deployment pin it independently. It is built `FROM` the
# full-stack-2d image built alongside it (passed as the BASE_IMAGE build arg, the
# local tag), so it inherits the six asset binaries and the Rust/wasm toolchain. The
# build context is the repository root like the others.
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

# Build one image by its short name, dispatching to the right builder: base,
# adversarial, performance, full-stack-2d, game-jam and blender have dedicated builders;
# everything else — sfx-sample and music included, since neither carries a palette of its
# own any more — is a plain asset-generation image built `FROM` the base.
build_one() {
	case "$1" in
		base)         build_base ;;
		base-wasm)    build_base_wasm ;;
		adversarial)  build_adversarial ;;
		performance)  build_performance ;;
		# The full-stack-2d image bakes six binaries and is `FROM` base-wasm rather
		# than the base, so it has a builder of its own (see build_full_stack_2d).
		full-stack-2d) build_full_stack_2d ;;
		# The game-jam image is built `FROM` the full-stack-2d image (see
		# build_game_jam); the layered build below ensures full-stack-2d is present
		# first when only game-jam is selected.
		game-jam)     build_game_jam ;;
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

# Before anything is built: if this build is claiming to gate the `-gg` variants, the claim
# has to still be true. Both halves of it — the two external references the lineages are
# rooted at, and the four environments those roots plus the images' own packages make. Cheap
# (they read the Dockerfiles), and they run first so an uncovered variant is a message rather
# than an hour of building followed by one.
if [[ -n "${GG_SELFCHECK_BIN}" ]]; then
	assert_gg_lineages
	assert_gg_environments
fi

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
# `BUILD_EVERYTHING` records which of the two it was, for the one rule below that turns on
# the absence of a selection rather than on a name in it (the audio store).
if [[ $# -eq 0 ]]; then
	selected=("${ALL_NAMES[@]}")
	readonly BUILD_EVERYTHING=1
else
	selected=("$@")
	readonly BUILD_EVERYTHING=""
fi

# Reject an unknown name up front with a clear message, so a mistyped selection
# (e.g. `voxel-anim` for `voxel-animation`) fails fast instead of building nothing.
for name in "${selected[@]}"; do
	found=""
	# `tools` and `audio-store` are accepted although they are not in ALL_NAMES:
	# neither is a published RUN image (that list is the set a run resolves), and both
	# are built by a rule of their own, so `./build.sh tools` and
	# `./build.sh audio-store` are the ways to rebuild just one of them. The layer
	# rules below are what actually build them, which is also why the main build loop
	# skips both.
	for known in "${ALL_NAMES[@]}" tools audio-store; do
		[[ "$name" == "$known" ]] && { found=1; break; }
	done
	if [[ -z "${found}" ]]; then
		echo "unknown image '${name}'. Known images: ${ALL_NAMES[*]}" >&2
		echo "       plus the two that are not run images: tools (the shared tooling builder)" >&2
		echo "       and audio-store (the published audio packs)." >&2
		exit 1
	fi
done

# Put the selection into canonical (image-names.sh) order and drop duplicates. That order
# is dependency order, so this is what makes a parent build before the image that is
# `FROM` it whichever way the names were typed: `./build.sh sprite-gg sprite` must not
# bake the variant on top of yesterday's sprite. `tools` sorts first — it is the builder
# everything else copies out of.
ordered=()
for known in tools audio-store "${ALL_NAMES[@]}"; do
	for name in "${selected[@]}"; do
		if [[ "$name" == "$known" ]]; then
			ordered+=("$known")
			break
		fi
	done
done
selected=("${ordered[@]}")

# A gate that was asked for and checked nothing is the failure this whole mechanism exists
# to prevent, one level up. `--gg-selfcheck` with a selection that contains no lineage
# representative would build, print nothing about any arm, and exit 0 — so it is refused,
# here, before the first `docker build` rather than at the end of one.
if [[ -n "${GG_SELFCHECK_BIN}" ]]; then
	gg_selfcheck_selected=""
	for name in "${selected[@]}"; do
		gg_selfcheck_covers "${name}" && { gg_selfcheck_selected=1; break; }
	done
	if [[ -z "${gg_selfcheck_selected}" ]]; then
		echo "ERROR: --gg-selfcheck was given, but the selection builds no image the check runs in." >&2
		echo "       It runs in the environment representatives — ${GG_SELFCHECK_IMAGES[*]} — because" >&2
		echo "       /opt/gg is byte-identical across every -gg variant and what differs is the environment" >&2
		echo "       it runs in (see GG_SELFCHECK_IMAGES). Name at least one of them:" >&2
		echo "           ./build.sh --gg-selfcheck <PATH-TO-GG> ${GG_SELFCHECK_IMAGES[*]}" >&2
		exit 1
	fi
	unset gg_selfcheck_selected
fi

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
	if [[ "$name" == audio-store ]]; then
		# Data only, `FROM scratch`: it is layered onto nothing, bakes no binary out of
		# the tooling builder, and no image is built `FROM` it — so it contributes
		# nothing to any rule below and must not drag a base build in behind it.
		continue
	elif [[ "$name" == *-gg ]]; then
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

# Layer 0c — the audio store, which depends on nothing and which nothing depends on.
# Built when it is NAMED, and on a full build only under PUSH: staging it needs node and
# the audio object store's presign credentials, which a contributor does not have and now
# does not need, so a plain local `./build.sh` skips it with a note and still builds every
# run image. Nothing is lost by skipping it — no run image reads it, and a local `tcab
# run` gets the store from the published image with scripts/fetch-audio-store.sh.
if select_has audio-store; then
	build_audio_store
elif [[ -n "${BUILD_EVERYTHING}" ]]; then
	if [[ -n "${PUSH}" ]]; then
		build_audio_store
	else
		echo "==> skipping ${AUDIO_STORE_IMAGE} (staging it needs the CLOUDFLARE_AUDIO_R2_PRESIGN credentials; build it with ./build.sh audio-store)"
	fi
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
# rebuild it.
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
	[[ "$name" == base || "$name" == base-wasm || "$name" == tools || "$name" == audio-store ]] && continue
	build_one "$name"
done
echo "==> done"
