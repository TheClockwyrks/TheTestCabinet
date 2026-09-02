#!/usr/bin/env bash
# Verifies that a validator project states the figures it asserts, rather than
# importing them from the build it grades.
#
# WHY THIS EXISTS. A case ships one validator project per engine under
# `<version>/validation/<engine>/`, and under an engine the case also seeds the
# build a `src/constants.ts`. A suite can therefore import the figure it is about
# to assert from the build's own module — and a suite that does grades nothing.
# The comparison reduces to "does the build do what the build says it does",
# which is true of every build, including one whose figure is wrong. Proved on
# full checklists, one quiet spec violation at a time: Meltdown built with Mote
# speed 60 changed to 66 scored 338/344 against the engineless project, which
# transcribes 60 from `specs/surge.md`, and 344/344 against both engine
# projects, which read 66 out of the build. Spectra and Shatter behaved the same
# way. A run selects one engine, so on two engines in three a build with the
# wrong physics scores a clean sheet.
#
# WHAT IT CHECKS, per validator project — a directory whose parent is named
# `validation` and which holds a `vitest.config.ts`, which is exactly how the
# runner identifies a project (crates/core/src/vitest_validator.rs):
#   1. the project ships a `constants.ts` at its root, the module that
#      transcribes the case's figures from its rendered specs, and
#   2. no other file in the project imports the build's `src/constants`.
#
# One permitted import site per project is what makes the rule mechanical.
# `constants.ts` reaches for the build's module only to re-export a value the
# specification leaves to the build — which touch layout it registers, which key
# it bound where the specs name none — read to drive the build and never compared
# against. Every other file in the project imports from `constants.ts`. The rule
# is stated for authors in
# apps/docs/src/content/docs/guides/authoring/writing-debug-apis-and-validators.md.
#
# Invoked by pre-commit (see .pre-commit-config.yaml) with the staged validator
# sources, which scopes the report to the case being committed; invoked by CI
# with no arguments, which reads every project in the repository. Also runnable
# by hand over any path:
#
#   ./scripts/ci/validator-constants.sh
#   ./scripts/ci/validator-constants.sh test-cases/end-to-end/easy/carom/v3.0.0
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# REPORTS, DOES NOT BLOCK — deliberately, and temporarily.
#
# Every engine validator project in the repository violates this rule today; the
# conversion is in flight, one case at a time. A blocking gate would refuse the
# incremental commits that carry out the conversion, so the gate lands reporting
# first and is flipped once no project is left to convert. Flip it by setting
# this to 1, which is the whole change.
#
# `TCAB_VALIDATOR_CONSTANTS_ENFORCE=1` overrides it for one invocation, which is
# how a case that has been converted proves itself clean before the flip.
ENFORCE="${TCAB_VALIDATOR_CONSTANTS_ENFORCE:-0}"
readonly ENFORCE

# An import of the build's constants module, in any of the forms that reach one:
# a static `from`, a bare side-effect `import`, a dynamic `import(...)`, and
# `require(...)`. The specifier climbs out of the project with one or more `../`
# and lands on `src/constants`, optionally with an extension or a path under it.
readonly IMPORT_RE='(from|import|require)[[:space:]]*\(?[[:space:]]*["'"'"'](\.\./)+src/constants([./][^"'"'"']*)?["'"'"']'

# The projects to read: every one under test-cases/ and game-jams/, narrowed to
# the ones the given paths fall inside when the caller named any.
all_projects() {
	find test-cases game-jams -type d -name node_modules -prune -o \
		-type f -name vitest.config.ts -print 2>/dev/null |
		while read -r config; do
			project="$(dirname "$config")"
			[ "$(basename "$(dirname "$project")")" = "validation" ] && printf '%s\n' "$project"
		done | sort -u
}

mapfile -t projects < <(all_projects)

# A named path selects a project when it names a file inside it, and when it
# names a directory the project sits under — so both a staged suite and a whole
# case version reach the same projects.
if [ "$#" -gt 0 ]; then
	selected=()
	for project in "${projects[@]}"; do
		for path in "$@"; do
			case "$path/" in
			"$project"/*)
				selected+=("$project")
				break
				;;
			esac
			case "$project/" in
			"$path"/*)
				selected+=("$project")
				break
				;;
			esac
		done
	done
	projects=(${selected[@]+"${selected[@]}"})
fi

if [ "${#projects[@]}" -eq 0 ]; then
	exit 0
fi

log "verify every validator project owns the figures it asserts"

# Whether a file's own offending lines are printed. Named paths print only what
# they named, so a commit's report is about the commit; a whole-repository run
# prints everything. Either way the per-project counts below cover the rest.
named() {
	[ "$#" -eq 0 ] && return 1
	local file="$1"
	shift
	for path in "$@"; do
		case "$file/" in
		"$path"/*) return 0 ;;
		esac
	done
	return 1
}

missing=0
offending=0
for project in "${projects[@]}"; do
	if [ ! -f "$project/constants.ts" ]; then
		printf '%s: no constants.ts, so every figure a suite asserts comes from the build\n' \
			"$project" >&2
		missing=$((missing + 1))
	fi

	# Every source in the project except the one file allowed to reach for the
	# build's module.
	in_project=0
	while IFS= read -r file; do
		[ "$file" = "$project/constants.ts" ] && continue
		hits="$(grep -nIE "$IMPORT_RE" "$file")" || continue
		in_project=$((in_project + 1))
		offending=$((offending + 1))
		if [ "$#" -eq 0 ] || named "$file" "$@"; then
			while IFS= read -r hit; do
				printf '%s:%s\n' "$file" "$(printf '%s' "$hit" | sed 's/^\([0-9]*\):[[:space:]]*/\1: /')" >&2
			done <<<"$hits"
		fi
	done < <(find "$project" -type d -name node_modules -prune -o \
		-type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print |
		sort)

	if [ "$in_project" -ne 0 ]; then
		printf '%s: %s file(s) import a figure from the build\n' "$project" "$in_project" >&2
	fi
done

if [ "$missing" -eq 0 ] && [ "$offending" -eq 0 ]; then
	printf 'All %s validator project(s) state the figures they assert.\n' "${#projects[@]}"
	exit 0
fi

cat >&2 <<MESSAGE

${offending} file(s) import a figure from the build's src/constants, and ${missing} project(s)
ship no constants.ts of their own.

A validator grades a build against the case's specification. A figure imported
from the build's own module grades the build against itself, which every build
survives — including the one that got the figure wrong.

Transcribe the figures from the rendered specs into the project's own
constants.ts, under the names the specs use, and import each asserted figure
from there ("./constants" at the project root, "../constants" one directory
down). constants.ts is the only file permitted to import the build's
"../src/constants", and only to re-export a value the specification leaves to
the build, read to drive it rather than to grade it.

The rule and a worked example:
apps/docs/src/content/docs/guides/authoring/writing-debug-apis-and-validators.md
MESSAGE

if [ "$ENFORCE" -ne 0 ]; then
	exit 1
fi

printf '\nReported, not blocked: this gate is not enforcing yet (see the header).\n' >&2
