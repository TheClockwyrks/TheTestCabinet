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
# WHAT A PROJECT IS. A directory whose parent is named `validation` and which
# holds a `vitest.config.ts` — exactly how the runner identifies one
# (crates/core/src/vitest_validator.rs). A run stages ONE project, copying
# `validation/<engine>/` whole into the produced tree at `validation/`, beside
# the build's `src/`. Nothing outside the copied directory exists when the
# suites run, which is why "does this reference leave the project" is a question
# about correctness and not only about policy.
#
# WHAT IT CHECKS, per project:
#
#   1. The project ships a `constants.ts` at its root — the module that
#      transcribes the case's figures from its rendered specs.
#
#   2. No reference leaves the project except into the build's `src/`. Anything
#      else resolves to nothing once the project is staged.
#
#   3. A reference into the build's `src/` is allowed only in these forms, and
#      the gate parses the statement rather than matching the specifier, because
#      `export * from "../src/constants"` and `export { LAYOUT } from
#      "../src/constants"` name the same module and only one of them is a
#      boundary:
#
#        - `constants.ts` may take NAMED bindings from any module of the build,
#          and re-exports each under a heading saying why that value is the
#          build's to choose. This is the one import site the rule is built on.
#        - `harness.ts` may take NAMED bindings from the build's ENTRY module,
#          `../src/game`, and from nothing else: the loader has to construct the
#          game it drives, and every other module of the build is a figure
#          source it has no business reading.
#        - Any file may take a TYPE-ONLY clause (`import type { … }`) from the
#          build. A type is erased before anything runs, so it carries no figure.
#
#      Every other form is refused, including the ones that used to walk
#      straight through a specifier match: `export *` and `import * as ns`
#      (which re-export the build's whole figure table through the one exempted
#      file), a default binding, a bare side-effect `import`, a dynamic
#      `import()`, and `require()`. So is anything the parser cannot positively
#      recognize — unrecognized is a finding, not a pass.
#
#   4. The project's `tsconfig.json` and `package.json` name nothing outside the
#      project, so no path alias or file: dependency can re-open a route the
#      source-level rules close. (`extends` is the exception: the shared config
#      it names sits beside the staged project at run time.)
#
# The parsing lives in scripts/ci/validator-imports.awk, one invocation per
# candidate file; this script decides which files to read and what the verdict
# means. Both are POSIX-ish shell and awk on purpose — the gate has to run in a
# job with no toolchain, before anything is installed.
#
# WHAT IT CANNOT SEE, stated so nobody assumes otherwise. The gate reads the
# text; a specifier that exists only at run time is invisible to it —
# `await import("..".concat("/../src/constants"))`, a `readFileSync(join("..",
# "..", "src", "constants.ts"))`. Both were tried against it and both pass. No
# textual gate can close that, and neither can be written by accident: the
# defect this exists to catch is the ordinary import an author reaches for
# without thinking, and every static spelling of one is refused. A computed
# specifier in a validator is a deliberate act, and reads like one in review.
#
# WHAT IT REPORTS EVEN WHEN IT PASSES. Every name a project takes across the
# boundary, per file. "One import site" is only worth having if the names that
# cross it can be read at a glance, and a list that grows is the signal that a
# case is drifting back toward grading the build against itself.
#
# The rule is stated for authors in
# apps/docs/src/content/docs/guides/authoring/writing-debug-apis-and-validators.md.
#
# Invoked by pre-commit (see .pre-commit-config.yaml) with the staged validator
# sources, which scopes the report to the case being committed; invoked by CI
# (azure-pipelines.yml and .github/workflows/ci.yml) with no arguments, which
# reads every project in the repository. Also runnable by hand over any path:
#
#   ./scripts/ci/validator-constants.sh
#   ./scripts/ci/validator-constants.sh test-cases/end-to-end/easy/carom/v3.0.0
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly CLASSIFIER="$CI_LIB_DIR/validator-imports.awk"

