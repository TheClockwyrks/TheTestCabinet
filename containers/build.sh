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
#   - the two full-stack images, which every full-stack run executes in — base-wasm plus
#     the asset-generation binaries the model produces the game's own assets with (the
#     audio those tools reach is staged per run, not baked in). Which of the two a run
#     resolves is the case's
#     `asset_dimension`: full-stack-2d (the default) carries the 2D six — `draw`,
#     `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music` — and full-stack-3d
#     carries those plus `voxel`, `voxel-anim` and `particle-3d` and the Mesa
#     software-Vulkan runtime those three render their previews through (each
#     `full-stack-*/Dockerfile` is `FROM` base-wasm here); and
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
#                             #   is (re)built when it is named, when a non-base image is named and
#                             #   no base is present, and when the base that IS present is older
#                             #   than containers/base/Dockerfile — being present is not the same as
#                             #   being current, and a stale parent is inherited in silence. The
#                             #   rebuild cascades down the layers. This is how
#                             #   deployments/local/Makefile rebuilds one test type — or one
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
# The images are distributed via a registry and pulled by the runner, which resolves
# the one for a run's test type, its asset kind, and — for a full-stack case — its
# asset dimension, from its own registry configuration (TCAB_CONTAINER_REGISTRY /
# TCAB_CONTAINER_TAG, or a per-image override TCAB_CONTAINER_IMAGE_BASE_WASM
# (end-to-end) / TCAB_CONTAINER_IMAGE_FULL_STACK_2D /
# TCAB_CONTAINER_IMAGE_FULL_STACK_3D / TCAB_CONTAINER_IMAGE_SPRITE /
# TCAB_CONTAINER_IMAGE_SPRITE_SHEET / TCAB_CONTAINER_IMAGE_VOXEL /
# TCAB_CONTAINER_IMAGE_VOXEL_ANIMATION / TCAB_CONTAINER_IMAGE_MC /
# TCAB_CONTAINER_IMAGE_MC_ANIMATION / TCAB_CONTAINER_IMAGE_SN /
# TCAB_CONTAINER_IMAGE_SN_ANIMATION / TCAB_CONTAINER_IMAGE_DC /
# TCAB_CONTAINER_IMAGE_DC_ANIMATION / TCAB_CONTAINER_IMAGE_ADVERSARIAL /
# TCAB_CONTAINER_IMAGE_PERFORMANCE; see docs/components/core/execution.md). The
# backend plays no part in container distribution, so this script never talks to it.
#
# With PUSH=1 the script pushes each built image to IMAGE_REGISTRY and prints its
# pushed digest reference. With RECLAIM=1 ALONGSIDE IT — which only CI sets — it then also
# RECLAIMS each one: a pushed image whose place in the build order means nothing later is
# `FROM` it is removed from the local store and the builder cache is pruned, because the
# whole set does not fit on a build agent otherwise (see "Reclaiming disk as the build
# goes"). RECLAIM is a separate switch from PUSH precisely because pushing is something a
# developer is documented to do from their own box and the reclaim is destructive beyond
# this build: read its own header before setting it. Without PUSH it just builds locally
# (the offline development path) and removes nothing, because there the images are the
# product: the images are named `test-cabinet-base:<tag>`,
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
#   RECLAIM       set to 1, together with PUSH=1, to remove each pushed image from the
#                 local store once nothing later in the build order needs it and to prune
#                 the builder cache as the build advances (default: unset). It is what
#                 makes the fifty-five-image set fit on a CI agent, and it is DESTRUCTIVE
#                 BEYOND THIS BUILD — the builder prune takes every `--mount=type=cache`
#                 record on the daemon, including ones belonging to other Dockerfiles and
#                 other projects. `scripts/ci/run-images.sh` sets it; nothing else should.
#                 Ignored without PUSH, because an unpushed image must not be removed.
#   REUSE_INPUTS  the path of the table scripts/ci/run-image-inputs.sh prints, one
#                 `<name> <digest> <parents>` line per image, which turns on REUSE: an
#                 image whose inputs digest already names a pushed image in the registry
#                 (`<image>:inputs-<digest>-<arch>`) is retagged for IMAGE_TAG with one
#                 registry round trip instead of being built and pushed again, and a
#                 built image is pushed under its inputs tag as well as IMAGE_TAG so the
#                 next build can reuse it (and the reclaim, under RECLAIM, drops that tag
#                 with the others). Needs PUSH=1. See "Reusing what the registry already
#                 holds" below. `scripts/ci/run-images.sh` sets it.
#   IMAGE_REGISTRY  registry/namespace the pushed images live under, e.g.
#                 testcabinet.azurecr.io (required when PUSH=1; pushing there needs
#                 `az acr login --name testcabinet` and AcrPush). Matches the
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
#   REGISTRY_ATTEMPTS  how many times one registry round trip (a push, a pull, a
#                 manifest write) is tried before the build fails on it (default: 4)
#   REGISTRY_RETRY_DELAY  seconds before the first retry; the Nth retry waits N times
#                 this (default: 10)
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
# visible in the one command line a reader of `scripts/ci/run-images.sh` reads, and that
# script additionally requires this script's per-image `gg selfcheck ok:` lines below, so
# a refactor that stops passing it FAILS rather than skips.
#
# WHICH IMAGES IT RUNS IN is argued at GG_SELFCHECK_IMAGES; what stops a run image from
# quietly becoming an environment nothing checks is `assert_gg_environments`, and what pins
# the two external references those environments are rooted at is `assert_gg_lineages`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly PUSH="${PUSH:-}"
readonly RECLAIM="${RECLAIM:-}"
readonly IMAGE_REGISTRY="${IMAGE_REGISTRY:-}"
readonly IMAGE_TAG="${IMAGE_TAG:-latest}"
readonly IMAGE_NAME_PREFIX="${IMAGE_NAME_PREFIX:-test-cabinet-}"
readonly DOCKER="${DOCKER:-docker}"
readonly REUSE_INPUTS="${REUSE_INPUTS:-}"
readonly REGISTRY_ATTEMPTS="${REGISTRY_ATTEMPTS:-4}"
readonly REGISTRY_RETRY_DELAY="${REGISTRY_RETRY_DELAY:-10}"
if [[ ! "${REGISTRY_ATTEMPTS}" =~ ^[1-9][0-9]*$ || ! "${REGISTRY_RETRY_DELAY}" =~ ^[0-9]+$ ]]; then
	echo "REGISTRY_ATTEMPTS must be a positive integer and REGISTRY_RETRY_DELAY a whole number of seconds" >&2
	exit 1
