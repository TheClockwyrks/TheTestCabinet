#!/usr/bin/env bash
# Table test for tool-images.sh. Run it directly: scripts/ci/tool-images.test.sh
#
# A copy of the script runs in a throwaway git repository whose HEAD pins tool-sprite,
# tool-paint, tool-particle, tool-voxel, tool-mc, tool-sn and tool-dc as gitlinks, with a
# docker stub whose registry is a file of references. The subject is
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

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected output without: $2" "got: $3"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

readonly PIN=5555555555555555555555555555555555555555
readonly REF="testcabinet.azurecr.io/tool-sprite:${PIN}"
readonly PAINT_PIN=6666666666666666666666666666666666666666
readonly PAINT_REF="testcabinet.azurecr.io/tool-paint:${PAINT_PIN}"
readonly PARTICLE_PIN=7777777777777777777777777777777777777777
readonly PARTICLE_REF="testcabinet.azurecr.io/tool-particle:${PARTICLE_PIN}"
readonly VOXEL_PIN=8888888888888888888888888888888888888888
readonly VOXEL_REF="testcabinet.azurecr.io/tool-voxel:${VOXEL_PIN}"
readonly MC_PIN=9999999999999999999999999999999999999999
readonly MC_REF="testcabinet.azurecr.io/tool-mc:${MC_PIN}"
readonly SN_PIN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly SN_REF="testcabinet.azurecr.io/tool-sn:${SN_PIN}"
readonly DC_PIN=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
readonly DC_REF="testcabinet.azurecr.io/tool-dc:${DC_PIN}"
# The rows of the four model tool repositories, which follow tool-particle's in every list.
readonly MODEL_ROWS="tool-voxel TOOL_VOXEL_IMAGE ${VOXEL_REF}
tool-mc TOOL_MC_IMAGE ${MC_REF}
tool-sn TOOL_SN_IMAGE ${SN_REF}
tool-dc TOOL_DC_IMAGE ${DC_REF}"
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
# The gitlinks are made-up commit ids: the submodule's objects are never in the
# superrepo's store, which is what the script has to cope with.
(cd "$repo" && git init -q && git add -A && git update-index --add --cacheinfo "160000,${PIN},tool-sprite" \
	&& git update-index --add --cacheinfo "160000,${PAINT_PIN},tool-paint" \
	&& git update-index --add --cacheinfo "160000,${PARTICLE_PIN},tool-particle" \
	&& git update-index --add --cacheinfo "160000,${VOXEL_PIN},tool-voxel" \
	&& git update-index --add --cacheinfo "160000,${MC_PIN},tool-mc" \
	&& git update-index --add --cacheinfo "160000,${SN_PIN},tool-sn" \
	&& git update-index --add --cacheinfo "160000,${DC_PIN},tool-dc" \
	&& git -c user.name=t -c user.email=t@t commit -q -m init)

run() {
	: >"$tmp/log"
	(cd "$tmp" && DOCKER="$tmp/docker" STUB_LOG="$tmp/log" STUB_REGISTRY="$tmp/registry" \
		"$repo/scripts/ci/tool-images.sh" "$@" 2>&1)
}

check_equal "list names every tool repository at its gitlink, by its build argument" \
	"tool-sprite TOOL_SPRITE_IMAGE ${REF}
tool-paint TOOL_PAINT_IMAGE ${PAINT_REF}
tool-particle TOOL_PARTICLE_IMAGE ${PARTICLE_REF}
${MODEL_ROWS}" "$(run list)"
check_equal "an environment variable named for the argument overrides it" \
	"tool-sprite TOOL_SPRITE_IMAGE registry.test/tool-sprite:dev
tool-paint TOOL_PAINT_IMAGE ${PAINT_REF}
tool-particle TOOL_PARTICLE_IMAGE ${PARTICLE_REF}
${MODEL_ROWS}" "$(TOOL_SPRITE_IMAGE=registry.test/tool-sprite:dev run list)"
check_equal "and only that repository's" \
	"tool-sprite TOOL_SPRITE_IMAGE ${REF}
tool-paint TOOL_PAINT_IMAGE registry.test/tool-paint:dev
tool-particle TOOL_PARTICLE_IMAGE ${PARTICLE_REF}
${MODEL_ROWS}" "$(TOOL_PAINT_IMAGE=registry.test/tool-paint:dev run list)"
check_equal "tool-particle's by TOOL_PARTICLE_IMAGE" \
	"tool-sprite TOOL_SPRITE_IMAGE ${REF}
