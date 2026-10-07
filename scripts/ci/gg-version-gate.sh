#!/usr/bin/env bash
# Fails a tag build whose gg reports a version other than the tag's.
#
#   scripts/ci/gg-version-gate.sh <gg-binary> <ref>
#
# <ref> is the full ref the pipeline built (`Build.SourceBranch`). For a tag
# `refs/tags/v<version>`, `<gg-binary> --version` must report exactly `gg <version>`.
# Any other ref passes.
#
# The version is what core's download path and a run record both rest on: core
# fetches `v<its own version>/gg-<target>` from the release container, and a run
# records the version gg reports as its harness version. A tag cut without bumping the
# crates would publish a binary that mislabels every run made with it.
set -euo pipefail

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/gg-version-gate.sh <gg-binary> <ref>" >&2
	exit 1
fi
readonly GG_BINARY="$1"
readonly REF="$2"

if [[ "$REF" != refs/tags/* ]]; then
	echo "gg-version-gate: ${REF} is not a tag; nothing to check"
	exit 0
fi

reported="$("$GG_BINARY" --version)"
built="${reported#gg }"
tag="${REF#refs/tags/}"
expected="${tag#v}"

if [[ "$built" != "$expected" ]]; then
	echo "gg-version-gate: gg reports version '${built}' but the tag is '${tag}'." >&2
	echo "Bump the version of crates/gg and crates/core to ${expected}, then tag again." >&2
	exit 1
fi
echo "gg-version-gate: gg ${built} matches ${tag}"
