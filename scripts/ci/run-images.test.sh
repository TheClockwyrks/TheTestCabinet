#!/usr/bin/env bash
# Table test for run-images.sh. Run it directly: scripts/ci/run-images.test.sh
#
# A copy of the script runs in a throwaway repository whose
# containers/image-names.sh and containers/build.sh are stubs: the first lists
# two images, and the second records its arguments and environment and prints
# the `gg selfcheck ok:` lines the case declares. `uname` is stubbed to the
# machine the case declares. The subject is the build it asks for, and that a
# build which pushed without running the self-check in every environment
# representative fails.
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
readonly ALL="sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/containers" "$repo/bin"
cp "$CI_DIR/run-images.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/containers/image-names.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' base sprite-gg
STUB
cat >"$repo/containers/build.sh" <<'STUB'
#!/usr/bin/env bash
echo "args=$* PUSH=${PUSH:-} RECLAIM=${RECLAIM:-} IMAGE_REGISTRY=${IMAGE_REGISTRY:-} IMAGE_TAG=${IMAGE_TAG:-}" >"$STUB_LOG"
for image in $STUB_SELFCHECKED; do
	echo "gg selfcheck ok: $image"
done
exit "${STUB_BUILD_EXIT:-0}"
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/containers/image-names.sh" "$repo/containers/build.sh" "$repo/bin/uname"
run() {
	rm -f "$tmp/build.log"
	(cd "$tmp" && STUB_LOG="$tmp/build.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/run-images.sh" "$@" 2>&1)
}

out="$(STUB_SELFCHECKED="$ALL" run /opt/gg "$SHA")"
check_equal "a build that self-checked every representative passes" "0" "$?"
check_equal "builds every listed image with the self-check, pushed, as <sha>-amd64" \
	"args=--gg-selfcheck /opt/gg base sprite-gg PUSH=1 RECLAIM=1 IMAGE_REGISTRY=testcabinet.azurecr.io IMAGE_TAG=${SHA}-amd64" \
	"$(cat "$tmp/build.log")"
for image in $ALL; do
	check_contains "confirms the self-check ran in $image" "gg selfcheck ran in ${image}" "$out"
done

out="$(STUB_UNAME_M=aarch64 STUB_SELFCHECKED="$ALL" run /opt/gg "$SHA")"
check_equal "an arm64 build passes" "0" "$?"
check_contains "tagged <sha>-arm64" "IMAGE_TAG=${SHA}-arm64" "$(cat "$tmp/build.log")"

for missing in $ALL; do
	out="$(STUB_SELFCHECKED="${ALL/$missing/}" run /opt/gg "$SHA")"
	check_equal "a build that skipped the self-check in $missing fails" "1" "$?"
	check_contains "naming $missing" "pushed without running gg selfcheck in ${missing}." "$out"
done

out="$(STUB_SELFCHECKED="$ALL" STUB_BUILD_EXIT=1 run /opt/gg "$SHA")"
check_equal "a failed build fails the step" "1" "$?"
check_lacks "before any self-check is confirmed" "gg selfcheck ran in" "$out"

out="$(STUB_UNAME_M=riscv64 run /opt/gg "$SHA")"
check_equal "an unknown machine fails" "1" "$?"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"

out="$(run /opt/gg)"
check_equal "no sha is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/run-images.sh <gg-binary> <sha>" "$out"

echo
echo "run-images.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
