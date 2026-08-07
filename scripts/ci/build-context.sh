#!/usr/bin/env bash
# Verifies that every file a Dockerfile COPYs out of the build context survives
# `.dockerignore`.
#
# WHY THIS EXISTS. `.dockerignore` is an ALLOWLIST — `*`, then explicit `!`
# re-inclusions — so the default answer for any path is "not in the context". A
# `COPY` whose source was never re-included therefore does not warn: the build dies
# with `failed to compute cache key: "/path": not found`, preceded by the giveaway
# `transferring context: 2B`. Nothing else in this repository can see that. The Rust
# suite, `contract-drift.sh`, the lints and the front-end builds all pass on a tree
# whose images cannot be built at all, and the image builds themselves live on a
# GitHub workflow that only runs on master/staging — so the defect lands, and is
# found by whoever next needs a run container. It has happened twice: once when the
# Blender image added its two authoring helpers, and once when the gg toolchain
# builder added the Java arm's installer, which broke the `-gg` variant of EVERY
# language rather than only Java's.
#
# What it checks, per tracked Dockerfile, for every `COPY`/`ADD` that reads the
# build context (`--from=` copies read an earlier stage, and remote `ADD` sources
# read the network — neither touches the context):
#   1. the source path exists in the repository, and
#   2. `.dockerignore` leaves it in the context.
#
# Whole-context copies (`COPY . .`) are inspected for neither: they take whatever the
# allowlist admits, which is exactly the question the allowlist answers.
#
# The evaluation mirrors Docker's own: patterns apply in order, the last one to match
# wins, a `!` pattern re-includes, and a path is ignored when it or any ancestor
# directory is. `*` and `?` do not cross `/`; `**` does.
#
# Needs no toolchain and no history — it reads the checked-out tree — so it runs as a
# pre-commit hook and as a standalone CI job.
#
# Usage:
#   scripts/ci/build-context.sh
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# --- the .dockerignore matcher ----------------------------------------------

# Ordered pattern tables, filled by load_dockerignore: one anchored ERE per pattern
# and a parallel flag saying whether the pattern was negated (`!`, i.e. re-includes).
DI_REGEX=()
DI_NEGATED=()

# Translate one .dockerignore pattern into an anchored ERE with Docker's glob
# semantics: `*` and `?` stop at a path separator, `**` spans them, and a leading
# `**/` also matches at the root (so `**/target` covers a top-level `target`).
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
		# Everything ERE treats as syntax, taken literally.
		'.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | \\) out+="\\$char" ;;
		*) out+="$char" ;;
		esac
	done
	printf '%s%s$' "$prefix" "$out"
}

# Read a .dockerignore into the pattern tables, dropping blanks and comments.
load_dockerignore() {
	local file="$1" line
	DI_REGEX=()
	DI_NEGATED=()
	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%$'\r'}"
		# Trim surrounding whitespace; a pattern never has meaningful edges.
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

