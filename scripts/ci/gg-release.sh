#!/usr/bin/env bash
# The gg release this checkout runs: the version the driver pins, and the published
# objects of that version.
#
#   scripts/ci/gg-release.sh version            # the version, e.g. 0.7.1
#   scripts/ci/gg-release.sh toolchains-image   # the `-gg` run images' toolchain tree
#   scripts/ci/gg-release.sh fetch <out-dir>    # <out-dir>/gg and <out-dir>/gg-reference/
#
# gg is built, tested and released by the `gg` repository, whose pipeline uploads three
# objects on each `v*` tag to the anonymously readable `gg-releases` blob container and
# pushes the toolchain tree the `-gg` run images copy as the multi-arch image
# `test-cabinet-gg-toolchains:<version>` (see "Releasing gg" in
# apps/docs/src/content/docs/development/releasing.md):
#
#   v<version>/gg-x86_64-unknown-linux-musl     the static gg for x86_64
#   v<version>/gg-aarch64-unknown-linux-musl    the static gg for aarch64
#   v<version>/gg-reference.tar.gz              gg-reference/: index.json plus one
#                                               document per program language
#
# THE PIN is the one line of crates/driver/gg-release-version, which the driver compiles
# in as `DEFAULT_RELEASE_VERSION` (crates/driver/src/gg_exec.rs). This script is how every
# image build and script reads it, so a bump is an edit of that file alone:
# deployments/images/services.Dockerfile runs `fetch` for the driver (the binary) and the
# backend (the reference documents), containers/build.sh copies the `toolchains-image`
# into every `-gg` variant, and scripts/ci/run-images.sh and
# `make -C deployments/local run-images-gg-selfcheck` drive `gg selfcheck` with the
# fetched binary.
#
# TCAB_GG_RELEASE_VERSION and TCAB_GG_RELEASE_URL override the version and the base URL,
# under the names the driver reads them by, which is how a prerelease such as
# `0.7.1-rc1` or a mirror is tried. Every subcommand answers for the overridden version.
#
# `fetch` takes the binary of this machine's architecture (`uname -m`), so an image built
# for arm64 gets the aarch64 one whether it builds natively or under emulation. It refuses
# a binary whose `gg --version` is not the version asked for, and a tarball without
# `gg-reference/index.json`, and writes nothing into <out-dir> until both are checked.
set -euo pipefail

usage() {
	echo "usage: scripts/ci/gg-release.sh version | toolchains-image | fetch <out-dir>" >&2
	exit 2
}

[[ $# -ge 1 ]] || usage
command="$1"
shift
out=""
case "$command" in
	version | toolchains-image) [[ $# -eq 0 ]] || usage ;;
	fetch)
		[[ $# -eq 1 && -n "$1" ]] || usage
		# Resolved before tcab-lib.sh moves to the repository root, so a relative path
		# means what it meant to the caller.
		out="$(realpath -m -- "$1")"
		;;
	*) usage ;;
esac
readonly command out

# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

# The release container's URL, which DEFAULT_RELEASE_BASE_URL in
# crates/driver/src/gg_exec.rs names too; scripts/ci/gg-release.test.sh holds the two
# equal.
readonly DEFAULT_BASE_URL="https://testcabinetartifacts.blob.core.windows.net/gg-releases"
# The toolchain image's repository, as the `gg` repository's
# scripts/ci/gg-toolchains-image.sh names it.
readonly TOOLCHAINS_REPOSITORY="test-cabinet-gg-toolchains"
readonly PIN_FILE="crates/driver/gg-release-version"

# A release version: MAJOR.MINOR.PATCH with an optional prerelease, and no `v`.
readonly VERSION_SHAPE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'

release_version() {
	local version
	if [[ -n "${TCAB_GG_RELEASE_VERSION:-}" ]]; then
		version="${TCAB_GG_RELEASE_VERSION#v}"
	else
		if [[ ! -f "$REPO_ROOT/$PIN_FILE" ]]; then
			echo "gg-release.sh: $PIN_FILE is missing; it holds the gg version the driver pins." >&2
			return 1
		fi
		version="$(tr -d '[:space:]' <"$REPO_ROOT/$PIN_FILE")"
	fi
	if [[ ! "$version" =~ $VERSION_SHAPE ]]; then
		echo "gg-release.sh: '$version' is not a gg release version (MAJOR.MINOR.PATCH[-PRERELEASE])." >&2
		echo "       It is read from ${TCAB_GG_RELEASE_VERSION:+TCAB_GG_RELEASE_VERSION}${TCAB_GG_RELEASE_VERSION:-$PIN_FILE}." >&2
		return 1
	fi
	printf '%s\n' "$version"
}

base_url() {
	local base="${TCAB_GG_RELEASE_URL:-$DEFAULT_BASE_URL}"
	while [[ "$base" == */ ]]; do base="${base%/}"; done
	printf '%s\n' "${base:-$DEFAULT_BASE_URL}"
}

fetch() {
	local version="$1" base target staging actual
	base="$(base_url)"
	case "$(uname -m)" in
		x86_64 | amd64) target=x86_64-unknown-linux-musl ;;
		aarch64 | arm64) target=aarch64-unknown-linux-musl ;;
		*)
			echo "gg-release.sh: gg publishes no binary for $(uname -m)." >&2
			return 1
			;;
	esac
	if [[ "$out" == / ]]; then
		echo "gg-release.sh: refusing to fetch into /." >&2
		return 1
	fi
	mkdir -p "$out"
	staging="$(mktemp -d "$out/.gg-release.XXXXXX")"
	# shellcheck disable=SC2064 # the directory is fixed now, and must be removed on any exit.
	trap "rm -rf '$staging'" EXIT

	log "gg $version for $target from $base"
	curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors \
		-o "$staging/gg" "$base/v$version/gg-$target"
	chmod 0755 "$staging/gg"
	actual="$("$staging/gg" --version)" || {
		echo "gg-release.sh: the downloaded gg-$target does not run on this machine." >&2
		return 1
	}
	if [[ "${actual##* }" != "$version" ]]; then
		echo "gg-release.sh: v$version/gg-$target reports '$actual', not gg $version." >&2
		return 1
	fi
	echo "$actual"
	sha256sum "$staging/gg" | sed "s#  .*#  gg-$target#"

	curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors \
		-o "$staging/gg-reference.tar.gz" "$base/v$version/gg-reference.tar.gz"
	mkdir "$staging/unpacked"
	tar -xzf "$staging/gg-reference.tar.gz" -C "$staging/unpacked"
	if [[ ! -f "$staging/unpacked/gg-reference/index.json" ]]; then
		echo "gg-release.sh: v$version/gg-reference.tar.gz holds no gg-reference/index.json." >&2
		return 1
	fi
	echo "gg-reference: $(find "$staging/unpacked/gg-reference" -maxdepth 1 -name '*.json' | wc -l) document(s)"

	rm -rf "$out/gg" "$out/gg-reference"
	mv "$staging/gg" "$out/gg"
	mv "$staging/unpacked/gg-reference" "$out/gg-reference"
}

release="$(release_version)"
readonly release
case "$command" in
	version) printf '%s\n' "$release" ;;
	toolchains-image) printf '%s/%s:%s\n' "$CI_REGISTRY" "$TOOLCHAINS_REPOSITORY" "$release" ;;
	fetch) fetch "$release" ;;
esac
