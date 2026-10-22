#!/usr/bin/env bash
# Verifies that every file a Dockerfile COPYs out of the build context survives
# `.dockerignore`, and that every Rust a Dockerfile pins is the toolchain's.
#
#   scripts/ci/build-context.sh
#
# WHY. `.dockerignore` is an allowlist, `*` and then explicit `!` re-inclusions,
# so the default answer for any path is "not in the context". A COPY whose
# source was never re-included does not warn: the build dies with
# `failed to compute cache key: "/path": not found`. Nothing else here can see
# that, and the image is built only after the gates, on master and staging, so
# the defect would land and be found by the next build.
#
# WHAT IT CHECKS, per tracked Dockerfile, for every COPY or ADD that reads the
# build context (a `--from=` copy reads an earlier stage or an image, and a
# remote ADD the network):
#   1. the source exists in the repository, and
#   2. every allowlist that can apply to the Dockerfile keeps it in the context:
#      the root `.dockerignore`, and `<dockerfile>.dockerignore` beside it, which
#      BuildKit reads in its place when it exists while another builder may
#      still read the root one.
# A directory source copies what survives under it, so it passes when any
# tracked file under it survives. A whole-context copy (`COPY . .`), a glob and
# a source built from a build argument are the allowlist's or the build's own
# answer, and are left alone.
#
# THE RUST PIN. rust-toolchain.toml decides the compiler, and an image built
# with another one is a build nobody tested, so every `FROM … rust:<v>…` and
# every `ARG RUST_VERSION=<v>` default must name the toolchain's channel. A
# repository carrying no crate has no rust-toolchain.toml and pins no Rust, so
# a pin there has nothing to be held to and fails.
#
# The evaluation mirrors Docker's: patterns apply in order, the last to match
# wins, a `!` pattern re-includes, and a path is ignored when it or an ancestor
# directory is. `*` and `?` do not cross `/`; `**` does. It reads the checked-out
# tree alone, so it needs no toolchain, no daemon and no history.
#
# The repository kit writes this file for a kind that builds an image; a
# change to it arrives with `scripts/repos/render.py --update` run from the
# superrepo.
set -euo pipefail

# From the repository root, whatever directory the script is run from.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1

# --- the .dockerignore matcher ----------------------------------------------

DI_REGEX=()
DI_NEGATED=()

# One .dockerignore pattern as an anchored ERE with Docker's glob semantics.
pattern_to_regex() {
	local pattern="$1" out="" prefix="^" i char
	pattern="${pattern#/}"
	pattern="${pattern%/}"
	if [[ "$pattern" == '**/'* ]]; then
		prefix='^(.*/)?'
		pattern="${pattern#\*\*/}"
	fi
	for ((i = 0; i < ${#pattern}; i++)); do
		char="${pattern:i:1}"
		case "$char" in
		'*')
			if [[ "${pattern:i:2}" == '**' ]]; then
				out+='.*'
				((i++)) || true
			else
				out+='[^/]*'
			fi
			;;
		'?') out+='[^/]' ;;
		'.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | \\) out+="\\$char" ;;
		*) out+="$char" ;;
		esac
	done
	printf '%s%s$' "$prefix" "$out"
}