# True when the path is still in the build context after every pattern has applied.
context_includes() {
	local path="$1" ignored=0 index regex candidate hit
	for index in "${!DI_REGEX[@]}"; do
		regex="${DI_REGEX[$index]}"
		hit=0
		candidate="$path"
		# A path is matched when it matches, or when any ancestor directory does —
		# an ignored directory takes everything under it.
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

# --- the matcher's teeth ----------------------------------------------------

# A gate nobody has watched fail is a gate nobody knows works. This drives the
# matcher over a synthetic allowlist of the shape this repository uses and asserts
# both answers, including the two shapes that have actually broken a build here: a
# file re-included by name, and a file under a re-included directory.
self_test() {
	local fixture failures=0 case_line path expected
	fixture="$(mktemp)"
	cat >"$fixture" <<'PATTERNS'
# a comment, and a blank line, both ignored

*
!/crates
!/scripts/ci/install-java.sh
!/apps/web
!/docs/*.md
!/vendor/**/keep.txt
**/target/
**/node_modules/
PATTERNS
	load_dockerignore "$fixture"
	rm -f "$fixture"

	while read -r path expected; do
		[[ -n "$path" ]] || continue
		if context_includes "$path"; then
			case_line="included"
		else
			case_line="ignored"
		fi
		if [[ "$case_line" != "$expected" ]]; then
			echo "error: matcher self-test: '$path' came back $case_line, expected $expected" >&2
			failures=$((failures + 1))
		fi
	done <<'CASES'
crates/gg/src/main.rs included
crates/Cargo.toml included
scripts/ci/install-java.sh included
scripts/ci/install-purescript.sh ignored
scripts/ci ignored
packages/gg-sandbox-java/java-version.sh ignored
apps/web/src/main.tsx included
apps/docs/astro.config.mjs ignored
crates/gg/target/debug/gg ignored
crates/target ignored
target ignored
apps/web/node_modules/left-pad/index.js ignored
Cargo.toml ignored
docs/overview.md included
docs/nested/overview.md ignored
vendor/one/two/keep.txt included
vendor/one/two/drop.txt ignored
CASES

	((failures == 0)) || {
		echo "error: the .dockerignore matcher is wrong; its verdicts below cannot be trusted." >&2
		exit 1
	}
}

# --- reading the Dockerfiles ------------------------------------------------

# Print `<line-number> <instruction and its arguments, one logical line>` for every
# COPY/ADD in the file, joining backslash continuations and dropping comment lines.
copy_instructions() {
	awk '
		{
			line = $0
			sub(/\r$/, "", line)
			if (pending != "") {
				# Inside a continuation: a comment line is a comment, not an argument.
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

log "verify every Dockerfile COPY can see its source in the build context"
self_test
load_dockerignore "$REPO_ROOT/.dockerignore"

problems=0
checked=0
mapfile -t dockerfiles < <(git ls-files '*Dockerfile' '*.Dockerfile' | sort)
((${#dockerfiles[@]} > 0)) || {
	echo "error: no tracked Dockerfiles found; this gate would pass vacuously." >&2
	exit 1
}

for dockerfile in "${dockerfiles[@]}"; do
	while read -r lineno instruction; do
		[[ -n "$instruction" ]] || continue
		# shellcheck disable=SC2206  # deliberate word-splitting: Dockerfile arguments
		args=($instruction)
		# Drop the instruction keyword and every flag; keep the positional arguments.
		positional=()
		from_stage=""
		for arg in "${args[@]:1}"; do
			case "$arg" in
			--from=*)
				from_stage="${arg#--from=}"
				;;
			--*) ;;
			*) positional+=("$arg") ;;
			esac
		done
		# `--from=` reads an earlier stage or an external image, never the context.
		[[ -n "$from_stage" ]] && continue
		# The last positional argument is the destination.
		((${#positional[@]} >= 2)) || continue
		for source in "${positional[@]:0:${#positional[@]}-1}"; do
			# A remote ADD reads the network; a whole-context copy takes whatever the
			# allowlist admits, which is the allowlist's own answer.
			[[ "$source" == *://* ]] && continue
			[[ "$source" == '.' || "$source" == './' ]] && continue
			# A source built from a build arg (the `ADD --checksum=… ${PACK_URL}` pack
			# fetches) resolves at build time, not here; there is no path to check.
			[[ "$source" == *'$'* ]] && continue
			# A glob's expansion is the build context's business, not ours.
			[[ "$source" == *'*'* || "$source" == *'?'* || "$source" == *'['* ]] && continue
			normalized="${source#./}"
			checked=$((checked + 1))
			if [[ ! -e "$REPO_ROOT/$normalized" ]]; then
				echo "error: $dockerfile:$lineno copies '$source', which does not exist in the repository." >&2
				problems=$((problems + 1))
				continue
			fi
			if ! context_includes "$normalized"; then
				echo "error: $dockerfile:$lineno copies '$source', which .dockerignore keeps OUT of the build context." >&2
				echo "       The build will fail with: failed to compute cache key: \"/$normalized\": not found" >&2
				echo "       Fix: add '!/$normalized' to the .dockerignore allowlist, with a comment saying which image needs it." >&2
				problems=$((problems + 1))
			fi
		done
	done < <(copy_instructions "$dockerfile")
done

((problems == 0)) || {
	echo >&2
	echo "$problems build-context problem(s) found across ${#dockerfiles[@]} Dockerfiles." >&2
	exit 1
}

echo "$checked context source(s) across ${#dockerfiles[@]} Dockerfiles are all in the build context."
