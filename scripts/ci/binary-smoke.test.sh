#!/usr/bin/env bash
# Table test for binary-smoke.sh. Run it directly: scripts/ci/binary-smoke.test.sh
#
# A copy of the script runs in a throwaway repository whose smoke-binary.sh is a
# stub that records the binary it was handed. The subject is which binary that
# is: target/release/tcab, the one under CARGO_TARGET_DIR when that is set, the
# .exe on Windows, and a failure naming the directory when there is none.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
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
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_exists() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to exist"
	fi
}

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be gone"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/binary-smoke.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	cat >"$repo/scripts/ci/smoke-binary.sh" <<'STUB'
#!/usr/bin/env bash
echo "$1" >"$(dirname "$0")/smoked"
exit "${STUB_SMOKE_EXIT:-0}"
STUB
	chmod +x "$repo/scripts/ci/smoke-binary.sh"
	printf '%s' "$repo"
}
put_binary() { # path
	mkdir -p "$(dirname "$1")"
	printf '#!/bin/sh\n' >"$1"
	chmod +x "$1"
}
run() { # repo
	(cd "$tmp" && env -u CARGO_TARGET_DIR "$1/scripts/ci/binary-smoke.sh" 2>&1)
}

repo="$(fresh_repo)"
put_binary "$repo/target/release/tcab"
out="$(run "$repo")"
check_equal "a built binary passes" "0" "$?"
check_equal "the one under target/release is smoked" "target/release/tcab" "$(cat "$repo/scripts/ci/smoked")"
check_contains "and the pass is reported" "binary smoke checks passed" "$out"

repo="$(fresh_repo)"
put_binary "$tmp/shared-target/release/tcab"
out="$(cd "$tmp" && CARGO_TARGET_DIR="$tmp/shared-target" "$repo/scripts/ci/binary-smoke.sh" 2>&1)"
check_equal "a redirected target dir passes" "0" "$?"
check_equal "the binary under CARGO_TARGET_DIR is smoked" "$tmp/shared-target/release/tcab" \
	"$(cat "$repo/scripts/ci/smoked")"

repo="$(fresh_repo)"
put_binary "$repo/target/release/tcab.exe"
out="$(run "$repo")"
check_equal "a Windows build passes" "0" "$?"
check_equal "its .exe is smoked" "target/release/tcab.exe" "$(cat "$repo/scripts/ci/smoked")"

repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "no binary fails" "1" "$?"
check_contains "naming the directory and the build script" \
	"expected a tcab binary under target/release/ but found none; run scripts/ci/release-build.sh first" "$out"
check_equal "and smokes nothing" "" "$(cat "$repo/scripts/ci/smoked" 2>/dev/null)"

repo="$(fresh_repo)"
put_binary "$repo/target/release/tcab"
out="$(cd "$tmp" && env -u CARGO_TARGET_DIR STUB_SMOKE_EXIT=1 "$repo/scripts/ci/binary-smoke.sh" 2>&1)"
check_equal "a failed smoke check fails the step" "1" "$?"
check_lacks "and is not reported as passing" "binary smoke checks passed" "$out"

echo
echo "binary-smoke.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
