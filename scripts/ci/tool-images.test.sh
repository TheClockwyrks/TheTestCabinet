#!/usr/bin/env bash
# Table test for tool-images.sh. Run it directly: scripts/ci/tool-images.test.sh
#
# A copy of the script runs in a throwaway git repository whose HEAD pins tool-sprite as
# a gitlink, with a docker stub whose registry is a file of references. The subject is
# the reference each tool image is named by, the override, and that `check` fails naming
# the pinned commit when the registry lacks it.
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

readonly PIN=5555555555555555555555555555555555555555
readonly REF="testcabinet.azurecr.io/tool-sprite:${PIN}"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci"
cp "$CI_DIR/tool-images.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$tmp/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
[[ "$1 $2 $3" == "buildx imagetools inspect" ]] || exit 2
grep -qxF "$4" "$STUB_REGISTRY"
STUB
chmod +x "$tmp/docker"
# The gitlink is a made-up commit id: the submodule's objects are never in the
# superrepo's store, which is what the script has to cope with.
(cd "$repo" && git init -q && git add -A && git update-index --add --cacheinfo "160000,${PIN},tool-sprite" \
	&& git -c user.name=t -c user.email=t@t commit -q -m init)

run() {
	: >"$tmp/log"
	(cd "$tmp" && DOCKER="$tmp/docker" STUB_LOG="$tmp/log" STUB_REGISTRY="$tmp/registry" \
		"$repo/scripts/ci/tool-images.sh" "$@" 2>&1)
}

check_equal "list names tool-sprite at the gitlink, by its build argument" \
	"tool-sprite TOOL_SPRITE_IMAGE ${REF}" "$(run list)"
check_equal "an environment variable named for the argument overrides it" \
	"tool-sprite TOOL_SPRITE_IMAGE registry.test/tool-sprite:dev" "$(TOOL_SPRITE_IMAGE=registry.test/tool-sprite:dev run list)"

printf '%s\n' "$REF" >"$tmp/registry"
out="$(run check)"
check_equal "check passes when the pinned image is in the registry" "0" "$?"
check_contains "and names it" "tool-sprite: ${REF}" "$out"
check_equal "asking the registry about it alone" "buildx imagetools inspect ${REF}" "$(cat "$tmp/log")"

: >"$tmp/registry"
out="$(run check)"
check_equal "check fails when the registry lacks it" "1" "$?"
check_contains "naming the reference" "${REF} is not in the registry" "$out"
check_contains "and the commit the superrepo pins" "pins tool-sprite at ${PIN}" "$out"

out="$(TOOL_SPRITE_IMAGE=registry.test/tool-sprite:dev run check)"
check_equal "an override the registry lacks fails too" "1" "$?"
check_contains "naming the variable" "TOOL_SPRITE_IMAGE names it" "$out"

(cd "$repo" && git rm -q --cached tool-sprite && git -c user.name=t -c user.email=t@t commit -q -m drop)
out="$(run list)"
check_equal "a HEAD without the submodule fails" "1" "$?"
check_contains "saying how to register it" "HEAD has no submodule at tool-sprite" "$out"

out="$(run)"
check_equal "no subcommand is a usage error" "2" "$?"
check_contains "which says how to call it" "usage: scripts/ci/tool-images.sh list | check" "$out"
out="$(run fetch)"
check_equal "and so is an unknown one" "2" "$?"

echo
echo "tool-images.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