tool-paint TOOL_PAINT_IMAGE ${PAINT_REF}
tool-particle TOOL_PARTICLE_IMAGE registry.test/tool-particle:dev
${MODEL_ROWS}" "$(TOOL_PARTICLE_IMAGE=registry.test/tool-particle:dev run list)"
check_equal "a model tool repository's argument overrides only its own" \
	"tool-sprite TOOL_SPRITE_IMAGE ${REF}
tool-paint TOOL_PAINT_IMAGE ${PAINT_REF}
tool-particle TOOL_PARTICLE_IMAGE ${PARTICLE_REF}
tool-voxel TOOL_VOXEL_IMAGE ${VOXEL_REF}
tool-mc TOOL_MC_IMAGE registry.test/tool-mc:dev
tool-sn TOOL_SN_IMAGE ${SN_REF}
tool-dc TOOL_DC_IMAGE ${DC_REF}" "$(TOOL_MC_IMAGE=registry.test/tool-mc:dev run list)"

printf '%s\n' "$REF" "$PAINT_REF" "$PARTICLE_REF" "$VOXEL_REF" "$MC_REF" "$SN_REF" "$DC_REF" >"$tmp/registry"
out="$(run check)"
check_equal "check passes when the pinned images are in the registry" "0" "$?"
check_contains "and names them" "tool-sprite: ${REF}" "$out"
check_contains "each of them" "tool-paint: ${PAINT_REF}" "$out"
check_contains "tool-particle's too" "tool-particle: ${PARTICLE_REF}" "$out"
check_contains "tool-voxel's too" "tool-voxel: ${VOXEL_REF}" "$out"
check_contains "and tool-dc's" "tool-dc: ${DC_REF}" "$out"
check_equal "asking the registry about them alone" "buildx imagetools inspect ${REF}
buildx imagetools inspect ${PAINT_REF}
buildx imagetools inspect ${PARTICLE_REF}
buildx imagetools inspect ${VOXEL_REF}
buildx imagetools inspect ${MC_REF}
buildx imagetools inspect ${SN_REF}
buildx imagetools inspect ${DC_REF}" "$(cat "$tmp/log")"

: >"$tmp/registry"
out="$(run check)"
check_equal "check fails when the registry lacks them" "1" "$?"
check_contains "naming the reference" "${REF} is not in the registry" "$out"
check_contains "and the commit the superrepo pins" "pins tool-sprite at ${PIN}" "$out"
check_contains "for each of them" "pins tool-paint at ${PAINT_PIN}" "$out"
check_contains "tool-particle too" "pins tool-particle at ${PARTICLE_PIN}" "$out"
check_contains "the model tool repositories included" "pins tool-sn at ${SN_PIN}" "$out"

printf '%s\n' "$REF" "$PARTICLE_REF" "$VOXEL_REF" "$MC_REF" "$SN_REF" "$DC_REF" >"$tmp/registry"
out="$(run check)"
check_equal "check fails when the registry lacks one" "1" "$?"
check_contains "naming that one" "${PAINT_REF} is not in the registry" "$out"
check_lacks "and not the others" "${REF} is not in the registry" "$out"
check_lacks "tool-voxel's among them" "${VOXEL_REF} is not in the registry" "$out"

printf '%s\n' "$REF" "$PAINT_REF" "$VOXEL_REF" "$MC_REF" "$SN_REF" "$DC_REF" >"$tmp/registry"
out="$(run check)"
check_equal "check fails when the registry lacks the tool-particle image" "1" "$?"
check_contains "naming it and its pin" "pins tool-particle at ${PARTICLE_PIN}" "$out"
check_lacks "and no other" "${PAINT_REF} is not in the registry" "$out"

printf '%s\n' "$REF" "$PAINT_REF" "$PARTICLE_REF" "$VOXEL_REF" "$MC_REF" "$SN_REF" >"$tmp/registry"
out="$(run check)"
check_equal "check fails when the registry lacks a model tool image" "1" "$?"
check_contains "naming it" "${DC_REF} is not in the registry" "$out"
check_contains "and the commit the superrepo pins it at" "pins tool-dc at ${DC_PIN}" "$out"
check_lacks "and not the others" "${MC_REF} is not in the registry" "$out"

printf '%s\n' "$PAINT_REF" "$PARTICLE_REF" "$VOXEL_REF" "$MC_REF" "$SN_REF" "$DC_REF" >"$tmp/registry"
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