fi

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

# THE FIVE IMAGES THE GATE RUNS IN, AND WHY IT IS FIVE AND NOT TWENTY-SEVEN.
#
# Every `-gg` variant carries the SAME toolchain tree: `containers/gg/Dockerfile` copies one
# builder image's `/opt` to the same absolute path in each, so the bytes are identical
# variant to variant (7826 files, 2 162 625 760 bytes — that COPY's comment carries the
# measurement, and separately the fact that the LAYER holding them is one digest in every
# variant, which this argument does not rest on). What can differ between two variants is
# therefore not the
# toolchain but the ENVIRONMENT it has to run in, and the question this list answers is how
# many distinct environments the twenty-seven are.
#
# IT IS NOT "THE NUMBER OF PARENTS", which is what this list first said and got wrong. There
# are two external parents — the Debian `node:*-bookworm-slim` and `blender`'s `ubuntu:26.04`
# — but a run image is not its parent: a dozen of them `apt-get install` packages of their
# own on top of `base`, and a package brings its whole dependency closure with it. Measured
# on the local store, with the C# arm's own missing library as the probe:
#
#   test-cabinet-sprite-gg         no libicu at all
#   test-cabinet-base-wasm-gg      no libicu at all
#   test-cabinet-voxel-gg          libicu{uc,i18n,data}.so.72, dragged in by mesa-vulkan-drivers
#   test-cabinet-full-stack-3d-gg  libicu{uc,i18n,data}.so.72, by the same mesa install — but
#                                  on top of base-wasm's packages, which voxel-gg has none of
#   test-cabinet-blender-gg        libicu{uc,i18n,data}.so.78, dragged in by blender
#
# So `base-wasm-gg` alone did not answer for `voxel-gg`: in one the vendored ICU is what the
# runtime opens and in the other the image's own copy is there to be found instead, and
# "satisfied by a package something unrelated pulled in" is the exact failure class this
# whole gate exists to end. Grouping the twenty-seven by the environment their Dockerfiles
# build — the external reference the lineage is rooted at, plus every package `apt` installs
# anywhere along the chain — gives FIVE groups, and these are one of each:
#
#   sprite-gg         node:*-bookworm-slim + the shared base's packages
#   base-wasm-gg      …and base-wasm's binaryen, libssl-dev, pkg-config
#   voxel-gg          the base's packages and the mesa stack (libvulkan1,
#                     mesa-vulkan-drivers) the render images add, but NOT base-wasm's
#   full-stack-3d-gg  …base-wasm's AND the mesa stack: the 3D full-stack image is the only
#                     run image that is `FROM` base-wasm and installs mesa, because it is
#                     the only one that both compiles Rust to wasm and renders a preview
#   blender-gg        ubuntu:26.04 + blender's packages
#
# THE FOURTH GROUP IS THE ONE THAT LOOKS REDUNDANT AND IS NOT. `full-stack-3d-gg` carries the
# same `libicu72` `voxel-gg` does, from the same package, so the C# arm's original bug would
# be answered identically in both — but the grouping is not "which ICU is present", it is the
# whole package set, and an arm that resolves a library differently because binaryen's or
# libssl-dev's closure is also there is exactly the accident nobody would predict in advance.
# That is the reason this list is derived from the Dockerfiles rather than reasoned about:
# `assert_gg_environments` would refuse the build if two entries here were the same
# environment, so a redundant representative cannot be added by mistake either.
#
# `base` itself is in no group: it has no `-gg` variant, so no arm ever runs there.
#
# That is the whole argument, and it is only as good as "five groups" — which is why
# `assert_gg_environments` re-derives the grouping from the Dockerfiles on every gated build
# instead of trusting this comment, and `assert_gg_lineages` separately pins the two external
# references the grouping is rooted at. The C# bug was in the ENVIRONMENT (a missing ICU),
# and `--link` says nothing whatever about what a variant is layered onto.
readonly GG_SELFCHECK_IMAGES=(sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg)

# The external images the run images' lineages are rooted at, and the exact references they
# name. `assert_gg_lineages` requires the set derived from `containers/*/Dockerfile` to be
# exactly this, so a third lineage — or a bump of either of these two — stops a gated build
# and has to be answered rather than absorbed. A bump is worth stopping for: the blender
# image works today only because Ubuntu's own package closure happens to drag in an ICU,
# which is precisely the kind of accident a new base image silently withdraws.
#
# This is a PIN and not the coverage argument. What makes five images answer for twenty-seven
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
# WebAssembly toolchain. End-to-end runs resolve this image, and the two full-stack
# images (2d/3d), adversarial, and performance are each built `FROM` it (they no longer
# install a Rust toolchain of their own), so it stays in lockstep with the base within
# a build.
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
# through the GG_TOOLCHAINS_IMAGE build arg instead of paying for the fetch again.
#
# IT IS ONE MORE COPY OF THE TREE IN THE REGISTRY, AND THE ONLY EXTRA ONE.
# `containers/gg/Dockerfile` copies its `/opt` with `--link`, so every variant carries ONE
# digest for the tree and the registry stores those bytes once, mounting them into each
# variant's repository after the first push. Read the comment on that COPY, which carries
# the measurement and says why the source path is `/opt` and not `/opt/gg`, before touching
# it. What keeps the build agent's disk survivable is the reclaim below rather than the
# sharing: the local store still chains each variant's copy under its own parent.
#
# Because it is not in image-names.sh, the pipeline's run-image manifest job, which is
# driven by that list, appends this one by name to what it hands scripts/ci/manifest.sh.
readonly GG_TOOLCHAINS_IMAGE="${IMAGE_NAME_PREFIX}gg-toolchains:${IMAGE_TAG}"
# The AUDIO STORE image: every published audio pack, as data. Like GG_TOOLCHAINS_IMAGE it
# is not a RUN image — nothing executes in it and nothing resolves it for a run; it is a
# `FROM scratch` tree that the DRIVER image copies in at `/opt/tcab-audio` and that
# `scripts/fetch-audio-store.sh` pulls onto a local checkout. And like it, it IS pushed,
# and it is deliberately absent from image-names.sh for the same mechanical reason:
# `build_one` dispatches on that list by name, so an entry there would route it through
# `build_asset_image`. The pipeline fuses this one in its own scripts/ci/manifest.sh call.
#
# A run container is given the packs its test case declares in `[audio] packs`, staged out
# of this store when the container starts (`crates/core/src/audio_stage.rs`). Publishing
# the store as its own image is what keeps the R2 presign credentials to ONE build: the
# driver image build takes the published image (the pipeline passes the one it pushed at
# the same commit), `make -C deployments/local images` builds its own, and a contributor's
# `./build.sh` skips it, so a clean clone with no credential can build every run image.
# See containers/audio-store/Dockerfile.
readonly AUDIO_STORE_IMAGE="${IMAGE_NAME_PREFIX}audio-store:${IMAGE_TAG}"
readonly ADVERSARIAL_IMAGE="${IMAGE_NAME_PREFIX}adversarial:${IMAGE_TAG}"
readonly PERFORMANCE_IMAGE="${IMAGE_NAME_PREFIX}performance:${IMAGE_TAG}"

