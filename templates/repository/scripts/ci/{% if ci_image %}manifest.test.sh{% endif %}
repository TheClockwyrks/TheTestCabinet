#!/usr/bin/env bash
# Table test for manifest.sh. Run it directly: scripts/ci/manifest.test.sh
#
# A stub `docker` first on PATH records its arguments and fails whichever call
# the case says. Nothing reaches a registry. The subject is the manifest list
# each image gets and that a failed one fails the step.
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

# In the kit the script carries a conditional name; in a render it is itself.
script="$CI_DIR/manifest.sh"
[ -f "$script" ] || script="$CI_DIR/{% if ci_image %}manifest.sh{% endif %}"

readonly SHA="0123456789abcdef0123456789abcdef01234567"
readonly R="testcabinet.azurecr.io"
mkdir -p "$tmp/bin"
cat >"$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
n="$(grep -c . "$STUB_LOG")"
code="STUB_DOCKER_EXIT_$n"
exit "${!code:-0}"
STUB
chmod +x "$tmp/bin/docker"
run() {
	: >"$tmp/docker.log"
	(cd "$tmp" && STUB_LOG="$tmp/docker.log" PATH="$tmp/bin:$PATH" "$script" "$@" 2>&1)
}

echo "--- each image is fused from its two arch tags ---"
run "$SHA" microservice-one microservice-two >/dev/null
check_equal "two images pass" "0" "$?"
check_equal "each gets <sha> from its two arch tags, then is inspected" \
	"docker buildx imagetools create --tag $R/microservice-one:$SHA $R/microservice-one:$SHA-amd64 $R/microservice-one:$SHA-arm64
docker buildx imagetools inspect $R/microservice-one:$SHA
docker buildx imagetools create --tag $R/microservice-two:$SHA $R/microservice-two:$SHA-amd64 $R/microservice-two:$SHA-arm64
docker buildx imagetools inspect $R/microservice-two:$SHA" "$(cat "$tmp/docker.log")"

echo "--- another registry ---"
IMAGE_REGISTRY=example.invalid run "$SHA" one >/dev/null
check_contains "is the one the tags name" "create --tag example.invalid/one:$SHA example.invalid/one:$SHA-amd64" "$(cat "$tmp/docker.log")"

echo "--- a failure ---"
STUB_DOCKER_EXIT_1=1 run "$SHA" microservice-one microservice-two >/dev/null
check_equal "a failed create fails the step" "1" "$?"
check_equal "and goes no further" "1" "$(grep -c . "$tmp/docker.log")"

echo "--- no image ---"
out="$(run "$SHA")"
check_equal "is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/manifest.sh <sha> <image>..." "$out"
check_equal "and runs nothing" "" "$(cat "$tmp/docker.log")"

echo
echo "manifest.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
