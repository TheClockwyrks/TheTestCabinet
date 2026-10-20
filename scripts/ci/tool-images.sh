#!/usr/bin/env bash
# The `tool-*` images the run-container images copy their tool binaries from, at the
# commits the driver pins.
#
#   scripts/ci/tool-images.sh list    # `<repository> <build-arg> <reference>` per tool image
#   scripts/ci/tool-images.sh check   # fails, naming the commit, when a reference is not pushed
#
# Each `tool-*` repository's pipeline builds its image on every gated push to master and
# staging and pushes the multi-arch `testcabinet.azurecr.io/<repository>:<commit>` (see
# "The microservice images" in apps/docs/src/content/docs/development/releasing.md). A run
# image copies the binaries out of that image at the commit the driver pins: a run image's
# Dockerfile declares `ARG <build-arg>` (`TOOL_SPRITE_IMAGE` for `tool-sprite`) and copies
# from `FROM ${<build-arg>} AS <repository>`.
#
# THE PIN is the superrepo's gitlink for the repository (`git rev-parse HEAD:<repository>`),
# which, while the driver lives in the superrepo, is the record of which commit of each
# repository it builds together with ("The record of what builds together" in
# apps/docs/src/content/docs/development/repositories.md). The gitlink is read from HEAD's
# tree, so the submodule need not be checked out.
#
# An environment variable named for the build argument (`TOOL_SPRITE_IMAGE=<reference>`)
# overrides that repository's reference, as containers/build.sh takes it.
#
# containers/build.sh passes the references as build arguments (and, without PUSH, builds
# each image from the repository's checkout instead), scripts/ci/run-image-inputs.sh puts
# them into the inputs digest of every image that copies from one, and
# scripts/ci/run-images.sh runs `check` before it builds anything, so a pin of a commit the
# repository's pipeline has not published fails before the first build rather than at the
# first image that copies from it.
set -euo pipefail

usage() {
	echo "usage: scripts/ci/tool-images.sh list | check" >&2
	exit 2
}

[[ $# -eq 1 ]] || usage
command="$1"
case "$command" in
	list | check) ;;
	*) usage ;;
esac
readonly command

# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

# Every `tool-*` repository a run image copies binaries from. A repository added here
# needs its submodule (scripts/repos/bootstrap.sh), and each run image that copies from
# it declares the build argument its name derives.
readonly TOOL_REPOSITORIES=(tool-sprite tool-paint)

# `tool-sprite` -> `TOOL_SPRITE_IMAGE`.
build_arg_of() {
	local repository="$1"
	repository="${repository^^}"
	printf '%s_IMAGE\n' "${repository//-/_}"
}

# The commit HEAD's tree pins the repository at: its gitlink, read from the tree because
# the submodule's commits are not in this repository's object store.
pinned_commit() {
	local repository="$1" mode commit path
	read -r mode _ commit path < <(git ls-tree HEAD -- "$repository") || true
	if [[ "${mode:-}" != 160000 || "${path:-}" != "$repository" ]]; then
		echo "tool-images.sh: HEAD has no submodule at ${repository}; register it with scripts/repos/bootstrap.sh ${repository}." >&2
		return 1
	fi
	printf '%s\n' "$commit"
}

# `<repository> <build-arg> <reference>` lines, one per repository.
table() {
	local repository arg override commit
	for repository in "${TOOL_REPOSITORIES[@]}"; do
		arg="$(build_arg_of "$repository")"
		override="${!arg:-}"
		if [[ -n "$override" ]]; then
			printf '%s %s %s\n' "$repository" "$arg" "$override"
			continue
		fi
		commit="$(pinned_commit "$repository")"
		printf '%s %s %s/%s:%s\n' "$repository" "$arg" "$CI_REGISTRY" "$repository" "$commit"
	done
}

check() {
	local docker="${DOCKER:-docker}" lines repository arg ref failed=0
	lines="$(table)"
	while read -r repository arg ref; do
		[[ -n "$repository" ]] || continue
		if "$docker" buildx imagetools inspect "$ref" >/dev/null 2>&1; then
			echo "${repository}: ${ref}"
			continue
		fi
		failed=1
		echo "tool-images.sh: ${ref} is not in the registry." >&2
		if [[ -n "${!arg:-}" ]]; then
			echo "       ${arg} names it." >&2
		else
			echo "       The superrepo pins ${repository} at ${ref##*:} (git rev-parse HEAD:${repository})," >&2
			echo "       and ${repository}'s pipeline pushes ${repository}:<commit> only on a gated push to its" >&2
			echo "       master or staging: pin a commit that pipeline has published, or wait for its run." >&2
		fi
	done <<<"$lines"
	return "$failed"
}

case "$command" in
	list) table ;;
	check) check ;;
esac