# In push mode IMAGE_REGISTRY is required: a digest reference must be
# registry-qualified to be pullable by a runner.
if [[ -n "${PUSH}" && -z "${IMAGE_REGISTRY}" ]]; then
	echo "PUSH=1 requires IMAGE_REGISTRY (e.g. testcabinet.azurecr.io)" >&2
	exit 1
fi

# ---------------------------------------------------------------------------
# Reusing what the registry already holds
# ---------------------------------------------------------------------------
# Under REUSE_INPUTS, every image has a digest of its inputs (the table's line, computed
# by scripts/ci/run-image-inputs.sh from the Dockerfile, the context paths it copies and
# its parents' digests; that script's header says exactly what goes in). An image is
# pushed under two tags: IMAGE_TAG, which is the commit's, and `inputs-<digest>-<arch>`,
# which names what it was built from. Before an image is built, its inputs tag is looked
# up in the registry: found, the image is REUSED — the commit's tag is created on top of
# the pushed manifest with `buildx imagetools create`, a manifest write and no blob
# transfer — and nothing is built, pushed or reclaimed for it. An image whose inputs
# changed is built as ever, from parents that are local because this run built them or
# because they are pulled here, from their own inputs tags, the first time a child needs
# one. A reused image in GG_SELFCHECK_IMAGES is still pulled and driven through `gg
# selfcheck` with this run's gg: the check gates the image against the gg of the day,
# and the reuse only says the image is the one checked last time, not that the gg is.
#
# `tools`, which is never given a commit's tag, is pushed under its inputs tag alone, so
# a later run whose asset images changed pulls the builder instead of compiling it.
#
# The parent map is the table's, which mirrors this script's dispatch; the two must
# agree, and scripts/ci/run-image-inputs.sh says so at its own parent map.
declare -A INPUTS_DIGEST=()
declare -A INPUTS_PARENTS=()
declare -A REUSED=()
REUSE_ARCH=""
if [[ -n "${REUSE_INPUTS}" ]]; then
	if [[ -z "${PUSH}" ]]; then
		echo "REUSE_INPUTS needs PUSH=1: a reused image is a pushed one, and a built one is pushed under its inputs tag" >&2
		exit 1
	fi
	if [[ ! -r "${REUSE_INPUTS}" ]]; then
		echo "REUSE_INPUTS names no readable file: '${REUSE_INPUTS}'" >&2
		exit 1
	fi
	while read -r reuse_name reuse_digest reuse_parents; do
		[[ -n "${reuse_name}" && -n "${reuse_digest}" ]] || continue
		INPUTS_DIGEST["${reuse_name}"]="${reuse_digest}"
		INPUTS_PARENTS["${reuse_name}"]="${reuse_parents:--}"
	done <"${REUSE_INPUTS}"
	# A parent the table lacks has no inputs tag to pull, and a child reused on the
	# strength of a digest that does not cover its parent would be the wrong image.
	for reuse_name in "${!INPUTS_PARENTS[@]}"; do
		for reuse_parents in ${INPUTS_PARENTS[$reuse_name]//,/ }; do
			[[ "${reuse_parents}" == "-" || -n "${INPUTS_DIGEST[$reuse_parents]:-}" ]] && continue
			echo "REUSE_INPUTS: ${reuse_name} is built from ${reuse_parents}, which the table does not list" >&2
			exit 1
		done
	done
	unset reuse_name reuse_digest reuse_parents
	case "$(uname -m)" in
		x86_64 | amd64) REUSE_ARCH=amd64 ;;
		aarch64 | arm64) REUSE_ARCH=arm64 ;;
		*)
			echo "REUSE_INPUTS: unsupported architecture '$(uname -m)'" >&2
			exit 1
			;;
	esac
fi
readonly REUSE_ARCH

# The registry tag an image's inputs digest names, for this architecture.
inputs_ref() {
	local name="$1"
	echo "${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}:inputs-${INPUTS_DIGEST[$name]}-${REUSE_ARCH}"
}

registry_has() {
	"$DOCKER" buildx imagetools inspect "$1" >/dev/null 2>&1
}

# Runs one registry round trip that writes or fetches (a push, a pull, a manifest write),
# trying it again when it fails. A registry that refuses a connection for a moment is a
# failure one agent meets mid-build and the next attempt clears; a staging build lost an
# arm64 commit tag to exactly that, a `connect: connection refused` on one blob upload.
# Each of these is idempotent — a push sends only the blobs the registry lacks, a pull
# fetches only the layers the store lacks, a manifest write names a digest — so trying
# again is safe. When every attempt fails it returns the last one's status, and `set -e`
# in the caller ends the build there. `registry_has` is not retried: its "no" is an
# answer, and a transient failure there costs a rebuild, never a missing image.
registry_retry() {
	local attempt=1 status
	while true; do
		status=0
		"$@" || status=$?
		[[ "${status}" -ne 0 ]] || return 0
		if ((attempt >= REGISTRY_ATTEMPTS)); then
			echo "==> ERROR: \`$*\` failed ${attempt} time(s), exiting ${status}; giving up" >&2
			return "${status}"
		fi
		echo "==> WARNING: \`$*\` failed (exit ${status}, attempt ${attempt} of ${REGISTRY_ATTEMPTS}); retrying in $((REGISTRY_RETRY_DELAY * attempt))s" >&2
		sleep "$((REGISTRY_RETRY_DELAY * attempt))"
		attempt=$((attempt + 1))
	done
}

