#!/usr/bin/env bash
# Builds the images the pipeline's gate tracks run inside, and pushes them.
#
#   scripts/ci/ci-image.sh inputs    <track>   one input path per line
#   scripts/ci/ci-image.sh tag       <track>   v1-<12 hex>
#   scripts/ci/ci-image.sh reference <track>   <repository>:<tag>
#   scripts/ci/ci-image.sh build     <track>   build and push, or skip
#
# There is one image per track, because the tracks need disjoint toolchains: the
# Rust track wants a Rust toolchain and gg's eleven program-language toolchains,
# the web track wants Node, a browser and kubectl, and neither wants the other's
# gigabytes. Each is built from ci/images/<track>.Dockerfile with the repository
# root as its context. See ci/images/README.md for what is in each one and why.
#
# This script decides no version. The pins come out of
# .devcontainer/docker-compose.yml's `x-devcontainer-build-args` anchor, which is
# the one place a tool's version is written, and ci/images/build-args.sh reads
# them back out as build arguments. A pin an image consumes is the pin a
# developer's container consumes.
#
# ## The tag
#
# A tag is the content of the files the image is built from, so the same
# checkout always names the same tag and two different checkouts never name the
# same one. Nothing is ever pushed twice to a tag, and `latest` is never used:
# azure-pipelines.yml writes a tag from here literally in its
# `resources.containers` block, and a tag that could be rewritten would make that
# pin a statement about nothing.
#
# The digest covers two things: `git ls-files -s` over the paths `inputs` prints
# (mode, object id and path per file, git's own view of the checkout), and
# ci/images/build-args.sh's output, which is exactly the pins the image consumes.
# The second half is why .devcontainer/docker-compose.yml is not an input:
# bumping a pin no CI image installs must not retire a good image, and bumping
# one it does install must.
#
# IMAGE_SCHEMA is the escape hatch for what the files do not pin: the
# `ubuntu:26.04` tag both Dockerfiles open with and the apt package sets they
# install. When one of those has moved and the images have to be rebuilt anyway,
# bump it and every track's tag retires at once.
#
# ## Asking the registry whether a tag is there
#
# `tcab-acr` is a Docker Registry service connection: the Docker@2 task writes
# its credential into the agent's docker configuration, and the existence check
# reads it back through `docker buildx imagetools inspect`, which is a first-class
# buildx command and the toolchain this repository pushes with.
#
# ## One architecture, built natively
#
# The images are linux/amd64 only, built on a hosted amd64 agent without QEMU.
# Nothing but a Microsoft-hosted agent runs them. The `gg_arm64` job runs on the
# organisation's arm64 pool and provisions its toolchains itself, which is the
# one place the pipeline still installs a toolchain per run.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly IMAGE_SCHEMA="v1"
readonly RUST_IMAGE="${CI_REGISTRY}/ubuntu-test-cabinet-rust-cicd"
readonly WEB_IMAGE="${CI_REGISTRY}/ubuntu-test-cabinet-web-cicd"

# The default `docker` driver can neither write a registry cache nor `--push`,
# so a docker-container builder is created for the push.
readonly BUILDER="tcab-ci-images"

usage() {
	cat >&2 <<'USAGE'
usage: scripts/ci/ci-image.sh <inputs|tag|reference|build> <rust|web>
USAGE
	exit 1
}

# The files each image is built from: what the tag digests and, as directories,
# what azure-pipelines-ci-images.yml triggers on. Each Dockerfile's own
# `.dockerignore` is in its list because it decides what the build can see of the
# checkout: narrow it by one path and the COPY that reads it fails. This script
# and build-args.sh are in every list because they decide the command line, the
# build arguments and where the result is pushed.
#
# The Rust list is the slice ci/images/rust.Dockerfile stages for gg's toolchain
# installers, written as the git pathspecs those families are, so a new arm's
# installer or version file joins the digest without an edit here.
inputs() {
	case "$1" in
	rust)
		cat <<'PATHS'
