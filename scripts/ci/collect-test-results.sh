#!/usr/bin/env bash
# Collects the JUnit report every test gate left into the directory the job
# publishes as its test results.
#
#   scripts/ci/collect-test-results.sh [<from> [<to>]]
#
# <from> is where the gates were told to leave what they write, one folder per
# gate named by its id, which is `target/gate-artifacts` unless given; <to> is
# the directory the job publishes, `target/test-results` unless given. Either
# may be relative to the working directory it is run from, and the defaults are
# relative to the workspace root.
#
# Each `<from>/<id>/junit.xml` present is copied to `<to>/<id>/junit.xml`, and
# nothing else is: the screenshots and the coverage a gate leaves beside its
# report travel in the artifacts that already carry them, and the artifact this
# directory becomes holds the reports alone. <to> is emptied first, so it holds
# this run's reports and no earlier one's.
#
# Once it has copied a report it sets the pipeline variable
# `testResultsCollected`, which the publish step after it runs on, so a job
# whose gates wrote no report publishes no empty artifact. Outside a pipeline
# that line is printed and read by nothing.
#
# Run by the pipeline at the end of each job that runs a test gate, whether the
# tests passed or failed; runnable by hand from any working directory.
set -euo pipefail

# An argument relative to the directory the script was run from, made absolute
# before lib.sh moves to the workspace root.
absolute() {
	case "$1" in
	/*) printf '%s\n' "$1" ;;
	*) printf '%s\n' "$PWD/$1" ;;
	esac
}

from=""
to=""
[ "$#" -ge 1 ] && from="$(absolute "$1")"
[ "$#" -ge 2 ] && to="$(absolute "$2")"
if [ "$#" -gt 2 ]; then
	echo >&2 "usage: scripts/ci/collect-test-results.sh [<from> [<to>]]"
	exit 2
fi

# shellcheck source=scripts/ci/lib.sh
# SC1091 is suppressed because this repository holds `lib.sh.jinja`, so the
# source above resolves in a render and not here.
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

from="${from:-$PROJECT_ROOT/target/gate-artifacts}"
to="${to:-$PROJECT_ROOT/target/test-results}"

rm -rf "$to"
mkdir -p "$to"

copied=0
for report in "$from"/*/junit.xml; do
	# An unmatched pattern is left as written, which is no file.
	[ -f "$report" ] || continue
	gate="$(basename "$(dirname "$report")")"
	mkdir -p "$to/$gate"
	cp "$report" "$to/$gate/junit.xml"
	echo "collected the $gate report"
	copied=$((copied + 1))
done

if [ "$copied" -eq 0 ]; then
	echo "no gate left a JUnit report under $from, so there are no test results to publish"
	exit 0
fi

echo "$copied JUnit report(s) collected into $to"
echo "##vso[task.setvariable variable=testResultsCollected]true"