# True when the image is in the table and its inputs tag is in the registry. A name the
# table does not carry is built; an unreachable registry reads as absent, which builds
# too.
reuse_available() {
	local name="$1"
	[[ -n "${REUSE_INPUTS}" && -n "${INPUTS_DIGEST[$name]:-}" ]] || return 1
	registry_has "$(inputs_ref "$name")"
}

# Pushes a built image under its inputs tag, after push_and_pin pushed it under
# IMAGE_TAG: the layers are all there, so this is a manifest write.
push_inputs_tag() {
	local local_image="$1" name="$2" ref
	[[ -n "${REUSE_INPUTS}" && -n "${INPUTS_DIGEST[$name]:-}" ]] || return 0
	ref="$(inputs_ref "$name")"
	"$DOCKER" tag "${local_image}" "${ref}"
	registry_retry "$DOCKER" push --quiet "${ref}" >&2
	echo "==> ${name} inputs tag: ${ref}" >&2
}

# Retags the pushed image the inputs tag names for this commit, and drives gg selfcheck
# in it if it is one of the representatives. Prints the same reference line a build
# does, so a log reads the same either way. A second call for the same image (a layer
# rule and the final loop can both reach one) is a no-op.
reuse_image() {
	local name="$1" ref local_image repo digest
	[[ -z "${REUSED[$name]:-}" ]] || return 0
	ref="$(inputs_ref "$name")"
	local_image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	echo "==> reusing ${local_image}: its inputs are unchanged and ${ref} is in the registry"
	REUSED["${name}"]=1
	if [[ "${name}" != tools ]]; then
		repo="${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}"
		registry_retry "$DOCKER" buildx imagetools create --tag "${repo}:${IMAGE_TAG}" "${ref}" >&2
		digest="$("$DOCKER" buildx imagetools inspect "${repo}:${IMAGE_TAG}" --format '{{.Manifest.Digest}}')"
		if [[ -z "${digest}" ]]; then
			echo "could not resolve the digest of ${repo}:${IMAGE_TAG} after retagging ${ref}" >&2
			exit 1
		fi
		echo "==> ${name} reference: ${repo}@${digest}"
	fi
	if [[ -n "${GG_SELFCHECK_BIN}" ]] && gg_selfcheck_covers "${name}"; then
		echo "==> pulling ${ref} to drive gg selfcheck in it: a reused representative is checked like a built one" >&2
		registry_retry "$DOCKER" pull --quiet "${ref}" >&2
		"$DOCKER" tag "${ref}" "${local_image}"
		gg_selfcheck "${name}" "${local_image}"
		if [[ -n "${RECLAIM}" ]]; then
			"$DOCKER" image rm "${ref}" "${local_image}" >/dev/null 2>&1 || true
		fi
	fi
}

# Pulls, from their inputs tags, the parents of an image about to be built that this
# run has not built: the ones it reused.
ensure_parents_local() {
	local name="$1" parents parent local_image ref
	[[ -n "${REUSE_INPUTS}" ]] || return 0
	parents="${INPUTS_PARENTS[$name]:--}"
	for parent in ${parents//,/ }; do
		[[ "${parent}" != "-" ]] || continue
		local_image="${IMAGE_NAME_PREFIX}${parent}:${IMAGE_TAG}"
		image_present "${local_image}" && continue
		ref="$(inputs_ref "${parent}")"
		echo "==> pulling ${ref} as ${local_image} (${name} is built from it, and this run reused it)"
		if ! registry_retry "$DOCKER" pull --quiet "${ref}" >&2; then
			echo "ERROR: ${name} is built from ${parent}, which this run neither built nor found as ${ref}." >&2
			exit 1
		fi
		"$DOCKER" tag "${ref}" "${local_image}"
	done
}

# Builds an image, or reuses the pushed one its inputs name. Every build the layer rules
# and the final loop below make goes through here.
produce() {
	local name="$1"
	if reuse_available "${name}"; then
		reuse_image "${name}"
		return 0
	fi
	ensure_parents_local "${name}"
	case "${name}" in
		tools) build_tools ;;
		gg-toolchains) build_gg_toolchains ;;
		*) build_one "${name}" ;;
	esac
}

# Push a locally-built image to the registry under a tag, then resolve and print
# its pushed digest reference as `==> <name> reference: repo@sha256:...`. The digest is
# read back from the pushed manifest so the reference pins exactly what landed in the
# registry. Arguments: the local image tag, and the image's short name (e.g. base,
# sprite, sprite-sheet, adversarial) used to build its registry repository.
#
# CALL IT AS A COMMAND, NEVER INSIDE `$(...)`. Bash does not carry `set -e` into a command
# substitution, so every caller once read `reference="$(push_and_pin ...)"` and a push that
# failed there was not noticed: the function went on to push the inputs tag, printed a
# reference, and returned 0, the reclaim removed the image, and the commit's tag was
# missing from the registry until the multi-arch fuse failed on it half an hour later.
# Printing the reference line here is what lets the callers run it directly.
push_and_pin() {
	local local_image="$1"
	local name="$2"
	local repo="${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}"
	local pushed="${repo}:${IMAGE_TAG}"

	echo "==> tagging ${local_image} as ${pushed}" >&2
	"$DOCKER" tag "${local_image}" "${pushed}"
	echo "==> pushing ${pushed}" >&2
	registry_retry "$DOCKER" push "${pushed}" >&2
	push_inputs_tag "${local_image}" "${name}"

	# Resolve the pushed image's digest into a pullable repo@digest reference.
	local digest
	digest="$("$DOCKER" inspect --format '{{index .RepoDigests 0}}' "${pushed}")"
	if [[ -z "${digest}" ]]; then
		echo "could not resolve a pushed digest for ${pushed}" >&2
		exit 1
	fi
	echo "==> ${name} reference: ${digest}"
}