ci/images/build-args.sh
ci/images/rust.Dockerfile
ci/images/rust.Dockerfile.dockerignore
packages/gg-sandbox-*/*-version.sh
packages/gg-sandbox-purescript/spago.lock
packages/gg-sandbox-purescript/spago.yaml
packages/gg-sandbox-python/build.sh
packages/gg-sandbox-python/requirements.txt
packages/gg-sandbox-rust/Cargo.lock
packages/gg-sandbox-rust/Cargo.toml
packages/gg-sandbox/build.sh
packages/gg-sandbox/guest/Cargo.lock
packages/gg-sandbox/guest/Cargo.toml
rust-toolchain.toml
scripts/ci/ci-image.sh
scripts/ci/fetch.sh
scripts/ci/install-*.sh
scripts/ci/lib.sh
scripts/gg-*.sh
PATHS
		;;
	web)
		cat <<'PATHS'
ci/images/build-args.sh
ci/images/web.Dockerfile
ci/images/web.Dockerfile.dockerignore
scripts/ci/ci-image.sh
PATHS
		;;
	*)
		echo "ci-image.sh: unknown track '$1'; expected 'rust' or 'web'" >&2
		exit 1
		;;
	esac
}

# One registry repository per track, so the registry's own listing says which
# track an image belongs to without reading its tag.
image() {
	case "$1" in
	rust) echo "$RUST_IMAGE" ;;
	web) echo "$WEB_IMAGE" ;;
	*)
		echo "ci-image.sh: unknown track '$1'; expected 'rust' or 'web'" >&2
		exit 1
		;;
	esac
}

# Each half of the digest is captured and checked on its own rather than piped
# straight into sha256sum, because a failure on the left of a pipeline would be
# noticed only after a digest of whatever did arrive had been printed, and a tag
# on stdout is exactly what a caller reads.
tag() {
	local track="$1"
	local paths=()
	mapfile -t paths < <(inputs "$track")

	# `--error-unmatch` turns the likeliest mistake, an input file that has not
	# been staged, into git's own "Did you forget to 'git add'?". The digest is
	# the index, so an unstaged file contributes nothing to it.
	local listing pins
	if ! listing="$(git ls-files -s --error-unmatch -- "${paths[@]}")"; then
		echo "ci-image.sh: the ${track} image's inputs above are not in git's index, so its tag cannot be computed" >&2
		return 1
	fi
	if ! pins="$(ci/images/build-args.sh "$track")"; then
		echo "ci-image.sh: ci/images/build-args.sh ${track} failed; the pins this image is built from are not available" >&2
		return 1
	fi

	printf '%s\n%s\n' "$listing" "$pins" | sha256sum | cut -c 1-12 | sed "s/^/${IMAGE_SCHEMA}-/"
}

reference() {
	local track="$1"
	local repository image_tag
	if ! repository="$(image "$track")"; then
		return 1
	fi
	if ! image_tag="$(tag "$track")"; then
		return 1
	fi
	printf '%s:%s\n' "$repository" "$image_tag"
}

build() {
	local track="$1"
	local repository ref pins_text
	if ! repository="$(image "$track")"; then
		return 1
	fi
	if ! ref="$(reference "$track")"; then
		return 1
	fi

	# The point of a content-addressed tag: the image this checkout describes may
	# already have been built, on the branch that introduced the change that
	# named it, and a merge of that branch must not build it again. The check
	# errs in the safe direction, reading an unreachable registry or a missing
	# credential as "not there", which costs a build that then fails at `--push`
	# with the real reason in the log.
	if docker buildx imagetools inspect "$ref" >/dev/null 2>&1; then
		echo "${ref} is already in the registry. Nothing to build."
		return 0
	fi
	echo "${ref} is not in the registry. Building it."

	docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null 2>&1 ||
		docker buildx use "$BUILDER"

	if ! pins_text="$(ci/images/build-args.sh "$track")"; then
		echo "ci-image.sh: ci/images/build-args.sh ${track} failed; refusing to build an image with no pins" >&2
		return 1
	fi
	local pins=()
	mapfile -t pins <<<"$pins_text"

	local build_args=()
	local pin
	for pin in "${pins[@]}"; do
		build_args+=(--build-arg "$pin")
	done

	# A registry layer cache per track, so a change to one late step does not
	# reinstall a Rust toolchain or a set of program-language toolchains.
	# `mode=max` keeps the intermediate layers, which is what makes a partial
	# rebuild possible. The cache is a repository of its own and `latest` there is
	# fine: nothing pins it and it is meant to be overwritten.
	docker buildx build \
		--platform linux/amd64 \
		--file "ci/images/${track}.Dockerfile" \
		--tag "$ref" \
		"${build_args[@]}" \
		--cache-from "type=registry,ref=${repository}-cache:latest" \
		--cache-to "type=registry,ref=${repository}-cache:latest,mode=max" \
		--push \
		.

	echo "Pushed ${ref}"
}

if [[ $# -ne 2 ]]; then
	usage
fi

# The track is checked here as well as inside the functions that switch on it:
# `inputs` is read through a process substitution whose exit nothing sees, and an
# empty pathspec means every file in the index.
case "$2" in
rust | web) ;;
*)
	echo "ci-image.sh: unknown track '$2'; expected 'rust' or 'web'" >&2
	exit 1
	;;
esac

case "$1" in
inputs) inputs "$2" ;;
tag) tag "$2" ;;
reference) reference "$2" ;;
build) build "$2" ;;
*) usage ;;
esac