# WHAT BLOCKS AND WHAT ONLY REPORTS — a ratchet, not a flag day.
#
# The conversion runs one case at a time, on a branch of its own, and until the
# last of them merges the repository holds converted and unconverted projects
# side by side. A gate that blocked everything would refuse every unconverted
# merge; a gate that blocked nothing would let a converted case rot straight
# back. So the unit of enforcement is the PROJECT, and a project ENROLS ITSELF:
#
#   ships a constants.ts  →  BLOCKING. It has been converted, so every rule
#                            above is held against it, on every branch, from the
#                            commit that converted it.
#   ships none            →  reported. It has not been converted yet; the report
#                            says so and names what it would have to fix.
#
# Nothing has to be listed anywhere and nothing has to be pruned later: adding
# the constants.ts IS the enrolment, so the set of enforced projects grows by
# exactly the conversions that land. A case authored from today enrols on its
# first commit, which is the case this gate mostly exists for.
#
# `TCAB_VALIDATOR_CONSTANTS_ENFORCE=1` raises it to blocking for EVERY project,
# including the ones with no constants.ts at all. That is the end state: set this
# default to 1 once no unconverted project is left, and the ratchet becomes a
# plain gate.
ENFORCE="${TCAB_VALIDATOR_CONSTANTS_ENFORCE:-0}"
readonly ENFORCE

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

# Whether a file's own findings are printed. Named paths print only what they
# named, so a commit's report is about the commit; a whole-repository run prints
# everything. Either way the per-project counts below cover the rest.
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

# What a finding code means, in one line, so the report explains itself.
explain() {
	case "$1" in
	OUTSIDE) printf 'reaches outside the project, which a staged run does not carry' ;;
	ESCAPE) printf 'reads the build; only constants.ts may' ;;
	MODULE) printf 'is not the build entry harness.ts may load' ;;
	FORM) printf 'is not a named import/export clause' ;;
	CONFIG) printf 'names a path outside the project' ;;
	*) printf 'is not allowed here' ;;
	esac
}

missing=0
blocking=0
reported=0
declare -a inventory=()

