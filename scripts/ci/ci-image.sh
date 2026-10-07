#!/usr/bin/env bash
# Builds the image one of CI's gate tracks runs inside, and pushes it.
#
#   scripts/ci/ci-image.sh build <rust|web>
#
# There is one image per gate track, because the tracks need disjoint
# toolchains: the Rust track wants a Rust toolchain, the web track wants
# node, the browser engines and kubectl, and neither wants the other's couple of
# gigabytes. Each is built from ci/images/<track>.Dockerfile with the workspace root
# as its context, since those files install with the same .devcontainer/
# scripts a developer's image is built with. See ci/images/README.md for what is
# in each one and why.
#
# ## The tag
#
# An image is tagged with the commit the run building it is on: the full
# forty-character object id Azure sets as BUILD_SOURCEVERSION on every step, and
# `git rev-parse HEAD` where that variable is absent, which is a run from a
# terminal. Nothing is computed from the files. azure-pipelines-ci-images.yml
# triggers on the files an image is built from, so a commit that changes one is
# a commit this script runs on, and the tag names that commit. `latest` is never
# pushed to an image repository.
#
# The gates pipeline pulls the images ci/images/tags.yml names: its one
# variable, `ciImageTag`, is the commit of the image pipeline run that built
# them, written there by hand once that run has pushed them. See that file's
# header for the loop, and ci/images/README.md.
#
# Every run builds and pushes. A run on a commit that changed nothing an image
# installs is a registry cache hit end to end and costs a few minutes, and a
# registry that cannot be reached fails at `--push` with the reason in the log
# rather than being read as an image already there.
#
# ## The pins
#
# This script decides no version. The pins come out of
# .devcontainer/docker-compose.yml's `x-devcontainer-build-args` anchor, which
# stays the one place a tool's version is written, and ci/images/build-args.sh
# reads the ones the track's Dockerfile declares an `ARG` for back out of it as
# `NAME=VALUE` lines. Each reaches the build as a `--build-arg`. A pin an image
# consumes is therefore the same pin a developer's image consumes, which is the
# property that makes a gate pass here exactly when it passes in a terminal.
#
# ## Where it is pushed
#
# To `testcabinet.azurecr.io/ubuntu-the-test-cabinet-<track>-cicd:<commit>`, one
# repository per track, so a `docker image ls` and the registry's own listing
# both say which track an image belongs to without reading its tag. The layer
# cache is a repository of its own beside it, `<repository>-cache:latest`.
# `the-test-cabinet-acr` is the Docker Registry service connection the image
# pipeline signs in through before this runs; the push reads the credential
# that sign-in wrote into the agent's docker configuration.
#
# ## One architecture, built natively
#
# These images are linux/amd64 only, and are built on an amd64 agent without
# QEMU or binfmt. Nothing but a Microsoft-hosted agent ever runs them, and those
# are amd64. The devcontainer stays the multi-architecture image, because it is
# built on the developer's own machine. Emulating a second architecture here
# would cost an hour of build time for an image no machine pulls.
set -euo pipefail

readonly REGISTRY="testcabinet.azurecr.io"

# The builder the push needs. The default `docker` driver can neither write a
# registry cache nor `--push`, so a docker-container builder is created.
readonly BUILDER="the-test-cabinet-ci-images"

# The object id a commit is named by, and so the only shape a tag takes.
readonly COMMIT_PATTERN='^[0-9a-f]{40}$'

usage() {
	echo "usage: scripts/ci/ci-image.sh build <rust|web>" >&2
	exit 1
}

# The repository a track's image is pushed to.
image() {
	case "$1" in
	rust | web) echo "${REGISTRY}/ubuntu-the-test-cabinet-$1-cicd" ;;
	*)
		echo "ci-image.sh: unknown track '$1'; expected 'rust' or 'web'" >&2
		return 1
		;;
	esac
}

# The commit the run is on, which is the tag. Azure names it; a terminal asks
# git. Anything but a full object id is refused, because only a full object id
# is a pin ci/images/tags.yml accepts.
commit() {
	local found="${BUILD_SOURCEVERSION:-}"
	if [[ -z "$found" ]] && ! found="$(git rev-parse --verify --quiet HEAD)"; then
		echo "ci-image.sh: BUILD_SOURCEVERSION is not set and this checkout has no commit, so there is nothing to tag the image with" >&2
		return 1
	fi
	if [[ ! "$found" =~ $COMMIT_PATTERN ]]; then
		echo "ci-image.sh: '${found}' is not a full commit id, so it names no image ci/images/tags.yml could pin" >&2
		return 1
	fi
	printf '%s\n' "$found"
}

build() {
	local track="$1"
	local repository tag pins_text
	# Everything the build is handed is resolved before docker is asked for
	# anything, so a run that cannot build reaches no builder at all. Each is
	# checked with an explicit `if !`, because `set -e` does not hold inside a
	# command substitution in an assignment's position in every bash.
	if ! repository="$(image "$track")"; then
		return 1
	fi
	if ! tag="$(commit)"; then
		return 1
	fi
	# A process substitution into `mapfile` would swallow a non-zero exit, so
	# the output is captured first and the failure reported here.
	if ! pins_text="$(ci/images/build-args.sh "$track")"; then
		echo "ci-image.sh: ci/images/build-args.sh ${track} failed; refusing to build an image with no pins" >&2
		return 1
	fi
	local pins=()
	mapfile -t pins <<<"$pins_text"

	local build_args=()
	local pin
	for pin in "${pins[@]}"; do
		[[ -n "$pin" ]] || continue
		build_args+=(--build-arg "$pin")
	done

	local reference="${repository}:${tag}"
	echo "Building ${reference}"

	# Tolerate the builder already existing: a job retried on an agent it has
	# run on before finds it there.
	docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null 2>&1 ||
		docker buildx use "$BUILDER"

	# A registry layer cache per track, so a change to one late step does not
	# reinstall a Rust toolchain or a set of browser engines, and a commit that
	# changed nothing the image installs rebuilds nothing. `mode=max` keeps the
	# intermediate layers rather than the final one alone, which is what makes a
	# partial rebuild possible at all. `latest` there is fine: nothing pins the
	# cache, a builder verifies what it reads from it, and it is meant to be
	# overwritten.
	docker buildx build \
		--platform linux/amd64 \
		--file "ci/images/${track}.Dockerfile" \
		--tag "$reference" \
		"${build_args[@]}" \
		--cache-from "type=registry,ref=${repository}-cache:latest" \
		--cache-to "type=registry,ref=${repository}-cache:latest,mode=max" \
		--push \
		.

	echo "Pushed ${reference}"
	echo "Once every image of this run is pushed, write ${tag} into ci/images/tags.yml as ciImageTag and push that commit."
}

if [[ $# -ne 2 || "$1" != build ]]; then
	usage
fi

# The track is checked before anything else runs, so an unknown one fails with
# its own message and reaches neither build-args.sh nor docker.
if ! image "$2" >/dev/null; then
	exit 1
fi

# Every path above is relative to the workspace root, including the build
# context, so the command is run from there whatever directory it was called in.
# The root is this file's own path rather than git's answer, so a run with
# BUILD_SOURCEVERSION set asks git for nothing.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

build "$2"