# Read an allowlist into the pattern tables, dropping blanks and comments. A
# file that does not exist leaves the tables empty: everything is in context.
load_dockerignore() {
	local file="$1" line
	DI_REGEX=()
	DI_NEGATED=()
	[[ -f "$file" ]] || return 0
	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%$'\r'}"
		line="${line#"${line%%[![:space:]]*}"}"
		line="${line%"${line##*[![:space:]]}"}"
		[[ -z "$line" || "$line" == '#'* ]] && continue
		if [[ "$line" == '!'* ]]; then
			DI_NEGATED+=(1)
			DI_REGEX+=("$(pattern_to_regex "${line#!}")")
		else
			DI_NEGATED+=(0)
			DI_REGEX+=("$(pattern_to_regex "$line")")
		fi
	done <"$file"
}

# True when the path is still in the build context after every pattern applied.
context_includes() {
	local path="$1" ignored=0 index regex candidate hit
	for index in "${!DI_REGEX[@]}"; do
		regex="${DI_REGEX[$index]}"
		hit=0
		candidate="$path"
		while :; do
			if [[ "$candidate" =~ $regex ]]; then
				hit=1
				break
			fi
			[[ "$candidate" == */* ]] || break
			candidate="${candidate%/*}"
		done
		if ((hit)); then
			if ((DI_NEGATED[index])); then ignored=0; else ignored=1; fi
		fi
	done
	((ignored == 0))
}

# True when a directory source contributes any tracked file to the context.
context_includes_dir() {
	local dir="$1" file
	context_includes "$dir" && return 0
	while IFS= read -r file; do
		context_includes "$file" && return 0
	done < <(git ls-files -- "$dir")
	return 1
}

# --- reading the Dockerfiles ------------------------------------------------

# `<line> <instruction>` for every COPY and ADD, continuations joined and
# comment lines dropped.
copy_instructions() {
	awk '
		{
			line = $0
			sub(/\r$/, "", line)
			if (pending != "") {
				if (line ~ /^[[:space:]]*#/) next
				sub(/^[[:space:]]+/, "", line)
				if (line ~ /\\[[:space:]]*$/) {
					sub(/\\[[:space:]]*$/, "", line)
					pending = pending " " line
					next
				}
				print start, pending " " line
				pending = ""
				next
			}
			if (line ~ /^[[:space:]]*#/) next
			if (line !~ /^[[:space:]]*(COPY|ADD)[[:space:]]/) next
			sub(/^[[:space:]]+/, "", line)
			if (line ~ /\\[[:space:]]*$/) {
				sub(/\\[[:space:]]*$/, "", line)
				pending = line
				start = NR
				next
			}
			print NR, line
		}
	' "$1"
}

problems=0
checked=0

# Check one Dockerfile's context-reading sources against the loaded allowlist.
check_dockerfile() {
	local dockerfile="$1" ignore_file="$2"
	local lineno instruction arg source normalized from_stage
	local -a args positional
	while read -r lineno instruction; do
		[[ -n "$instruction" ]] || continue
		# shellcheck disable=SC2206  # deliberate word-splitting: Dockerfile arguments
		args=($instruction)
		positional=()
		from_stage=""
		for arg in "${args[@]:1}"; do
			case "$arg" in
			--from=*) from_stage="${arg#--from=}" ;;
			--*) ;;
			*) positional+=("$arg") ;;
			esac
		done
		[[ -n "$from_stage" ]] && continue
		((${#positional[@]} >= 2)) || continue
		for source in "${positional[@]:0:${#positional[@]}-1}"; do
			[[ "$source" == *://* ]] && continue
			[[ "$source" == '.' || "$source" == './' ]] && continue
			[[ "$source" == *'$'* ]] && continue
			[[ "$source" == *'*'* || "$source" == *'?'* || "$source" == *'['* ]] && continue
			normalized="${source#./}"
			normalized="${normalized#/}"
			normalized="${normalized%/}"
			checked=$((checked + 1))
			if [[ ! -e "$normalized" ]]; then
				echo "error: $dockerfile:$lineno copies '$source', which does not exist in the repository." >&2
				problems=$((problems + 1))
			elif [[ -d "$normalized" ]]; then
				if ! context_includes_dir "$normalized"; then
					echo "error: $dockerfile:$lineno copies the directory '$source', and $ignore_file keeps every tracked file under it OUT of the build context." >&2
					echo "       Fix: name what the image reads back in $ignore_file, with a comment saying what reads it." >&2
					problems=$((problems + 1))
				fi
			elif ! context_includes "$normalized"; then
				echo "error: $dockerfile:$lineno copies '$source', which $ignore_file keeps OUT of the build context." >&2
				echo "       Fix: add '!/$normalized' to $ignore_file, with a comment saying what reads it." >&2
				problems=$((problems + 1))
			fi
		done
	done < <(copy_instructions "$dockerfile")
}

mapfile -t dockerfiles < <(git ls-files -- '*Dockerfile' '*.Dockerfile' '*.dockerfile' | sort)
# The pipeline builds the Dockerfile at the root, so a repository whose kind
# builds an image without one would fail only at its first image build.
if [[ ! " ${dockerfiles[*]} " == *" Dockerfile "* ]]; then
	echo "error: no Dockerfile is tracked at the repository root, which the pipeline's image jobs build." >&2
	exit 1
fi

load_dockerignore .dockerignore
for dockerfile in "${dockerfiles[@]}"; do
	check_dockerfile "$dockerfile" .dockerignore
done
for dockerfile in "${dockerfiles[@]}"; do
	[[ -f "$dockerfile.dockerignore" ]] || continue
	load_dockerignore "$dockerfile.dockerignore"
	check_dockerfile "$dockerfile" "$dockerfile.dockerignore"
done

# --- the Rust a Dockerfile pins, against the toolchain's --------------------

rust_channel="$(sed -nE 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' rust-toolchain.toml 2>/dev/null || true)"
rust_pins=0
while IFS= read -r pin; do
	pin_file="${pin%%:*}"
	pin="${pin#*:}"
	pin_line="${pin%%:*}"
	pin_text="${pin#*:}"
	if [[ "$pin_text" =~ ^[[:space:]]*ARG[[:space:]]+RUST_VERSION=([^[:space:]]+) ]]; then
		pin_version="${BASH_REMATCH[1]}"
	elif [[ "$pin_text" =~ (^|[/[:space:]])rust:([^-[:space:]@]+) ]]; then
		pin_version="${BASH_REMATCH[2]}"
	else
		continue
	fi
	rust_pins=$((rust_pins + 1))
	if [[ -z "$rust_channel" ]]; then
		echo "error: $pin_file:$pin_line pins Rust $pin_version, and rust-toolchain.toml names no channel to hold it to." >&2
		problems=$((problems + 1))
	elif [[ "$pin_version" != "$rust_channel" ]]; then
		echo "error: $pin_file:$pin_line pins Rust $pin_version, and rust-toolchain.toml's channel is $rust_channel." >&2
		echo "       Fix: set the pin to $rust_channel." >&2
		problems=$((problems + 1))
	fi
done < <(
	for dockerfile in "${dockerfiles[@]}"; do
		grep -HnE '^[[:space:]]*(FROM[[:space:]]+(.*[/[:space:]])?rust:|ARG[[:space:]]+RUST_VERSION=)' "$dockerfile" || true
	done
)

if ((problems > 0)); then
	echo >&2
	echo "$problems build-context problem(s) across ${#dockerfiles[@]} Dockerfile(s)." >&2
	exit 1
fi
echo "$checked context-source check(s) across ${#dockerfiles[@]} Dockerfile(s), against each allowlist that can apply, all survive."
if [[ -f rust-toolchain.toml ]]; then
	echo "$rust_pins Rust pin(s) name rust-toolchain.toml's channel${rust_channel:+, $rust_channel}."
else
	echo "No rust-toolchain.toml, and no Dockerfile pins Rust."
fi