# ---------------------------------------------------------------------------
# Reclaiming disk as the build goes
# ---------------------------------------------------------------------------
# A full PUSH build builds the fifty-five names `containers/image-names.sh` lists, plus the
# two builder images and the audio store. Twenty-seven of the fifty-five are `-gg` variants
# carrying a 2.2 GB `/opt/gg`. `containers/gg/Dockerfile` copies that tree with `--link` so
# that every variant's layer carries ONE digest and the registry stores it once — but the
# LOCAL store does not share it: a layer sits under its parent's chain there, and every
# variant has a different parent. So the local store accrues ~2.2 GB per variant,
# twenty-seven of them is ~60 GB, and a build agent has under 40 GB.
#
# THE RECLAIM BELOW IS CORRECT WHETHER OR NOT THAT LAYER IS DEDUPED ANYWHERE, which is the
# whole point of it: it rests on no property of the builder or the registry. With it the peak
# is the toolchain builder, one resident variant and the rest of the set — around 8 GB.
#
# IT IS OFF UNLESS `RECLAIM=1` IS SET WITH `PUSH=1`, and `scripts/ci/run-images.sh` is the
# only caller that sets it. Pushing is something `containers/README.md` documents a developer
# doing from their own box; the prune below is not something that should happen to a
# developer's daemon as a side effect of it.
#
# WHAT IS SAFE TO REMOVE, AND WHEN. Every image here is built FROM a LOCAL tag, so removing
# one too early breaks a later build. Within one invocation the parent map is:
#
#   tools            -> every asset image and both full-stack images
#   gg-toolchains    -> every -gg variant
#   base             -> base-wasm and every asset image
#   base-wasm        -> full-stack-2d/3d, adversarial, performance
#   full-stack-2d    -> game-jam, and full-stack-2d-gg
#   any other <name> -> <name>-gg, and nothing else
#   any <name>-gg    -> nothing at all
#
# The last two lines are what makes this cheap, and they are a property of
# `containers/image-names.sh`'s order: it lists each variant IMMEDIATELY after its parent, so
# a variant is finished the moment it is pushed and a plain run image is finished the moment
# its variant is pushed. RECLAIM_KEEP holds back the names that outlive their own position in
# that list.
#
# Two of the five are reachable by the reclaim and would break a later build. `base-wasm` is
# the parent of full-stack-2d, full-stack-3d, adversarial and performance, all of which come
# after `base-wasm-gg`; `full-stack-2d` is the parent of `game-jam`, which comes after
# `full-stack-2d-gg`. The other three are named because they are what the whole set is built
# FROM: `base` and `tools` have no variant and so never reach the reclaim, and
# `gg-toolchains` is a `COPY --from` source for every variant there is. A new run image that
# becomes the parent of anything but its own variant belongs here too — the third line
# `containers/image-names.sh`'s header asks for when one is added.
readonly RECLAIM_KEEP=(tools gg-toolchains base base-wasm full-stack-2d)

reclaim_keeps() {
	local name="$1" keep
	for keep in "${RECLAIM_KEEP[@]}"; do
		[[ "${name}" == "${keep}" ]] && return 0
	done
	return 1
}

# The filesystem the container store lives on, and what the daemon says is in it. Printed
# after every variant under RECLAIM so a "no space left on device" partway through the set is
# preceded by the number that explains it, and so the reclaim can be seen to HOLD: the
# available figure should stay flat across the twenty-seven variants rather than fall ~2.2 GB
# each. Best-effort throughout — a diagnostic that can fail the build is worse than no
# diagnostic.
reclaim_report_disk() {
	local root avail pcent
	root="$("$DOCKER" info --format '{{.DockerRootDir}}' 2>/dev/null)" || root=""
	[[ -n "${root}" && -d "${root}" ]] || root=/
	avail="$(df -h --output=avail "${root}" 2>/dev/null | tail -n 1 | tr -d ' ')" || avail="?"
	pcent="$(df -h --output=pcent "${root}" 2>/dev/null | tail -n 1 | tr -d ' ')" || pcent="?"
	echo "==> disk: ${avail:-?} available (${pcent:-?} used) on ${root}" >&2
	"$DOCKER" system df 2>/dev/null | sed 's/^/    /' >&2 || true
}

# Drop EVERY tag one image carries: the local one, the registry-qualified one, and under
# REUSE_INPUTS the inputs tag `push_inputs_tag` added. Separate calls so a tag that is not
# there cannot affect the one that is. All of them have to go, because `docker image rm
# <tag>` on an image that still has another tag only UNTAGS it — exit 0, "Untagged: ...",
# and every layer still in the store. That is how the first content-addressed run filled
# both agents: each variant kept its inputs tag, the reclaim reported every removal as
# done, and the available figure fell 2.2 GB per variant exactly as if there were no
# reclaim at all.
#
# THE FAILURE IS REPORTED, unlike the diagnostics below, and the distinction is deliberate:
# this removal is the fix rather than an observation, so a silent failure here is what a
# "no space left on device" fourteen variants later would look like — preceded by a run of
# affirmative-looking lines. So it is the IMAGE, by id, that is checked afterwards, not the
# exit status of the untag: an image still in the store after its tags went is named with
# the tags that hold it. It still does not FAIL the build (the registry already has the
# bytes, and the build may well have room to finish), but it says so. The registry and
# inputs tags are the ones that may legitimately be absent, since only a pushed image
# ever has them, so their status is not reported.
reclaim_image() {
	local name="$1" out id tags
	local local_image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	local pushed="${IMAGE_REGISTRY%/}/${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	# A reused image was never in the local store; there is nothing to reclaim.
	image_present "${local_image}" || return 0
	echo "==> reclaiming ${local_image} (pushed; nothing later is FROM it)" >&2
	id="$("$DOCKER" image inspect --format '{{.Id}}' "${local_image}" 2>/dev/null)" || id=""
	"$DOCKER" image rm "${pushed}" >/dev/null 2>&1 || true
	if [[ -n "${REUSE_INPUTS}" && -n "${INPUTS_DIGEST[$name]:-}" ]]; then
		"$DOCKER" image rm "$(inputs_ref "${name}")" >/dev/null 2>&1 || true
	fi
	if ! out="$("$DOCKER" image rm "${local_image}" 2>&1)"; then
		echo "==> WARNING: ${local_image} was NOT reclaimed; its layers still hold disk:" >&2
		echo "    ${out//$'\n'/$'\n'    }" >&2
		return 0
	fi
	if [[ -n "${id}" ]] && image_present "${id}"; then
		tags="$("$DOCKER" image inspect --format '{{join .RepoTags " "}}' "${id}" 2>/dev/null)" || tags="?"
		echo "==> WARNING: ${local_image} was untagged but NOT reclaimed; ${id} still holds its layers under: ${tags:-no tag}" >&2
	fi
}

