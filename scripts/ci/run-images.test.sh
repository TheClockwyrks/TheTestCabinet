#!/usr/bin/env bash
# Table test for run-images.sh. Run it directly: scripts/ci/run-images.test.sh
#
# A copy of the script runs in a throwaway repository whose
# containers/image-names.sh and containers/build.sh are stubs: the first lists
# two images, and the second records its arguments and environment and prints
# the `gg selfcheck ok:` lines the case declares. scripts/ci/gg-release.sh is a
# stub that records the fetch and writes a `gg`, and `uname` is stubbed to the
# machine the case declares. The subject is the build it asks for, the gg it
# drives the self-check with, that a build which pushed without running the
# self-check in every environment representative fails, and that a tool image the
# registry lacks (scripts/ci/tool-images.sh check, stubbed) fails before any build.
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
# The inputs table build.sh is handed: a stub prints a fixed one, and the build stub
# records the table it was given, so the test sees the two wired together.
cat >"$repo/scripts/ci/run-image-inputs.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "base 0123 -" "sprite-gg 4567 sprite"
exit "${STUB_INPUTS_EXIT:-0}"
STUB
cat >"$repo/scripts/ci/tool-images.sh" <<'STUB'
#!/usr/bin/env bash
echo "tool-images.sh $*" >>"$STUB_TOOLS_LOG"
if [[ "${STUB_TOOLS_EXIT:-0}" -ne 0 ]]; then
	echo "tool-images.sh: testcabinet.azurecr.io/tool-sprite:abc is not in the registry." >&2
	exit "$STUB_TOOLS_EXIT"
fi
STUB
cat >"$repo/scripts/ci/gg-release.sh" <<'STUB'
#!/usr/bin/env bash
echo "gg-release.sh $*" >>"$STUB_FETCH_LOG"
[[ "${STUB_FETCH_EXIT:-0}" -eq 0 ]] || exit "$STUB_FETCH_EXIT"
mkdir -p "$2" && printf '#!/bin/sh\necho gg 0.7.1\n' >"$2/gg" && chmod +x "$2/gg"
STUB
cat >"$repo/containers/image-names.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' base sprite-gg
STUB
cat >"$repo/containers/build.sh" <<'STUB'
#!/usr/bin/env bash
echo "args=$* PUSH=${PUSH:-} RECLAIM=${RECLAIM:-} IMAGE_REGISTRY=${IMAGE_REGISTRY:-} IMAGE_TAG=${IMAGE_TAG:-}" >"$STUB_LOG"
echo "inputs=$(tr '\n' ';' <"${REUSE_INPUTS:-/dev/null}")" >>"$STUB_LOG"
for image in $STUB_SELFCHECKED; do
	echo "gg selfcheck ok: $image"
done
exit "${STUB_BUILD_EXIT:-0}"
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/containers/image-names.sh" "$repo/containers/build.sh" "$repo/bin/uname" \
	"$repo/scripts/ci/run-image-inputs.sh" "$repo/scripts/ci/gg-release.sh" "$repo/scripts/ci/tool-images.sh"
run() {
	rm -f "$tmp/build.log" "$tmp/fetch.log" "$tmp/tools.log"
	(cd "$tmp" && STUB_LOG="$tmp/build.log" STUB_FETCH_LOG="$tmp/fetch.log" STUB_TOOLS_LOG="$tmp/tools.log" \
		PATH="$repo/bin:$PATH" \
		"$repo/scripts/ci/run-images.sh" "$@" 2>&1)
}
# The directory the release was fetched into, as the stub recorded it.
fetched() { sed -n 's/^gg-release.sh fetch //p' "$tmp/fetch.log" 2>/dev/null; }

out="$(STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "a build that self-checked every representative passes" "0" "$?"
dir="$(fetched)"
check_contains "after fetching the pinned gg release" "/" "$dir"
check_equal "builds every listed image with the self-check driven by that gg, pushed, as <sha>-amd64, reusing by the inputs table" \
	"args=--gg-selfcheck $dir/gg base sprite-gg PUSH=1 RECLAIM=1 IMAGE_REGISTRY=testcabinet.azurecr.io IMAGE_TAG=${SHA}-amd64
inputs=base 0123 -;sprite-gg 4567 sprite;" \
	"$(cat "$tmp/build.log")"
check_absent "and removes the fetched release on the way out" "$dir"
check_equal "after checking the tool images are published" "tool-images.sh check" "$(cat "$tmp/tools.log")"

out="$(STUB_TOOLS_EXIT=1 STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "a tool image the registry lacks fails the step" "1" "$?"
check_contains "naming it" "tool-sprite:abc is not in the registry" "$out"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"
check_equal "or fetched" "" "$(cat "$tmp/fetch.log" 2>/dev/null)"

out="$(TCAB_GG_BINARY=/opt/gg STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "TCAB_GG_BINARY names the gg instead" "0" "$?"
check_contains "which the self-check is driven with" "args=--gg-selfcheck /opt/gg base sprite-gg" "$(cat "$tmp/build.log")"
check_equal "and nothing is fetched" "" "$(cat "$tmp/fetch.log" 2>/dev/null)"

out="$(STUB_FETCH_EXIT=22 STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "a release that cannot be fetched fails the step" "22" "$?"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"
out="$(STUB_SELFCHECKED="$ALL" run "$SHA")"
check_contains "and says so" "reusing those whose inputs are unchanged" "$out"
for image in $ALL; do
	check_contains "confirms the self-check ran in $image" "gg selfcheck ran in ${image}" "$out"
done

out="$(STUB_UNAME_M=aarch64 STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "an arm64 build passes" "0" "$?"
check_contains "tagged <sha>-arm64" "IMAGE_TAG=${SHA}-arm64" "$(cat "$tmp/build.log")"

for missing in $ALL; do
	out="$(STUB_SELFCHECKED="${ALL/$missing/}" run "$SHA")"
	check_equal "a build that skipped the self-check in $missing fails" "1" "$?"
	check_contains "naming $missing" "pushed without running gg selfcheck in ${missing}." "$out"
done

out="$(STUB_SELFCHECKED="$ALL" STUB_BUILD_EXIT=1 run "$SHA")"
check_equal "a failed build fails the step" "1" "$?"
check_lacks "before any self-check is confirmed" "gg selfcheck ran in" "$out"

out="$(STUB_INPUTS_EXIT=1 STUB_SELFCHECKED="$ALL" run "$SHA")"
check_equal "an inputs table that cannot be computed fails the step" "1" "$?"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"

out="$(STUB_UNAME_M=riscv64 run "$SHA")"
check_equal "an unknown machine fails" "1" "$?"
check_equal "before anything is built" "" "$(cat "$tmp/build.log" 2>/dev/null)"

out="$(run)"
check_equal "no sha is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/run-images.sh <sha>" "$out"
out="$(run /opt/gg "$SHA")"
check_equal "and so is a gg path before it, the old form" "1" "$?"

echo
echo "run-images.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
