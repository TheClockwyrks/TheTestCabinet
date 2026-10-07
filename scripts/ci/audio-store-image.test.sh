#!/usr/bin/env bash
# Table test for audio-store-image.sh. Run it directly:
# scripts/ci/audio-store-image.test.sh
#
# A copy of the script runs in a throwaway repository whose containers/build.sh
# is a stub that records its arguments and the PUSH, IMAGE_REGISTRY and
# IMAGE_TAG it was given, with `uname` stubbed to the machine the case declares.
# The subject is the image and tag it asks for, per architecture.
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

SHA="0123456789abcdef0123456789abcdef01234567"

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/containers" "$repo/bin"
cp "$CI_DIR/audio-store-image.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/containers/build.sh" <<'STUB'
#!/usr/bin/env bash
echo "cwd=$PWD args=$* PUSH=${PUSH:-} IMAGE_REGISTRY=${IMAGE_REGISTRY:-} IMAGE_TAG=${IMAGE_TAG:-}" >"$STUB_LOG"
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "$STUB_UNAME_M"
STUB
chmod +x "$repo/containers/build.sh" "$repo/bin/uname"

run() { # machine args...
	local machine="$1"
	shift
	rm -f "$tmp/build.log"
	(cd "$tmp" && STUB_LOG="$tmp/build.log" STUB_UNAME_M="$machine" PATH="$repo/bin:$PATH" \
		"$repo/scripts/ci/audio-store-image.sh" "$@" 2>&1)
}

out="$(run x86_64 "$SHA")"
check_equal "an amd64 build succeeds" "0" "$?"
check_equal "builds the audio store from the root, pushed, as <sha>-amd64" \
	"cwd=$repo args=audio-store PUSH=1 IMAGE_REGISTRY=testcabinet.azurecr.io IMAGE_TAG=${SHA}-amd64" \
	"$(cat "$tmp/build.log")"

out="$(run aarch64 "$SHA")"
check_equal "an arm64 build succeeds" "0" "$?"
check_contains "tags it <sha>-arm64" "IMAGE_TAG=${SHA}-arm64" "$(cat "$tmp/build.log")"

out="$(run x86_64)"
check_equal "no sha is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/audio-store-image.sh <sha>" "$out"
check_equal "and builds nothing" "" "$(cat "$tmp/build.log" 2>/dev/null)"

out="$(run x86_64 "$SHA" extra)"
check_equal "two arguments are a usage error" "1" "$?"

out="$(run riscv64 "$SHA")"
check_equal "an unknown machine fails" "1" "$?"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"

echo
echo "audio-store-image.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