# `docker image rm` IS NOT ENOUGH ON ITS OWN, and this is the trap a smaller fix falls into.
# dockerd's BuildKit keeps its own cache record for the snapshot each build step produced,
# and that record holds the layer alive after the image reference is gone — which is why
# `docker system df` accounts "Build Cache" separately and why its reclaimable figure is most
# of the disk by the time this matters.
#
# WHAT THE PRUNE COSTS, stated because it is not nothing and because it does not stop at this
# build. `--all` takes every `--mount=type=cache` record in the builder, not just this
# build's, and on a dev box the default builder is the one embedded BuildKit instance the
# whole daemon shares — so it would also take `deployments/images/services.Dockerfile`'s
# `gg-toolchains` (about 1.9 GB of downloaded SDKs), `gg-target`, `rustup-gg` and
# `gg-toolchain-downloads` mounts, and every other project's build cache on that daemon.
# `deployments/local/Makefile` names relinking gg and re-downloading those toolchains as the
# slowest thing in the repository. THAT IS WHY THE RECLAIM IS GATED ON `RECLAIM=1` RATHER
# THAN ON `PUSH`: a developer's documented `PUSH=1 IMAGE_REGISTRY=…` publish must not pay it.
#
# Inside CI the cost is bounded and small. The agent is a fresh VM whose builder starts empty
# (proven on both pools: every leg of the last image jobs' run pulled `docker/dockerfile:1` and
# its Rust base from Docker Hub at job start), so nothing pre-existing is lost. What is lost
# is within-build: `containers/adversarial` and `containers/performance` build after several
# variants have gone past, so each re-downloads the cargo registry `containers/tools` already
# fetched. That is a few minutes on a job with a six-hour timeout, against a build that
# otherwise does not finish. A threshold or a size-capped prune would avoid it and would also
# be a tunable that can be set wrong, which is the wrong trade for a job CI cannot exercise
# before it merges.
#
# Guarded for DOCKER=podman, which has no `builder prune`.
reclaim_builder_cache() {
	"$DOCKER" builder prune --all --force >/dev/null 2>&1 || true
}

# Called after each image in the main loop has been built, self-checked and pushed. It needs
# BOTH switches: PUSH, because an image that is not in a registry must not be removed from
# the only place it exists, and RECLAIM, because the removal and the prune reach past this
# build and only CI wants them (see `reclaim_builder_cache`). Without them it does nothing at
# all — which is the local path, where the images ARE the product
# (`deployments/local/Makefile` builds with no PUSH and then `docker save`s the set for
# `k3d image import`).
reclaim_after_push() {
	local name="$1" parent
	[[ -n "${PUSH}" && -n "${RECLAIM}" ]] || return 0
	# A reused variant put nothing in the local store, and its parent was not built this
	# run either (a rebuilt parent changes the variant's inputs).
	[[ -z "${REUSED[$name]:-}" ]] || return 0
	# Only a `-gg` variant is finished the moment it is pushed: nothing anywhere is built FROM
	# one. A plain run image still has its variant to come, so it is reclaimed on its
	# variant's way out below, which also keeps it present while the variant pushes and mounts
	# its parent's layers.
	[[ "${name}" == *-gg ]] || return 0
	reclaim_image "${name}"
	parent="${name%-gg}"
	reclaim_keeps "${parent}" || reclaim_image "${parent}"
	reclaim_builder_cache
	reclaim_report_disk
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
	echo "==> building ${TOOLS_IMAGE} (shared asset tooling; not pushed under the commit's tag)"
	"$DOCKER" build \
		-t "${TOOLS_IMAGE}" \
		-f "${SCRIPT_DIR}/tools/Dockerfile" "${SCRIPT_DIR}/.."
	# Under REUSE_INPUTS only, and under its inputs tag only: the builder never gets a
	# commit's tag, but a later run whose asset images changed pulls it from there
	# instead of compiling it.
	push_inputs_tag "${TOOLS_IMAGE}" tools
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
		push_and_pin "${GG_TOOLCHAINS_IMAGE}" gg-toolchains
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
		push_and_pin "${AUDIO_STORE_IMAGE}" audio-store
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
# cover twenty-seven, because /opt/gg is byte-identical and there are two parents", and
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
	# The line scripts/ci/run-images.sh requires. Changing its shape is changing an
	# assertion there.
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

	# The diff ID of the layer that COPY produced. `containers/gg/Dockerfile` asks `--link`
	# to give every variant the SAME one, and says what made them differ once. Printing it
	# makes each build answer that in its own log instead of requiring somebody to read
	# registry manifests by hand, which is how the duplication went unnoticed: the
	# twenty-seven lines of one build must agree. `--format` ends its output with a newline
	# of its own after the template's last `println`, so the blank line is dropped before
	# the last line is taken; taking it before that printed nothing.
	echo "==> ${name} /opt/gg layer: $("$DOCKER" image inspect \
		--format '{{range .RootFS.Layers}}{{println .}}{{end}}' "${image}" 2>/dev/null \
		| sed '/^$/d' | tail -n 1)"

	# BETWEEN THE BUILD AND THE PUSH, AND THAT ORDER IS THE POINT: a variant whose toolchain
	# cannot run in it must never reach a registry, and `set -euo pipefail` plus the `exit 1`
	# inside `gg_selfcheck` is what makes a broken arm end the build here rather than one
	# image later. Only the environment representatives are driven — see GG_SELFCHECK_IMAGES
	# for why five answer for twenty-seven, and `assert_gg_environments` for what keeps that true.
	if [[ -n "${GG_SELFCHECK_BIN}" ]] && gg_selfcheck_covers "${name}"; then
		gg_selfcheck "${name}" "${image}"
	fi

	if [[ -n "${PUSH}" ]]; then
		push_and_pin "${image}" "${name}"
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
		push_and_pin "${BASE_IMAGE}" base
	fi
}

# Build the Rust/wasm base image `FROM` the base built above plus the shared Rust →
# WebAssembly toolchain (Rust + the `wasm32-unknown-unknown` target + wasm-bindgen +
# wasm-pack + binaryen). End-to-end runs resolve this image directly, and the two
# full-stack images, adversarial, and performance are built `FROM` it. Building from
# the local base tag avoids a registry round-trip and keeps this image pinned to the
# base produced in this same invocation. The context is the repository root only for
# `.dockerignore` parity with the other images; this image compiles nothing from
# `crates/` (it installs the public toolchain), so the context is otherwise unused.
build_base_wasm() {
	echo "==> building ${BASE_WASM_IMAGE} (FROM ${BASE_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_IMAGE}" \
		-t "${BASE_WASM_IMAGE}" \
		-f "${SCRIPT_DIR}/base-wasm/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		push_and_pin "${BASE_WASM_IMAGE}" base-wasm
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
		push_and_pin "${image}" "${name}"
	fi
}

