#!/usr/bin/env bash
# Table test for manifest.sh. Run it directly: scripts/ci/manifest.test.sh
#
# A copy of the script runs in a throwaway repository with `docker` stubbed
# first on PATH, recording its arguments and failing whichever call the case
# says. Nothing reaches a registry. The subject is the manifest list each image
# gets and that a failed one fails the step.
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

readonly SHA="0123456789abcdef0123456789abcdef01234567"
readonly R="testcabinet.azurecr.io"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/manifest.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
n="$(grep -c . "$STUB_LOG")"
code="STUB_DOCKER_EXIT_$n"
exit "${!code:-0}"
STUB
chmod +x "$repo/bin/docker"
run() {
	: >"$tmp/docker.log"
	(cd "$tmp" && STUB_LOG="$tmp/docker.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/manifest.sh" "$@" 2>&1)
}

out="$(run "$SHA" tcab-backend test-cabinet-base)"
check_equal "two images pass" "0" "$?"
check_equal "each gets <sha> from its two arch tags, then is inspected" \
	"docker buildx imagetools create --tag $R/tcab-backend:$SHA $R/tcab-backend:$SHA-amd64 $R/tcab-backend:$SHA-arm64
docker buildx imagetools inspect $R/tcab-backend:$SHA
docker buildx imagetools create --tag $R/test-cabinet-base:$SHA $R/test-cabinet-base:$SHA-amd64 $R/test-cabinet-base:$SHA-arm64
docker buildx imagetools inspect $R/test-cabinet-base:$SHA" "$(cat "$tmp/docker.log")"

out="$(STUB_DOCKER_EXIT_1=1 run "$SHA" tcab-backend test-cabinet-base)"
check_equal "a failed create fails the step" "1" "$?"
check_equal "and goes no further" "1" "$(grep -c . "$tmp/docker.log")"

out="$(run "$SHA")"
check_equal "no image is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/manifest.sh <sha> <image>..." "$out"
check_equal "and runs nothing" "" "$(cat "$tmp/docker.log")"

echo
echo "manifest.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
