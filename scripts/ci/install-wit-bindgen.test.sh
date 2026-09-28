#!/usr/bin/env bash
# Table test for install-wit-bindgen.sh. Run it directly:
# scripts/ci/install-wit-bindgen.test.sh
#
# A copy of the script runs in a throwaway repository whose rust, swift and cpp
# version files pin wit-bindgen at the versions the case declares, and whose
# scripts/gg-downloads.sh is a stub that records the version it was asked for
# and writes a small `wit-bindgen`. The subject is that every pin must be set
# and agree before anything is fetched.
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

fresh_repo() { # rust swift cpp
	local repo arm version
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/install-wit-bindgen.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	for arm in rust:"$1" swift:"$2" cpp:"$3"; do
		version="${arm#*:}"
		arm="${arm%%:*}"
		mkdir -p "$repo/packages/gg-sandbox-$arm"
		printf 'GG_WIT_BINDGEN_VERSION="%s"\nexport GG_WIT_BINDGEN_VERSION\n' "$version" \
			>"$repo/packages/gg-sandbox-$arm/$arm-version.sh"
	done
	cat >"$repo/scripts/gg-downloads.sh" <<'EOF2'
gg_wit_bindgen() {
	echo "wit-bindgen $1" >>"$STUB_LOG"
	mkdir -p "$STUB_DIR"
	printf '#!/bin/sh\necho "wit-bindgen-cli %s"\n' "$1" >"$STUB_DIR/wit-bindgen"
	chmod +x "$STUB_DIR/wit-bindgen"
	echo "$STUB_DIR/wit-bindgen"
}
EOF2
	printf '%s' "$repo"
}
run() { # repo
	: >"$tmp/calls.log"
	(cd "$tmp" && env -u GG_WIT_BINDGEN_VERSION STUB_LOG="$tmp/calls.log" STUB_DIR="$tmp/wit" \
		"$1/scripts/ci/install-wit-bindgen.sh" 2>&1)
}

repo="$(fresh_repo 0.46.0 0.46.0 0.46.0)"
out="$(run "$repo")"
check_equal "three agreeing pins install" "0" "$?"
check_equal "that one version" "wit-bindgen 0.46.0" "$(cat "$tmp/calls.log")"
check_contains "and report where it is" "wit-bindgen 0.46.0 at $tmp/wit/wit-bindgen" "$out"
check_contains "and run it" "wit-bindgen-cli 0.46.0" "$out"

for pins in "0.47.0 0.46.0 0.46.0" "0.46.0 0.47.0 0.46.0" "0.46.0 0.46.0 0.47.0"; do
	# shellcheck disable=SC2086 # the three pins are split on purpose
	repo="$(fresh_repo $pins)"
	out="$(run "$repo")"
	check_equal "disagreeing pins ($pins) fail" "1" "$?"
	check_contains "saying so ($pins)" "gg's arms pin different wit-bindgen releases" "$out"
	check_contains "and listing them ($pins)" "packages/gg-sandbox-rust/rust-version.sh=${pins%% *}" "$out"
	check_equal "and fetch nothing ($pins)" "" "$(cat "$tmp/calls.log")"
done

repo="$(fresh_repo 0.46.0 "" 0.46.0)"
out="$(run "$repo")"
check_equal "an arm with no pin fails" "1" "$?"
check_contains "naming its file" "packages/gg-sandbox-swift/swift-version.sh does not set GG_WIT_BINDGEN_VERSION." "$out"
check_equal "and fetches nothing" "" "$(cat "$tmp/calls.log")"

echo
echo "install-wit-bindgen.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