# Build a full-stack image: base-wasm plus the asset-generation binaries a full-stack run
# produces the game's own assets with. The argument is the case's asset DIMENSION — `2d` or
# `3d` — which is both the image's name suffix and the directory holding its Dockerfile,
# exactly as `build_asset_image`'s argument is: full-stack-2d bakes the six 2D binaries
# (draw, draw-sheet, particle-2d, sfx-synth, sfx-sample, music) and full-stack-3d bakes
# those plus `voxel`, `voxel-anim`, `particle-3d` and the Mesa software-Vulkan runtime those
# three render their preview PNGs through. A case picks between them with `asset_dimension`
# (see the crate's `harness::resolve_run_image`); each Dockerfile says what is in its image
# and, for the 3D one, what (the meshing families, Blender) is deliberately left out.
#
# ONE FUNCTION BUILDS BOTH BECAUSE THE TWO ARE SIBLINGS. The 3D image is a superset of the
# 2D one by CONTENT, but it is built `FROM` base-wasm rather than `FROM` the 2D tag:
# layering it there would make every 2D run pay for a rebuild of the 3D one, and would put
# the two images in a dependency order that says nothing true about them. Being siblings,
# they differ only in which binaries their Dockerfile copies out of the tooling builder —
# same base, same build args — so what varies between them is the argument below and
# nothing else.
#
# Both are `FROM` base-wasm rather than the base, so a full-stack build may author its
# simulation core in Rust; that is why neither goes through `build_asset_image`.
#
# NEITHER BAKES ANY AUDIO. `sfx-sample` and `music` read the packs the run's test case
# declares in `[audio] packs`, staged into `/opt/audio` when the container starts, so
# neither build needs audio object-store credentials and publishing a new pack version
# rebuilds neither of them.
build_full_stack() {
	local dimension="$1"
	local name="full-stack-${dimension}"
	local image="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"

	echo "==> building ${image} (FROM ${BASE_WASM_IMAGE})"
	"$DOCKER" build \
		--build-arg "BASE_IMAGE=${BASE_WASM_IMAGE}" \
		--build-arg "TOOLS_IMAGE=${TOOLS_IMAGE}" \
		-t "${image}" \
		-f "${SCRIPT_DIR}/${name}/Dockerfile" "${SCRIPT_DIR}/.."

	if [[ -n "${PUSH}" ]]; then
		push_and_pin "${image}" "${name}"
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
		push_and_pin "${image}" game-jam
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
		push_and_pin "${ADVERSARIAL_IMAGE}" adversarial
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
		push_and_pin "${image}" blender
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
		push_and_pin "${PERFORMANCE_IMAGE}" performance
	fi
}

# Build one image by its short name, dispatching to the right builder: base,
# adversarial, performance, the two full-stack images, game-jam and blender have dedicated
# builders; everything else — sfx-sample and music included, since neither carries a
# palette of its own any more — is a plain asset-generation image built `FROM` the base.
build_one() {
	case "$1" in
		base)         build_base ;;
		base-wasm)    build_base_wasm ;;
		adversarial)  build_adversarial ;;
		performance)  build_performance ;;
		# The two full-stack images are `FROM` base-wasm rather than the base and bake
		# their asset binaries out of the shared tooling builder, so they share a builder
		# of their own (see build_full_stack — the argument is the dimension a case
		# selects with `asset_dimension`). Neither may fall through to `*)`, which would
		# build it `FROM` the plain base: an image that builds, resolves, and has no Rust
		# toolchain in it.
		full-stack-2d) build_full_stack 2d ;;
		full-stack-3d) build_full_stack 3d ;;
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
# The canonical image list lives in image-names.sh so build.sh and the pipeline's
# manifest job can't drift (see that script's header).
mapfile -t ALL_NAMES < <("${SCRIPT_DIR}/image-names.sh")

# Before anything is built: if this build is claiming to gate the `-gg` variants, the claim
# has to still be true. Both halves of it — the two external references the lineages are
# rooted at, and the five environments those roots plus the images' own packages make. Cheap
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

# Whether an existing parent image was built BEFORE the Dockerfile that defines it
# was last changed.
#
# Being present is not the same as being current, and the difference is silent: a
# base built last month still satisfies every `FROM`, so a change at that layer
# reaches nothing until someone happens to name `base` by hand. Every image built in
# between resolves, runs, and is missing whatever the change added — which is exactly
# how run images shipped without the `/opt/audio` staging root the base creates,
# failing every full-stack run that stages an audio palette while the leaf images
# themselves were rebuilt daily.
#
# The two base layers COPY nothing, so their Dockerfile is the whole of their input
# and its mtime is an exact signal. A leaf that also bakes binaries out of the tools
# builder has more inputs than this sees, so the check is a lower bound there: it
# never holds back a rebuild that is due, it can only miss one. A fresh checkout
# stamps every file with the checkout time and so rebuilds once, which is the safe
# direction to be wrong in.
parent_is_stale() {
	local image="$1" dockerfile="$2" built changed
	built="$("$DOCKER" image inspect --format '{{.Created}}' "$image" 2>/dev/null)" || return 1
	built="$(date -d "${built}" +%s 2>/dev/null)" || return 1
	changed="$(stat -c %Y "${dockerfile}" 2>/dev/null)" || return 1
	(( changed > built ))
}

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
# first if selected; otherwise, if any dependent image was selected but its parent is
# missing or out of date, build the parent so the `FROM ${BASE_IMAGE}` in those
# Dockerfiles resolves to something current. A parent that is present AND current is
# reused untouched.
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
# the two full-stack images, adversarial, and performance. `game-jam` is `FROM`
# full-stack-2d (which is `FROM` base-wasm), so it needs base-wasm present too. Such a
# selection needs base-wasm present, which in turn needs base — all handled below.
select_needs_base_wasm() {
	local x
	for x in "${targets[@]}"; do
		case "$x" in
			full-stack-2d | full-stack-3d | game-jam | adversarial | performance) return 0 ;;
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

