#!/usr/bin/env bash
# Builds the images CI's gate tracks run inside, and pushes them.
#
#   scripts/ci/ci-image.sh inputs    <track>   one input path per line
#   scripts/ci/ci-image.sh tag       <track>   v1-<12 hex>
#   scripts/ci/ci-image.sh tag                 write every track's tag to ci/images/tags.yml
#   scripts/ci/ci-image.sh reference <track>   <repository>:<tag>
#   scripts/ci/ci-image.sh build     <track>   build and push, or skip
#
# There is one image per gate track, because the tracks need disjoint
# toolchains: the Rust track wants a Rust toolchain, the web track wants
# node, the browser engines and kubectl, and neither wants the other's couple of
# gigabytes. Each is built from ci/images/<track>.Dockerfile with the workspace root
# as its context, since those files install with the same .devcontainer/
# scripts a developer's image is built with. See ci/images/README.md for what is
# in each one and why.
#
# What this script does not do is decide any version. The pins come out of
# .devcontainer/docker-compose.yml's `x-devcontainer-build-args` anchor, which
# stays the one place a tool's version is written, and ci/images/build-args.sh
# is what reads them back out as build arguments. A pin an image consumes is
# therefore the same pin a developer's image consumes, which is the property
# that makes a gate pass here exactly when it passes in a terminal.
#
# ## The tag
#
# A tag is the content of the files the image is built from, so the same
# checkout always names the same tag and two different checkouts never name the
# same one. Nothing is ever pushed twice to a tag, and `latest` is never used at
# all: ci/images/tags.yml holds a tag from here literally, azure-pipelines.yml
# names each job's image by it, and a tag that could be rewritten would make
# that pin a statement about nothing.
#
# `tag` given no track is what writes that file: every track's tag, computed
# from this checkout, in place of whatever it held. It is the one writer. The
# template renders the file once, with a placeholder, and never over it, so a
# workspace's pins are its own and its pipeline stays the file the template
# renders. The file is no input of any image, so writing it moves no tag.
#
# The digest covers two things. The first is `git ls-files -s` over the paths
# `inputs` prints, which is one line of mode, object id and path per file —
# git's own view of the checkout's content. git is asked rather than the files
# being read so that a path that is listed but absent cannot fail a run here,
# and so that a mode change is a change. The second is ci/images/build-args.sh's
# output, which is exactly the pins this image consumes. That second half is why
# .devcontainer/docker-compose.yml is deliberately absent from the input lists:
# bumping a pin no CI image installs (CLAUDE_CODE_VERSION, say) must not retire
# a perfectly good image, and bumping one it does install must.
#
# IMAGE_SCHEMA is the escape hatch for what the files do not pin: the
# `ubuntu:26.04` tag every Dockerfile opens with, and the apt package sets they
# install. Neither is content-addressed by anything, so when one of them has
# moved and the images have to be rebuilt anyway, bump IMAGE_SCHEMA and every
# track's tag retires at once. It is written here and nowhere else.
#
# ## Asking the registry whether a tag is there
#
# `the-test-cabinet-acr` is a Docker Registry service connection, which is the
# kind the Docker@2 task consumes and which writes its credential into the
# agent's docker configuration for the run. It is not an `azurerm` connection,
# so AzureCLI@2 cannot consume it and the obvious `az acr manifest exists` is
# not available; the existence check below therefore goes through the docker
# credential the job already holds.
#
# `docker buildx imagetools inspect` is used for that rather than
# `docker manifest inspect`, because `docker manifest` is behind
# DOCKER_CLI_EXPERIMENTAL on some CLI builds while `imagetools` is a first-class
# buildx command, reads the same credential store, and buildx is the toolchain
# this workspace pushes with. If a future agent image ever ships a docker CLI
# without buildx, the fallback is
# `DOCKER_CLI_EXPERIMENTAL=enabled docker manifest inspect "$reference"`; that
# belongs in this comment rather than in a second code path nothing exercises.
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
readonly IMAGE_SCHEMA="v1"
readonly RUST_IMAGE="${REGISTRY}/ubuntu-the-test-cabinet-rust-cicd"
readonly WEB_IMAGE="${REGISTRY}/ubuntu-the-test-cabinet-web-cicd"

