#!/usr/bin/env bash
# Prints, for every run-container image and the two builder images, a digest of the
# inputs its build reads, and the images it is built from.
#
#   scripts/ci/run-image-inputs.sh [<name>...]
#
# One line per image, `<name> <digest> <parent>[,<parent>...]` (`-` when it has no
# parent), for every name containers/image-names.sh lists plus `tools` and
# `gg-toolchains`, or for the names given. The digest is 32 hex characters of a
# SHA-256 over:
#
#   - INPUTS_SCHEMA below, bumped by hand when what a build does changes without any
#     of the following changing: an unpinned upstream (a base image named by tag, an
#     apt package set, a toolchain fetched by version) that has to be refreshed, or
#     an edit to containers/build.sh that alters a build's flags. Bumping it makes
#     every image's digest new, so every image is rebuilt once.
#   - the image's Dockerfile (containers/<name>/Dockerfile; containers/gg/Dockerfile
#     for every `-gg` variant), as the index records it: mode and blob id.
#   - every context path the Dockerfile copies (`COPY`/`ADD` sources that are not
#     `--from=` another stage), as `git ls-files -s` lists the tracked files under
#     it. A Dockerfile that copies `.` reads the whole build context, which is the
#     repository root filtered by the root .dockerignore, so its inputs are that file
#     and every tracked file under each path the allowlist re-includes (its `!` lines).
#     A path under a submodule lists the submodule's gitlink, its pinned commit, since
#     the index holds none of the submodule's files.
#     A superset of what the build reads is fine: it can only rebuild too often, never
#     too seldom.
#   - the digests of the images it is built from (its `FROM` parents and the builder
#     stages it copies out of), so a change anywhere below an image reaches it.
#   - for gg-toolchains, the two files its build arguments are read from.
#
# scripts/ci/run-images.sh writes this table and containers/build.sh reads it in its
# reuse mode: an image whose digest already names a pushed image in the registry is
# retagged for this commit instead of being built and pushed again. The digest is
# computed from the index, not the working tree: it describes a commit, which is what
# a CI checkout is. What the digest deliberately leaves out is anything the build
# fetches from the network, which is why the schema exists.
#
# The parent map below mirrors containers/build.sh's dispatch (`build_one` and the
# layer rules above it); the two must agree, and build.sh's header says so.
set -euo pipefail

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

readonly INPUTS_SCHEMA="v1"
readonly CONTAINERS="containers"

# The images an image is built from, or `-`.
parents_of() {
	local name="$1"
	case "$name" in
		tools | gg-toolchains | base | blender) echo "-" ;;
		base-wasm) echo "base" ;;
		adversarial | performance) echo "base-wasm" ;;
		full-stack-2d | full-stack-3d) echo "base-wasm,tools" ;;
		game-jam) echo "full-stack-2d" ;;
		*-gg) echo "${name%-gg},gg-toolchains" ;;
		*) echo "base,tools" ;;
	esac
}

dockerfile_of() {
	local name="$1"
	case "$name" in
		*-gg) echo "${CONTAINERS}/gg/Dockerfile" ;;
		*) echo "${CONTAINERS}/${name}/Dockerfile" ;;
	esac
}

# The context sources a Dockerfile's COPY and ADD instructions read: every source
# argument of an instruction that does not name another stage with `--from=`, with the
# destination (the last argument) dropped, continuation lines joined and comments
# skipped. A source that expands a variable is left out: the build arguments here
# name images, whose content the parents' digests cover.
context_sources() {
	local dockerfile="$1"
	awk '
		/^[[:space:]]*#/ { next }
		{
			line = $0
			while (line ~ /\\[[:space:]]*$/) {
				sub(/\\[[:space:]]*$/, "", line)
				if ((getline next_line) <= 0) break
				line = line " " next_line
			}
			if (line !~ /^[[:space:]]*(COPY|ADD)[[:space:]]/) next
			if (line ~ /--from=/) next
			n = split(line, parts, /[[:space:]]+/)
			for (i = 2; i < n; i++) {
				if (parts[i] ~ /^--/) continue
				if (parts[i] ~ /\$/) continue
				print parts[i]
			}
		}
	' "$dockerfile"
}

# The paths the root .dockerignore re-includes: what a `COPY . .` can read.
allowlisted_paths() {
	grep -E '^!' .dockerignore | sed -E 's/^!\/?//; s/\/$//' | sort -u
}

# The index's gitlinks, the paths of its submodules, which main reads once: the
# digests are computed in subshells, which would each read it again.
GITLINKS=()

# `git ls-files -s` over paths, which is empty for a path with no tracked file. A
# path inside a submodule has no tracked file in this index, only the submodule's
# gitlink, so the gitlink is listed for it too: a bump of the submodule's pin moves
# the digest of every image that reads under it.
listing() {
	local -a specs=("$@")
	local path gitlink
	for gitlink in "${GITLINKS[@]}"; do
		for path in "$@"; do
			if [[ "$path" == "$gitlink" || "$path" == "$gitlink"/* ]]; then
				specs+=("$gitlink")
				break
			fi
		done
	done
	git ls-files -s -- "${specs[@]}"
}

declare -A DIGESTS=()

digest_of() {
	local name="$1"
	if [[ -n "${DIGESTS[$name]:-}" ]]; then
		echo "${DIGESTS[$name]}"
		return 0
	fi
	local dockerfile parents parent source parts=""
	dockerfile="$(dockerfile_of "$name")"
	if [[ ! -f "$dockerfile" ]]; then
		echo "run-image-inputs.sh: no Dockerfile for '${name}' at ${dockerfile}" >&2
		return 1
	fi
	parts+="schema ${INPUTS_SCHEMA}"$'\n'
	parts+="$(listing "$dockerfile")"$'\n'
	while IFS= read -r source; do
		[[ -n "$source" ]] || continue
		if [[ "$source" == "." || "$source" == "./" ]]; then
			parts+="$(listing .dockerignore)"$'\n'
			# shellcheck disable=SC2046 # one pathspec per allowlisted path
			parts+="$(listing $(allowlisted_paths))"$'\n'
		else
			parts+="$(listing "${source#./}")"$'\n'
		fi
	done < <(context_sources "$dockerfile")
	if [[ "$name" == gg-toolchains ]]; then
		parts+="$(listing rust-toolchain.toml packages/gg-sandbox-rust/rust-version.sh)"$'\n'
	fi
	parents="$(parents_of "$name")"
	if [[ "$parents" != "-" ]]; then
		for parent in ${parents//,/ }; do
			parts+="parent ${parent} $(digest_of "$parent")"$'\n'
		done
	fi
	DIGESTS[$name]="$(printf '%s' "$parts" | sha256sum | cut -c 1-32)"
	echo "${DIGESTS[$name]}"
}

main() {
	local -a names=()
	mapfile -t GITLINKS < <(git ls-files -s | awk -F '\t' '$1 ~ /^160000 / { print $2 }')
	if [[ $# -gt 0 ]]; then
		names=("$@")
	else
		mapfile -t names < <("${CONTAINERS}/image-names.sh")
		names=(tools gg-toolchains "${names[@]}")
	fi
	local name digest
	for name in "${names[@]}"; do
		digest="$(digest_of "$name")"
		printf '%s %s %s\n' "$name" "$digest" "$(parents_of "$name")"
	done
}

main "$@"
