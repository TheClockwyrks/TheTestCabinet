#!/usr/bin/env bash
# Table test for collect-test-results.sh. Run it directly:
# ./collect-test-results.test.sh
#
# The script's whole contract is what it copies: each gate's `junit.xml` into a
# folder named by the gate, and nothing else a gate leaves beside it. Every case
# builds a gate artifacts directory under a scratch directory and reads back
# the tree the script wrote, so nothing here touches the workspace's own
# `target/`.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: $3"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Every file under a directory, relative to it, one to a line and sorted.
tree_of() { # directory
	(cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)
}

SET_VARIABLE="##vso[task.setvariable variable=testResultsCollected]true"

echo "--- two gates' reports among what else they left ---"

from="$tmp/one/gate-artifacts"
to="$tmp/one/test-results"
mkdir -p "$from/rust-test" "$from/web-browser-test/attachments/chromium-browser" "$from/web-test/nested"
echo '<testsuites name="rust"/>' >"$from/rust-test/junit.xml"
echo 'log' >"$from/rust-test/output.log"
echo '<testsuites name="browser"/>' >"$from/web-browser-test/junit.xml"
echo 'png' >"$from/web-browser-test/attachments/chromium-browser/failed.png"
echo '{}' >"$from/web-test/coverage-summary.json"
echo 'lcov' >"$from/web-test/lcov.info"
echo '<testsuites name="nested"/>' >"$from/web-test/nested/junit.xml"
echo '<testsuites name="loose"/>' >"$from/junit.xml"

out="$(cd / && "$CI_DIR/collect-test-results.sh" "$from" "$to" 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "copies each gate's junit.xml into a folder named by the gate, and nothing else" \
	"rust-test/junit.xml
web-browser-test/junit.xml" "$(tree_of "$to")"
check_equal "copies the rust-test report as it is" '<testsuites name="rust"/>' "$(cat "$to/rust-test/junit.xml")"
check_equal "copies the web-browser-test report as it is" '<testsuites name="browser"/>' \
	"$(cat "$to/web-browser-test/junit.xml")"
check_contains "sets the variable the publish step runs on" "$SET_VARIABLE" "$out"
check_equal "leaves the gates' own directory as it was" \
	"junit.xml
rust-test/junit.xml
rust-test/output.log
web-browser-test/attachments/chromium-browser/failed.png
web-browser-test/junit.xml
web-test/coverage-summary.json
web-test/lcov.info
web-test/nested/junit.xml" "$(tree_of "$from")"

echo "--- a destination holding an earlier run's results ---"

from="$tmp/two/gate-artifacts"
to="$tmp/two/test-results"
mkdir -p "$from/ci-tests" "$to/rust-test" "$to/ci-tests"
echo '<testsuites name="now"/>' >"$from/ci-tests/junit.xml"
echo '<testsuites name="then"/>' >"$to/rust-test/junit.xml"
echo '<testsuites name="then"/>' >"$to/ci-tests/junit.xml"
echo 'stray' >"$to/stray.txt"

out="$(cd / && "$CI_DIR/collect-test-results.sh" "$from" "$to" 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "holds this run's reports alone" "ci-tests/junit.xml" "$(tree_of "$to")"
check_equal "holds this run's report, not the earlier one" '<testsuites name="now"/>' "$(cat "$to/ci-tests/junit.xml")"

echo "--- gates that left no report ---"

from="$tmp/three/gate-artifacts"
to="$tmp/three/test-results"
mkdir -p "$from/web-test"
echo 'log' >"$from/web-test/output.log"

out="$(cd / && "$CI_DIR/collect-test-results.sh" "$from" "$to" 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "copies nothing" "" "$(tree_of "$to")"
check_lacks "does not set the variable, so nothing is published" "$SET_VARIABLE" "$out"
check_contains "says there is nothing to publish" "no gate left a JUnit report" "$out"

echo "--- no gate artifacts directory at all ---"

to="$tmp/four/test-results"
out="$(cd / && "$CI_DIR/collect-test-results.sh" "$tmp/four/absent" "$to" 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "copies nothing" "" "$(tree_of "$to")"
check_lacks "does not set the variable" "$SET_VARIABLE" "$out"

echo "--- paths relative to where it is run from ---"

mkdir -p "$tmp/five/gate-artifacts/rust-test"
echo '<testsuites/>' >"$tmp/five/gate-artifacts/rust-test/junit.xml"
out="$(cd "$tmp/five" && "$CI_DIR/collect-test-results.sh" gate-artifacts test-results 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "reads and writes beside the working directory" "rust-test/junit.xml" "$(tree_of "$tmp/five/test-results")"

echo "--- the defaults, under the workspace root ---"

# A workspace of its own, holding the script and the helpers it sources, so the
# defaults resolve under the scratch directory rather than this workspace.
root="$tmp/six"
mkdir -p "$root/scripts/ci" "$root/target/gate-artifacts/web-test"
cp "$CI_DIR/collect-test-results.sh" "$CI_DIR/lib.sh" "$root/scripts/ci/"
echo '<testsuites/>' >"$root/target/gate-artifacts/web-test/junit.xml"
out="$(cd / && "$root/scripts/ci/collect-test-results.sh" 2>&1)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "copies target/gate-artifacts into target/test-results" "web-test/junit.xml" \
	"$(tree_of "$root/target/test-results")"

echo "--- a third argument ---"

out="$(cd / && "$CI_DIR/collect-test-results.sh" a b c 2>&1)"
status=$?
check_equal "exits 2" 2 "$status"
check_contains "names its usage" "usage:" "$out"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