# The builder the push needs. The default `docker` driver can neither write a
# registry cache nor `--push`, so a docker-container builder is created.
readonly BUILDER="the-test-cabinet-ci-images"

# Every track, in the order the tags file lists them, and that file.
readonly TRACKS=(rust web)
readonly TAGS_FILE="ci/images/tags.yml"

usage() {
	cat >&2 <<'USAGE'
usage: scripts/ci/ci-image.sh <inputs|tag|reference|build> <rust|web>
       scripts/ci/ci-image.sh tag
USAGE
	exit 1
}

# The files each image is built from. This is the list the tag digests and the
# list the image pipeline triggers on: a path digested but not triggered on is a
# pin that moves with no image built for it, and a path triggered on but not
# digested is a build repeated for nothing.
#
# The Dockerfile's own `.dockerignore` is in every list, because it decides what
# the build can see of the checkout rather than what the image installs: narrow
# it by one path and the COPY that reads it fails. See the header of any one of
# them.
#
# This script is in every list on purpose. It decides the base command line,
# which build arguments reach the build and where the result is pushed, so a
# change to it is a change to the image even when no Dockerfile moved.
inputs() {
	case "$1" in
	rust)
		cat <<'PATHS'
.devcontainer/languages/rust
.devcontainer/tools/uv.sh
ci/images/build-args.sh
ci/images/rust.Dockerfile
ci/images/rust.Dockerfile.dockerignore
scripts/ci/ci-image.sh
PATHS
		;;
	web)
		cat <<'PATHS'
.devcontainer/languages/node
.devcontainer/system/browser-deps.sh
.devcontainer/tools/browsers.sh
.devcontainer/tools/kubectl.sh
.devcontainer/tools/uv.sh
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

# The repository a track's image is pushed to. One repository per track rather
# than one repository and a tag per track, so a `docker image ls` and the
# registry's own listing both say which track an image belongs to without
# reading its tag.
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

# The tag a track's image is pushed under, and the one thing in this script
# every other part of the workspace reads.
#
# Each half of the digest is captured and checked on its own rather than piped
# straight into sha256sum, and each failure is checked for explicitly rather
# than left to `set -e`. Both are deliberate. Piped, a failure on the left of
# the pipeline is noticed only after the digest of whatever did reach it has
# been printed, and a tag on stdout is exactly what a caller reads. And `set -e`
# cannot be relied on here: bash suppresses it inside a command substitution
# that sits in another command's arguments, which is how `reference` below calls
# this function. An explicit `if !` holds in every one of those positions.
tag() {
	local track="$1"
	local paths=()
	mapfile -t paths < <(inputs "$track")

	# `--error-unmatch` is what turns the most likely mistake into git's own
	# message, which ends "Did you forget to 'git add'?". The digest is the
	# index, not the working tree, so a new input file that has not been staged
	# contributes nothing to it and the tag computed here would be a tag no
	# committed checkout ever names again. In a pipeline every input is
	# committed and this can never fire; in a terminal, working out a tag to
	# write into ci/images/tags.yml before staging the files is exactly the
	# loop it catches.
	local listing pins
	if ! listing="$(git ls-files -s --error-unmatch -- "${paths[@]}")"; then
		echo "ci-image.sh: the ${track} image's inputs above are not in git's index, so its tag cannot be computed" >&2
		return 1
	fi
	# The two halves of the digest read the checkout from different places, and
	# it is worth saying so. The listing above is the index; the pins below are
	# read out of the working tree, because build-args.sh reads a file rather
	# than asking git for one. So an unstaged edit to an input contributes
	# nothing to the tag while an unstaged pin bump does. Both are held honest
	# at commit time by the hook whose file list covers every input and the pins
	# file with it, so a tag pinned in the pipeline that this checkout does not
	# digest to fails before the commit rather than in a run.
	if ! pins="$(ci/images/build-args.sh "$track")"; then
		echo "ci-image.sh: ci/images/build-args.sh ${track} failed; the pins this image is built from are not available" >&2
		return 1
	fi

	printf '%s\n%s\n' "$listing" "$pins" | sha256sum | cut -c 1-12 | sed "s/^/${IMAGE_SCHEMA}-/"
}

