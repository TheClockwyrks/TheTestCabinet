#!/usr/bin/env bash
# Table test for gg-version-gate.sh. Run it directly:
# scripts/ci/gg-version-gate.test.sh
#
# Each case hands the script a stub `gg` that reports the version the case
# declares and records that it ran. The subject is the verdict: a branch build
# passes without asking, and a tag build passes only when gg reports the tag's
# version.
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

fake_gg() { # version
	cat >"$tmp/gg" <<STUB
#!/usr/bin/env bash
echo ran >>"$tmp/gg.log"
echo "gg $1"
STUB
	chmod +x "$tmp/gg"
	: >"$tmp/gg.log"
}
run() { "$CI_DIR/gg-version-gate.sh" "$@" 2>&1; }

fake_gg 0.7.0
out="$(run "$tmp/gg" refs/heads/master)"
check_equal "a branch passes" "0" "$?"
check_contains "saying there is nothing to check" "refs/heads/master is not a tag; nothing to check" "$out"
check_equal "without running gg" "" "$(cat "$tmp/gg.log")"

out="$(run "$tmp/absent" refs/pull/12/merge)"
check_equal "a pull request ref passes, whatever the binary" "0" "$?"

out="$(run "$tmp/gg" refs/tags/v0.7.0)"
check_equal "a tag matching gg's version passes" "0" "$?"
check_equal "and says so" "gg-version-gate: gg 0.7.0 matches v0.7.0" "$out"

out="$(run "$tmp/gg" refs/tags/v0.7.1)"
check_equal "a tag gg does not report fails" "1" "$?"
check_contains "naming both versions" "gg reports version '0.7.0' but the tag is 'v0.7.1'." "$out"
check_contains "and what to bump" "Bump the version of crates/gg and crates/core to 0.7.1" "$out"

out="$(run "$tmp/gg" refs/tags/v0.7.0-rc.1)"
check_equal "a pre-release tag must match exactly" "1" "$?"

fake_gg 0.7.0-rc.1
out="$(run "$tmp/gg" refs/tags/v0.7.0-rc.1)"
check_equal "and passes when it does" "0" "$?"

out="$(run "$tmp/gg")"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/gg-version-gate.sh <gg-binary> <ref>" "$out"

echo
echo "gg-version-gate.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