for project in "${projects[@]}"; do
	# Enrolment, as described at the top: a project that has been converted holds
	# the constants.ts that converted it, and is held to the rules from here on.
	if [ -f "$project/constants.ts" ]; then
		enrolled=1
	else
		enrolled=0
		printf '%s: no constants.ts, so every figure a suite asserts comes from the build\n' \
			"$project" >&2
		missing=$((missing + 1))
	fi

	in_project=0

	# Only files that carry a climbing `../` can hold a reference that leaves the
	# project, so the parse — which reads whole files character by character — runs
	# on the handful that do rather than on every suite in the case.
	while IFS= read -r file; do
		grep -qE '["'"'"'`]\.\./' "$file" || continue

		rel="${file#"$project"/}"
		case "$rel" in
		*/*) depth="$(printf '%s' "${rel%/*}" | tr -cd '/' | wc -c)" && depth=$((depth + 1)) ;;
		*) depth=0 ;;
		esac

		case "$rel" in
		constants.ts) role=constants ;;
		harness.ts) role=harness ;;
		*) role=other ;;
		esac

		hits="$(awk -v depth="$depth" -v role="$role" -f "$CLASSIFIER" "$file")"
		[ -n "$hits" ] || continue

		while IFS=$'\t' read -r code line spec detail; do
			[ -n "$code" ] || continue
			if [ "$code" = "NAMES" ]; then
				inventory+=("$(printf '  %s:%s\t%s\t%s' "$file" "$line" "$spec" "$detail")")
				continue
			fi
			in_project=$((in_project + 1))
			if [ "$enrolled" -eq 1 ] || [ "$ENFORCE" -ne 0 ]; then
				blocking=$((blocking + 1))
			else
				reported=$((reported + 1))
			fi
			if [ "$#" -eq 0 ] || named "$file" "$@"; then
				printf '%s:%s: %s %s%s\n' "$file" "$line" "$spec" "$(explain "$code")" \
					"${detail:+ — saw: $detail}" >&2
			fi
		done <<<"$hits"
	done < <(find "$project" -type d -name node_modules -prune -o \
		-type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print |
		sort)

	# The configuration half. A `paths` alias in tsconfig.json or a `file:`
	# dependency in package.json reaches the build without any source in the
	# project saying so, so neither may name anything outside the project.
	# `extends` is the one path that legitimately points out: the shared config it
	# names sits beside the project once a run has staged it.
	for config in "$project/tsconfig.json" "$project/package.json"; do
		[ -f "$config" ] || continue
		while IFS= read -r hit; do
			line="${hit%%:*}"
			text="${hit#*:}"
			case "$text" in
			*'"extends"'*) continue ;;
			esac
			in_project=$((in_project + 1))
			if [ "$enrolled" -eq 1 ] || [ "$ENFORCE" -ne 0 ]; then
				blocking=$((blocking + 1))
			else
				reported=$((reported + 1))
			fi
			if [ "$#" -eq 0 ] || named "$config" "$@"; then
				printf '%s:%s: %s %s\n' "$config" "$line" \
					"$(printf '%s' "$text" | sed 's/^[[:space:]]*//')" "$(explain CONFIG)" >&2
			fi
		done < <(grep -nE '"[^"]*\.\./' "$config" || true)
	done

	if [ "$in_project" -ne 0 ]; then
		printf '%s: %s reference(s) the project may not make%s\n' "$project" "$in_project" \
			"$([ "$enrolled" -eq 1 ] && printf '' || printf ' (not converted yet — reported only)')" >&2
	fi
done

# The inventory prints on a clean run too: it is the count "one import site" was
# meant to buy, and the thing to read when a case starts drifting back.
if [ "${#inventory[@]}" -ne 0 ]; then
	printf '\nNames taken from the build (%s clause(s)):\n' "${#inventory[@]}"
	printf '%s\n' "${inventory[@]}" | expand -t 2
fi

if [ "$missing" -eq 0 ] && [ "$blocking" -eq 0 ] && [ "$reported" -eq 0 ]; then
	printf '\nAll %s validator project(s) state the figures they assert.\n' "${#projects[@]}"
	exit 0
fi

cat >&2 <<MESSAGE

${blocking} reference(s) a converted validator project may not make; ${reported} more in
projects not converted yet, and ${missing} project(s) ship no constants.ts of their own.

A validator grades a build against the case's specification. A figure imported
from the build's own module grades the build against itself, which every build
survives — including the one that got the figure wrong. And a reference that
leaves the project without landing in the build resolves to nothing at all: a
run stages validation/<engine>/ alone.

Transcribe the figures from the rendered specs into the project's own
constants.ts, under the names the specs use, and import each asserted figure
from there ("./constants" at the project root, "../constants" one directory
down). Of the project's own files:

  constants.ts  may take NAMED bindings from the build — and only values the
                specification leaves to the build, read to drive it rather than
                to grade it. Never "export *": that hands every suite in the
                project the build's whole figure table through the one file the
                rule exempts.
  harness.ts    may take NAMED bindings from the build's entry, ../src/game,
                and from no other module of the build.
  every file    may take a type-only clause (import type { … }) from the build.

The rule and a worked example:
apps/docs/src/content/docs/guides/authoring/writing-debug-apis-and-validators.md
MESSAGE

if [ "$blocking" -ne 0 ] || { [ "$ENFORCE" -ne 0 ] && [ "$missing" -ne 0 ]; }; then
	exit 1
fi

printf '\nReported, not blocked: every finding above is in a project that has no\nconstants.ts yet, so it is not enrolled (see the header).\n' >&2
