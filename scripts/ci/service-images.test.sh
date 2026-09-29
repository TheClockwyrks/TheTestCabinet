#!/usr/bin/env bash
# Table test for service-images.sh. Run it directly:
# scripts/ci/service-images.test.sh
#
# A copy of the script runs in a throwaway repository with `uname` stubbed first on
# PATH and scripts/ci/service-image.sh replaced by a stub that records each call and
# its environment, and fails on the service STUB_FAIL_ON names. The subject is the
# set and order of services built, what each call is given, and what a failure does.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

readonly SHA="0123456789abcdef0123456789abcdef01234567"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/service-images.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/scripts/ci/service-image.sh" <<'STUB'
#!/usr/bin/env bash
echo "service-image.sh $* gg=${TCAB_PREBUILT_GG:-<unset>} [cwd=$PWD]" >>"$STUB_LOG"
[[ "$1" == "${STUB_FAIL_ON:-}" ]] && exit 1
exit 0
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/scripts/ci/service-image.sh" "$repo/bin/uname"
run() {
	: >"$tmp/calls.log"
	(cd "$tmp" && STUB_LOG="$tmp/calls.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/service-images.sh" "$@" 2>&1)
}
calls() { sed 's/ gg=.*//' "$tmp/calls.log"; }

expected_order() {
	local service
	for service in backend auth dispatcher driver artifacts arena publisher web; do
		echo "service-image.sh $service $SHA"
	done
}

out="$(run "$SHA")"
check_equal "every service builds" "0" "$?"
check_equal "the eight services, Rust ones first and web last, each with the sha" \
	"$(expected_order)" "$(calls)"
check_contains "and the summary names the tag" "every service image is pushed as <image>:$SHA-amd64" "$out"
check_equal "each call runs from the repository root" "8" "$(grep -c "\[cwd=$repo\]" "$tmp/calls.log")"

out="$(STUB_UNAME_M=aarch64 run "$SHA")"
check_equal "an arm64 build succeeds" "0" "$?"
check_contains "and names its own tag" "<image>:$SHA-arm64" "$out"

out="$(TCAB_PREBUILT_GG=/stage/gg run "$SHA")"
check_equal "a prebuilt gg is passed through" "8" "$(grep -c 'gg=/stage/gg' "$tmp/calls.log")"
out="$(run "$SHA")"
check_equal "and is unset when the caller sets none" "8" "$(grep -c 'gg=<unset>' "$tmp/calls.log")"

out="$(STUB_FAIL_ON=driver run "$SHA")"
check_equal "a failing service fails the build" "1" "$?"
check_contains "naming it" "the driver image did not build; the ones before it are pushed." "$out"
check_equal "after the services before it and none after" \
	"$(expected_order | head -4)" "$(calls)"

out="$(run)"
check_equal "no sha is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/service-images.sh <sha>" "$out"
check_equal "and builds nothing" "" "$(cat "$tmp/calls.log")"

out="$(run "$SHA" extra)"
check_equal "a second argument is a usage error" "1" "$?"

echo
echo "service-images.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