# Every track's tag, written into the variables template azure-pipelines.yml
# includes. Every tag is computed before anything is written, so a track whose
# tag cannot be computed leaves the file as it was rather than half rewritten,
# and the file is replaced by a rename, so nothing reads it half written.
write_tags() {
	local track image_tag
	local lines=()
	for track in "${TRACKS[@]}"; do
		if ! image_tag="$(tag "$track")"; then
			echo "ci-image.sh: ${TAGS_FILE} is left as it was" >&2
			return 1
		fi
		lines+=("  ${track}ImageTag: ${image_tag}")
	done
	local written="${TAGS_FILE}.$$"
	{
		cat <<'HEADER'
# The tag of each CI image, which azure-pipelines.yml includes as a variables
# template and names every job's image by. Written by `scripts/ci/ci-image.sh
# tag` and by nothing else: the template renders this file once and never
# over it, and the ci-tests gate fails while a tag here is not the one the
# checkout builds. v1-000000000000 names no image; it is what a render writes.
variables:
HEADER
		printf '%s\n' "${lines[@]}"
	} >"$written"
	mv "$written" "$TAGS_FILE"
	printf '%s\n' "${lines[@]}" | sed 's/^ *//'
	echo "Wrote ${TAGS_FILE}. Commit it; a tag the registry lacks is built by azure-pipelines-ci-images.yml."
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

	# The whole point of a content-addressed tag: the image this checkout
	# describes may already have been built, on the branch that introduced the
	# change that named it, and a merge of that branch must not build it again.
	# A run that ends here costs under a minute.
	#
	# The check errs in the safe direction. It answers "no" for a tag that is
	# absent, and also for a registry that cannot be reached or a credential
	# that is not there — the two are indistinguishable from an exit status.
	# Reading either as "no" costs a build that then fails at `--push`, with the
	# real reason in the log; reading an absent tag as "yes" would skip a build
	# the gates pipeline is waiting on and leave it pulling a tag nothing pushed.
	if docker buildx imagetools inspect "$ref" >/dev/null 2>&1; then
		echo "${ref} is already in the registry. Nothing to build."
		return 0
	fi
	echo "${ref} is not in the registry. Building it."

	# Tolerate the builder already existing: a job retried on an agent it has
	# run on before finds it there.
	docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null 2>&1 ||
		docker buildx use "$BUILDER"

	# The pins this image consumes, as `NAME=VALUE` lines read out of
	# .devcontainer/docker-compose.yml's anchor. They are the same lines the tag
	# above digested, which is what ties an image to the versions inside it. A
	# process substitution into `mapfile` would swallow a non-zero exit, so the
	# output is captured first and the failure reported here.
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
	# reinstall a Rust toolchain or a set of browser engines. `mode=max` keeps
	# the intermediate layers rather than the final one alone, which is what
	# makes a partial rebuild possible at all. The cache is a repository of its
	# own and `latest` there is fine: nothing pins it, it is read by a builder
	# that verifies what it reads, and it is meant to be overwritten.
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

if [[ $# -eq 1 && "$1" == tag ]]; then
	cd "$(git rev-parse --show-toplevel)"
	write_tags
	exit
fi

if [[ $# -ne 2 ]]; then
	usage
fi

# The track is checked here rather than only inside the functions that switch on
# it. `inputs` is read through a process substitution, whose non-zero exit
# nothing sees, so an unknown track would otherwise reach `git ls-files` as an
# empty path list — and an empty pathspec means every file in the index, which
# would quietly digest the whole workspace instead of one image's inputs.
case "$2" in
rust | web) ;;
*)
	echo "ci-image.sh: unknown track '$2'; expected 'rust' or 'web'" >&2
	exit 1
	;;
esac

# Every path above is relative to the workspace root, including the build
# context, so the command is run from there whatever directory it was called in.
cd "$(git rev-parse --show-toplevel)"

case "$1" in
inputs) inputs "$2" ;;
tag) tag "$2" ;;
reference) reference "$2" ;;
build) build "$2" ;;
*) usage ;;
esac