# THE BASELINE DISK READING, before anything is built. `reclaim_after_push` reports after
# every variant, but the first of those lands after `base-wasm-gg`, the third of fifty-five
# names — so a failure in `tools` or `gg-toolchains`, which is where the 2.2 GB toolchain tree
# is first materialised, used to produce no figure at all. This is the one that says what the
# agent started with. Under RECLAIM only, so a local build's output is unchanged.
if [[ -n "${PUSH}" && -n "${RECLAIM}" ]]; then
	echo "==> disk before the first image"
	reclaim_report_disk
fi

# Layer 0 — the shared asset tooling, built before anything that copies out of it.
# ALWAYS rebuilt (never "reused if present"): it carries the compiled binaries, so a
# stale one would bake outdated tooling into an otherwise-fresh run image. Its cargo
# cache mounts make a no-change rebuild near-instant. It is independent of the base,
# so it is built first.
if select_needs_tools; then
	produce tools
fi

# Layer 0b — the gg language toolchains, built before any `-gg` variant copies them out.
# ALWAYS rebuilt, for the same reason the asset tooling is: it carries the compilers a gg
# run's programs are judged by, so a stale one would bake yesterday's toolchain into an
# otherwise-fresh variant. It is independent of the base, so it is built here.
if select_needs_gg_toolchains; then
	produce gg-toolchains
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
#
# A parent is rebuilt when it is selected, when it is absent, and when it is out of
# date with its own Dockerfile — see `parent_is_stale` for why the last of those is
# not a convenience. Staleness also CASCADES: a base-wasm that is current against its
# own Dockerfile is still wrong the moment the base underneath it has been rebuilt,
# because everything the new base carries is missing from it.
base_rebuilt=""
base_wasm_rebuilt=""
if select_has base; then
	produce base
	base_rebuilt=1
elif select_needs_base && ! image_present "${BASE_IMAGE}"; then
	echo "==> base image ${BASE_IMAGE} not present; building it first (every image but blender is FROM it, directly or via base-wasm)"
	produce base
	base_rebuilt=1
elif select_needs_base && parent_is_stale "${BASE_IMAGE}" "${SCRIPT_DIR}/base/Dockerfile"; then
	echo "==> base image ${BASE_IMAGE} is older than containers/base/Dockerfile; rebuilding it (every image FROM it would inherit the stale layer)"
	produce base
	base_rebuilt=1
fi

# Layer 2 — base-wasm (now that base is present if it was needed).
if select_has base-wasm; then
	produce base-wasm
	base_wasm_rebuilt=1
elif select_needs_base_wasm && ! image_present "${BASE_WASM_IMAGE}"; then
	echo "==> base-wasm image ${BASE_WASM_IMAGE} not present; building it first (full-stack-2d/full-stack-3d/adversarial/performance are FROM it)"
	produce base-wasm
	base_wasm_rebuilt=1
elif select_needs_base_wasm \
	&& { [[ -n "${base_rebuilt}" ]] || parent_is_stale "${BASE_WASM_IMAGE}" "${SCRIPT_DIR}/base-wasm/Dockerfile"; }; then
	echo "==> base-wasm image ${BASE_WASM_IMAGE} is out of date with the layer below it; rebuilding it"
	produce base-wasm
	base_wasm_rebuilt=1
fi

# Layer 3 — full-stack-2d (the parent of game-jam). When full-stack-2d itself is
# selected it is built in the main loop below; but when only game-jam is selected we
# must build its parent first so the `FROM ${FULL_STACK_2D_IMAGE}` resolves. An
# existing full-stack-2d is reused when it is current with the layers it is built on
# and with its own Dockerfile, and rebuilt when it is not.
if ! select_has full-stack-2d \
	&& select_needs_full_stack_2d \
	&& { ! image_present "${FULL_STACK_2D_IMAGE}" \
		|| [[ -n "${base_wasm_rebuilt}" ]] \
		|| parent_is_stale "${FULL_STACK_2D_IMAGE}" "${SCRIPT_DIR}/full-stack-2d/Dockerfile"; }; then
	echo "==> full-stack-2d image ${FULL_STACK_2D_IMAGE} is absent or out of date; building it first (game-jam is FROM it)"
	# full-stack-2d bakes six binaries out of the tooling builder. A game-jam-only
	# selection did not trigger the layer-0 rule (game-jam inherits its binaries and
	# needs no tooling of its own), so build the tooling here before its parent.
	produce tools
	produce full-stack-2d
fi

# Layer 4 — the parent of every selected `-gg` variant that is missing or out of date.
# Selecting only a variant must not silently build it `FROM` an image that is not
# there, nor onto one built before the layers under it changed — a variant is one COPY
# onto its parent, so whatever the parent is missing, the variant is missing too. An
# existing, current parent is reused untouched, exactly as full-stack-2d is above. The
# `image_present` re-check is because the layers above may have just built it.
for name in "${gg_parents[@]}"; do
	parent_ref="${IMAGE_NAME_PREFIX}${name}:${IMAGE_TAG}"
	if ! image_present "${parent_ref}"; then
		echo "==> ${name} image not present; building it first (${name}-gg is FROM it)"
	elif [[ -n "${base_rebuilt}" || -n "${base_wasm_rebuilt}" ]]; then
		echo "==> ${name} image is older than the base layers just rebuilt; rebuilding it (${name}-gg is FROM it)"
	elif parent_is_stale "${parent_ref}" "${SCRIPT_DIR}/${name}/Dockerfile"; then
		echo "==> ${name} image is older than containers/${name}/Dockerfile; rebuilding it (${name}-gg is FROM it)"
	else
		continue
	fi
	produce "${name}"
done
unset parent_ref

# Build each selected image. The base layers and the tooling builder are already
# handled above. The canonical order in image-names.sh places full-stack-2d before
# game-jam, so a full build builds the parent before the jam image.
# The reclaim sits HERE and not inside `build_one`, deliberately: layer 4 above calls
# `build_one` to build a `-gg` variant's absent parent, and that parent has to survive until
# its variant is built.
for name in "${selected[@]}"; do
	[[ "$name" == base || "$name" == base-wasm || "$name" == tools || "$name" == audio-store ]] && continue
	produce "$name"
	reclaim_after_push "$name"
done
echo "==> done"
