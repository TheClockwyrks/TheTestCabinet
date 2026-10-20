#!/usr/bin/env bash
# Table test for build.sh's REUSE_INPUTS mode and its tool images, driving it through a
# docker stub. Run it directly: containers/build.test.sh
#
# The stub keeps two sets in files: the images "in the local store" and the tags "in
# the registry". Every subcommand build.sh issues is written to a log, and the checks
# read that log: which images were built, which were retagged in the registry without
# a build, which parents were pulled, and what was pushed under an inputs tag.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1: $2"; }
check_contains() {
	if [[ "$3" == *"$2"* ]]; then ok "$1"; else bad "$1" "expected to find '$2' in: $3"; fi
}
check_lacks() {
	if [[ "$3" == *"$2"* ]]; then bad "$1" "expected not to find '$2' in: $3"; else ok "$1"; fi
}
check_equal() {
	if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$2', got '$3'"; fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/docker" <<'STUB'
#!/usr/bin/env bash
# The stub daemon: $STUB_LOCAL lists the local store's tags, $STUB_REGISTRY the
# registry's, one per line; every call is appended to $STUB_LOG. A push of the ref
# $STUB_PUSH_FAIL_REF names fails, as a registry refusing the connection does, while the
# count in the file $STUB_PUSH_FAILS is above zero, and each failure takes one off it.
set -euo pipefail
echo "$*" >>"$STUB_LOG"
has() { grep -qxF "$2" "$1" 2>/dev/null; }
add() { has "$1" "$2" || echo "$2" >>"$1"; }
del() { local keep; keep="$(grep -vxF "$2" "$1" 2>/dev/null || true)"; printf '%s\n' "$keep" | sed '/^$/d' >"$1"; }
case "$1" in
build)
	tag=""
	while [ $# -gt 0 ]; do
		[ "$1" = "-t" ] && tag="$2"
		shift
	done
	add "$STUB_LOCAL" "$tag"
	;;
image)
	case "$2" in
	inspect)
		ref="${*: -1}"
		has "$STUB_LOCAL" "$ref" || exit 1
		case "$*" in
		*Created*) echo "2026-01-01T00:00:00Z" ;;
		*RootFS*) printf 'sha256:layer-of-%s\n\n' "$ref" ;;
		*.Id*) echo "sha256:id-of-${ref}" ;;
		esac
		;;
	rm) shift 2; for ref in "$@"; do del "$STUB_LOCAL" "$ref"; done ;;
	esac
	;;
inspect) ref="${*: -1}"; has "$STUB_LOCAL" "$ref" || exit 1; echo "${ref%%:*}@sha256:pushed-${ref##*:}" ;;
tag) has "$STUB_LOCAL" "$2" || { echo "stub: $2 is not local" >&2; exit 1; }; add "$STUB_LOCAL" "$3" ;;
push)
	ref="${*: -1}"
	has "$STUB_LOCAL" "$ref" || exit 1
	if [ -n "${STUB_PUSH_FAIL_REF:-}" ] && [ "$ref" = "$STUB_PUSH_FAIL_REF" ]; then
		left="$(cat "$STUB_PUSH_FAILS")"
		if [ "$left" -gt 0 ]; then
			echo $((left - 1)) >"$STUB_PUSH_FAILS"
			echo "stub: dial tcp: connect: connection refused" >&2
			exit 1
		fi
	fi
	add "$STUB_REGISTRY" "$ref"
	;;
pull) ref="${*: -1}"; has "$STUB_REGISTRY" "$ref" || exit 1; add "$STUB_LOCAL" "$ref" ;;
buildx)
	case "$3" in
	inspect)
		ref="$4"
		has "$STUB_REGISTRY" "$ref" || exit 1
		if [[ "$*" == *--format* ]]; then echo "sha256:manifest-${ref##*:}"; fi
		;;
	create) add "$STUB_REGISTRY" "$5" ;;
	esac
	;;
builder | system | info) ;;
*) echo "stub: unexpected docker $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$tmp/docker"
# The tags carry the machine's architecture; the checks below spell amd64.
mkdir -p "$tmp/bin"
printf '#!/usr/bin/env bash\necho x86_64\n' >"$tmp/bin/uname"
chmod +x "$tmp/bin/uname"

# The inputs table: one digest per image, so a registry tag names one image's inputs.
inputs="$tmp/inputs"
cat >"$inputs" <<TABLE
tools d1 -
base d2 -
particle-3d d3 base,tools
particle-3d-gg d5 particle-3d
TABLE

reg="registry.test/ns"
prefix="test-cabinet-"
# The gg release's toolchain image, which the gg repository publishes: in the registry
# before any build, and never built here.
tc="registry.test/gg/test-cabinet-gg-toolchains:0.7.1"
# The tool-sprite image tool-sprite's pipeline publishes, likewise in the registry first.
ts="registry.test/tool-sprite:pin1"
# And the tool-paint image tool-paint's pipeline publishes.
tp="registry.test/tool-paint:pin1"
# And the four model tool repositories' images.
tv="registry.test/tool-voxel:pin1"
tm="registry.test/tool-mc:pin1"
tn="registry.test/tool-sn:pin1"
td="registry.test/tool-dc:pin1"
fresh_registry() { printf '%s\n' "$tc" "$ts" "$tp" "$tv" "$tm" "$tn" "$td" >"$tmp/registry"; }
run() {
	: >"$tmp/log"
	(cd "$HERE/.." && PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_LOCAL="$tmp/local" STUB_REGISTRY="$tmp/registry" \
		STUB_PUSH_FAIL_REF="${STUB_PUSH_FAIL_REF:-}" STUB_PUSH_FAILS="$tmp/push-fails" REGISTRY_RETRY_DELAY=0 \
		DOCKER="$tmp/docker" PUSH=1 RECLAIM=1 REUSE_INPUTS="${REUSE_INPUTS:-$inputs}" \
		GG_TOOLCHAINS_IMAGE="${GG_TOOLCHAINS_IMAGE-$tc}" TOOL_SPRITE_IMAGE="${TOOL_SPRITE_IMAGE-$ts}" \
		TOOL_PAINT_IMAGE="${TOOL_PAINT_IMAGE-$tp}" TOOL_VOXEL_IMAGE="${TOOL_VOXEL_IMAGE-$tv}" \
		TOOL_MC_IMAGE="${TOOL_MC_IMAGE-$tm}" TOOL_SN_IMAGE="${TOOL_SN_IMAGE-$tn}" TOOL_DC_IMAGE="${TOOL_DC_IMAGE-$td}" \
		IMAGE_REGISTRY="$reg" IMAGE_TAG=sha1-amd64 containers/build.sh "$@" 2>&1)
}
builds() { grep -E '^build ' "$tmp/log" | grep -oE -- '-t [^ ]+' | cut -d' ' -f2 | tr '\n' ' '; }
retags() { grep -E '^buildx imagetools create' "$tmp/log" | awk '{print $5}' | tr '\n' ' '; }
pulls() { grep -E '^pull ' "$tmp/log" | awk '{print $NF}' | tr '\n' ' '; }

echo "an empty registry builds everything and pushes each image under both tags"
: >"$tmp/local"; fresh_registry
out="$(run base particle-3d particle-3d-gg)"
check_equal "the build passes" "0" "$?"
check_equal "every image is built, the gg toolchains not among them" \
	"${prefix}tools:sha1-amd64 ${prefix}base:sha1-amd64 ${prefix}particle-3d:sha1-amd64 ${prefix}particle-3d-gg:sha1-amd64 " \
	"$(builds)"
check_equal "the toolchain image is pulled, once" "$tc " "$(pulls)"
check_contains "and the variant copies it" "--build-arg GG_TOOLCHAINS_IMAGE=$tc" "$(grep -E '^build ' "$tmp/log")"
check_equal "nothing is retagged" "" "$(retags)"
for pair in tools:d1 base:d2 particle-3d:d3 particle-3d-gg:d5; do
	name="${pair%%:*}"; digest="${pair##*:}"
	check_contains "$name is pushed under its inputs tag" "${reg}/${prefix}${name}:inputs-${digest}-amd64" "$(cat "$tmp/registry")"
done
check_lacks "tools gets no commit tag" "${reg}/${prefix}tools:sha1-amd64" "$(cat "$tmp/registry")"
check_contains "particle-3d-gg gets the commit tag" "${reg}/${prefix}particle-3d-gg:sha1-amd64" "$(cat "$tmp/registry")"
check_contains "and its reference line" "==> particle-3d-gg reference: ${reg}/${prefix}particle-3d-gg@sha256:pushed-sha1-amd64" "$out"
# The reclaim has to take the inputs tag with the others: a tag left on an image keeps
# every one of its layers, and `docker image rm` of another tag exits 0 regardless.
for name in particle-3d particle-3d-gg; do
	check_equal "the reclaimed $name has no tag left in the local store" "" "$(grep -F "${prefix}${name}:" "$tmp/local" | tr '\n' ' ')"
done
for name in tools base; do
	check_contains "$name, which the reclaim keeps, is still local" "${prefix}${name}:sha1-amd64" "$(cat "$tmp/local")"
done
check_contains "so is the toolchain image, which it never reaches" "$tc" "$(cat "$tmp/local")"
check_lacks "which is pushed nowhere" "test-cabinet-gg-toolchains:sha1" "$(cat "$tmp/registry")"
check_lacks "and no reclaim is reported as failed" "NOT reclaimed" "$out"

echo "a registry holding every inputs tag builds nothing"
: >"$tmp/local"
out="$(run base particle-3d particle-3d-gg)"
check_equal "the build passes" "0" "$?"
check_equal "nothing is built" "" "$(builds)"
check_equal "nothing is pulled" "" "$(pulls)"
check_equal "every image but tools is retagged for the commit" \
	"${reg}/${prefix}base:sha1-amd64 ${reg}/${prefix}particle-3d:sha1-amd64 ${reg}/${prefix}particle-3d-gg:sha1-amd64 " \
	"$(retags)"
check_contains "and says so" "==> reusing ${prefix}particle-3d-gg:sha1-amd64: its inputs are unchanged" "$out"
check_contains "with the reference line a build prints" "==> particle-3d-gg reference: ${reg}/${prefix}particle-3d-gg@sha256:manifest-sha1-amd64" "$out"

echo "a changed child pulls its reused parents and builds"
: >"$tmp/local"
sed -i 's/^particle-3d-gg d5 /particle-3d-gg d6 /' "$inputs"
out="$(run base particle-3d particle-3d-gg)"
check_equal "the build passes" "0" "$?"
check_equal "only the child is built" "${prefix}particle-3d-gg:sha1-amd64 " "$(builds)"
check_equal "its parent is pulled from its inputs tag, and the toolchain image for the build" \
	"${reg}/${prefix}particle-3d:inputs-d3-amd64 $tc " "$(pulls)"
check_contains "the child is pushed under its new inputs tag" "${reg}/${prefix}particle-3d-gg:inputs-d6-amd64" "$(cat "$tmp/registry")"
check_contains "particle-3d is retagged, not built" "${reg}/${prefix}particle-3d:sha1-amd64" "$(retags)"

echo "a changed parent rebuilds what is below it, from the pulled builder"
: >"$tmp/local"
sed -i 's/^base d2 /base d7 /; s/^particle-3d d3 /particle-3d d8 /; s/^particle-3d-gg d6 /particle-3d-gg d9 /' "$inputs"
out="$(run base particle-3d particle-3d-gg)"
check_equal "the build passes" "0" "$?"
check_equal "base, particle-3d and the variant are built" \
	"${prefix}base:sha1-amd64 ${prefix}particle-3d:sha1-amd64 ${prefix}particle-3d-gg:sha1-amd64 " "$(builds)"
check_equal "tools is pulled, and the toolchain image for the variant" \
	"${reg}/${prefix}tools:inputs-d1-amd64 $tc " "$(pulls)"

echo "one variant selected alone reuses its whole parent chain without a pull"
: >"$tmp/local"
out="$(run particle-3d-gg)"
check_equal "the build passes" "0" "$?"
check_equal "nothing is built" "" "$(builds)"
check_equal "nothing is pulled" "" "$(pulls)"
check_equal "the variant and its parent chain are retagged (base too: the rule that wants it present reaches it)" \
	"${reg}/${prefix}base:sha1-amd64 ${reg}/${prefix}particle-3d:sha1-amd64 ${reg}/${prefix}particle-3d-gg:sha1-amd64 " \
	"$(retags)"

echo "a table that names a parent it does not list is refused"
grep -v '^particle-3d ' "$inputs" >"$tmp/inputs2"
# `$?` of a failed substitution is what the check wants, and `set -e` would end the script
# on it first, so the status is taken on the same line.
out="$(REUSE_INPUTS="$tmp/inputs2" run particle-3d-gg)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says which" "particle-3d-gg is built from particle-3d, which the table does not list" "$out"
check_equal "before anything is built" "" "$(builds)"

echo "a push the registry refuses for a moment is retried, and the build passes"
: >"$tmp/local"; fresh_registry
variant="${reg}/${prefix}particle-3d-gg:sha1-amd64"
pushes_of() { grep -cxF "push $1" "$tmp/log" || true; }
echo 2 >"$tmp/push-fails"
out="$(STUB_PUSH_FAIL_REF="$variant" run base particle-3d particle-3d-gg)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "the refused push is tried three times" "3" "$(pushes_of "$variant")"
check_contains "and each retry is reported" "attempt 2 of 4); retrying" "$out"
check_contains "the commit tag is in the registry" "$variant" "$(cat "$tmp/registry")"
check_contains "with its reference line" "==> particle-3d-gg reference: ${reg}/${prefix}particle-3d-gg@sha256:pushed-sha1-amd64" "$out"

# The failure this guards against: a push inside `$(push_and_pin ...)` ran without `set -e`,
# so a refused push was followed by the inputs tag, a reference line, a reclaim and exit 0,
# and the commit's tag was only found missing when the architectures were fused.
echo "a push the registry keeps refusing ends the build there"
: >"$tmp/local"; fresh_registry
echo 99 >"$tmp/push-fails"
out="$(STUB_PUSH_FAIL_REF="$variant" run base particle-3d particle-3d-gg)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_equal "after every attempt" "4" "$(pushes_of "$variant")"
check_contains "and says it gave up" "failed 4 time(s), exiting 1; giving up" "$out"
check_lacks "no commit tag reached the registry" "$variant" "$(cat "$tmp/registry")"
check_lacks "no inputs tag was pushed for it" "${reg}/${prefix}particle-3d-gg:inputs-" "$(cat "$tmp/registry")"
check_lacks "no reference line was printed for it" "==> particle-3d-gg reference:" "$out"
check_lacks "and it was not reclaimed" "reclaiming ${prefix}particle-3d-gg:" "$out"

echo "without GG_TOOLCHAINS_IMAGE the variant copies the toolchains of the driver's pin"
: >"$tmp/local"; fresh_registry
pinned="testcabinet.azurecr.io/test-cabinet-gg-toolchains:$("$HERE/../scripts/ci/gg-release.sh" version)"
out="$(GG_TOOLCHAINS_IMAGE="" REGISTRY_ATTEMPTS=1 run base particle-3d particle-3d-gg)" && status=0 || status=$?
check_contains "it pulls that image" "pulling $pinned" "$out"
check_equal "and, the stub registry lacking it, fails before building the variant" "1" "$status"
check_lacks "which is not built" "${prefix}particle-3d-gg:sha1-amd64" "$(builds)"

echo "a retry count that is not a positive integer is refused"
out="$(REGISTRY_ATTEMPTS=0 run base 2>&1)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says why" "REGISTRY_ATTEMPTS must be a positive integer" "$out"

echo "REUSE_INPUTS without PUSH is refused"
out="$(cd "$HERE/.." && PATH="$tmp/bin:$PATH" DOCKER="$tmp/docker" STUB_LOG="$tmp/log" STUB_LOCAL="$tmp/local" STUB_REGISTRY="$tmp/registry" REUSE_INPUTS="$inputs" containers/build.sh base 2>&1)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says why" "REUSE_INPUTS needs PUSH=1" "$out"

echo "under PUSH, sprite copies draw out of the pinned tool-sprite image, not the tooling builder"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run sprite sprite-sheet)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "base and the two images are built, and neither tools nor tool-sprite" \
	"${prefix}base:sha1-amd64 ${prefix}sprite:sha1-amd64 ${prefix}sprite-sheet:sha1-amd64 " "$(builds)"
check_equal "the tool-sprite image is pulled, once" "$ts " "$(pulls)"
check_contains "and passed to the build" "--build-arg TOOL_SPRITE_IMAGE=$ts" "$(grep -E "^build .*${prefix}sprite:" "$tmp/log")"
check_lacks "which is given no tooling builder" "TOOLS_IMAGE=" "$(grep -E "^build .*${prefix}sprite:" "$tmp/log")"
check_lacks "and the tool image is pushed nowhere" "tool-sprite:sha1" "$(cat "$tmp/registry")"

echo "under PUSH, ui and material copy their binaries out of the pinned tool-paint image"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run ui material)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "base and the two images are built, and neither tools nor tool-paint" \
	"${prefix}base:sha1-amd64 ${prefix}ui:sha1-amd64 ${prefix}material:sha1-amd64 " "$(builds)"
check_equal "the tool-paint image is pulled, once" "$tp " "$(pulls)"
for name in ui material; do
	line="$(grep -E "^build .*${prefix}${name}:" "$tmp/log")"
	check_contains "$name is passed it" "--build-arg TOOL_PAINT_IMAGE=$tp" "$line"
	check_lacks "and no tooling builder" "TOOLS_IMAGE=" "$line"
	check_lacks "nor the tool-sprite image" "TOOL_SPRITE_IMAGE=" "$line"
done
check_lacks "and the tool image is pushed nowhere" "tool-paint:sha1" "$(cat "$tmp/registry")"

echo "under PUSH, a tool-paint image the registry lacks fails before the image that copies it"
: >"$tmp/local"; printf '%s\n' "$tc" "$ts" >"$tmp/registry"
out="$(REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run ui)" && status=0 || status=$?
check_equal "with a failure" "1" "$status"
check_contains "after trying to pull it" "pulling $tp" "$out"
check_lacks "and ui is not built" "${prefix}ui:sha1-amd64" "$(builds)"

echo "without TOOL_PAINT_IMAGE, PUSH pulls tool-paint at the superrepo's gitlink"
: >"$tmp/local"; fresh_registry
pinned_tp="testcabinet.azurecr.io/tool-paint:$(cd "$HERE/.." && git rev-parse HEAD:tool-paint)"
out="$(TOOL_PAINT_IMAGE="" REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run material)" && status=0 || status=$?
check_contains "it pulls that image" "pulling $pinned_tp" "$out"

echo "under PUSH, voxel and voxel-animation copy their binaries out of the pinned tool-voxel image"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run voxel voxel-animation)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "base and the two images are built, and neither tools nor tool-voxel" \
	"${prefix}base:sha1-amd64 ${prefix}voxel:sha1-amd64 ${prefix}voxel-animation:sha1-amd64 " "$(builds)"
check_equal "the tool-voxel image is pulled, once" "$tv " "$(pulls)"
for name in voxel voxel-animation; do
	line="$(grep -E "^build .*${prefix}${name}:" "$tmp/log")"
	check_contains "$name is passed it" "--build-arg TOOL_VOXEL_IMAGE=$tv" "$line"
	check_lacks "and no tooling builder" "TOOLS_IMAGE=" "$line"
	check_lacks "nor another tool image" "TOOL_MC_IMAGE=" "$line"
done
check_lacks "and the tool image is pushed nowhere" "tool-voxel:sha1" "$(cat "$tmp/registry")"

echo "under PUSH, the meshing and skinned images copy their binary out of tool-mc, tool-sn or tool-dc"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run mc-skinned sn-animation dc)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "base and the three images are built, in image-names.sh's order, and not tools" \
	"${prefix}base:sha1-amd64 ${prefix}sn-animation:sha1-amd64 ${prefix}dc:sha1-amd64 ${prefix}mc-skinned:sha1-amd64 " \
	"$(builds)"
check_equal "each tool image is pulled, once" "$tn $td $tm " "$(pulls)"
for pair in mc-skinned:TOOL_MC_IMAGE:$tm sn-animation:TOOL_SN_IMAGE:$tn dc:TOOL_DC_IMAGE:$td; do
	name="${pair%%:*}"; rest="${pair#*:}"; arg="${rest%%:*}"; ref="${rest#*:}"
	line="$(grep -E "^build .*${prefix}${name}:" "$tmp/log")"
	check_contains "$name is passed its repository's image" "--build-arg ${arg}=${ref}" "$line"
	check_lacks "and no tooling builder" "TOOLS_IMAGE=" "$line"
	check_lacks "nor tool-voxel's" "TOOL_VOXEL_IMAGE=" "$line"
done

echo "under PUSH, a tool-voxel image the registry lacks fails before the image that copies it"
: >"$tmp/local"; printf '%s\n' "$tc" "$ts" "$tp" "$tm" "$tn" "$td" >"$tmp/registry"
out="$(REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run voxel)" && status=0 || status=$?
check_equal "with a failure" "1" "$status"
check_contains "after trying to pull it" "pulling $tv" "$out"
check_lacks "and voxel is not built" "${prefix}voxel:sha1-amd64" "$(builds)"

echo "without TOOL_VOXEL_IMAGE, PUSH pulls tool-voxel at the superrepo's gitlink"
: >"$tmp/local"; fresh_registry
pinned_tv="testcabinet.azurecr.io/tool-voxel:$(cd "$HERE/.." && git rev-parse HEAD:tool-voxel)"
out="$(TOOL_VOXEL_IMAGE="" REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run voxel)" && status=0 || status=$?
check_contains "it pulls that image" "pulling $pinned_tv" "$out"

echo "without TOOL_DC_IMAGE, PUSH pulls tool-dc at the superrepo's gitlink"
: >"$tmp/local"; fresh_registry
pinned_td="testcabinet.azurecr.io/tool-dc:$(cd "$HERE/.." && git rev-parse HEAD:tool-dc)"
out="$(TOOL_DC_IMAGE="" REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run dc-skinned)" && status=0 || status=$?
check_contains "it pulls that image" "pulling $pinned_td" "$out"

echo "under PUSH, full-stack-3d copies from the tooling builder, tool-sprite and tool-voxel"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run full-stack-3d)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
fs3d="$(grep -E "^build .*${prefix}full-stack-3d:" "$tmp/log")"
check_contains "with the tooling builder" "--build-arg TOOLS_IMAGE=${prefix}tools:sha1-amd64" "$fs3d"
check_contains "the tool-sprite image" "--build-arg TOOL_SPRITE_IMAGE=$ts" "$fs3d"
check_contains "and the tool-voxel image" "--build-arg TOOL_VOXEL_IMAGE=$tv" "$fs3d"
check_lacks "but not the tool-mc image, which it copies nothing from" "TOOL_MC_IMAGE=" "$fs3d"

echo "under PUSH, full-stack-2d copies from both the tooling builder and tool-sprite"
: >"$tmp/local"; fresh_registry
out="$(REUSE_INPUTS="" run full-stack-2d)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
fs2d="$(grep -E "^build .*${prefix}full-stack-2d:" "$tmp/log")"
check_contains "with the tooling builder" "--build-arg TOOLS_IMAGE=${prefix}tools:sha1-amd64" "$fs2d"
check_contains "and the tool-sprite image" "--build-arg TOOL_SPRITE_IMAGE=$ts" "$fs2d"
check_lacks "but not the tool-paint image, which it copies nothing from" "TOOL_PAINT_IMAGE=" "$fs2d"
check_lacks "which is not pulled" "$tp" "$(pulls)"
check_lacks "nor the tool-voxel image, which only full-stack-3d copies from" "TOOL_VOXEL_IMAGE=" "$fs2d"
check_lacks "which is not pulled either" "$tv" "$(pulls)"

echo "under PUSH, a tool-sprite image the registry lacks fails before the image that copies it"
: >"$tmp/local"; printf '%s\n' "$tc" >"$tmp/registry"
out="$(REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run sprite)" && status=0 || status=$?
check_equal "with a failure" "1" "$status"
check_contains "after trying to pull it" "pulling $ts" "$out"
check_lacks "and sprite is not built" "${prefix}sprite:sha1-amd64" "$(builds)"

echo "without TOOL_SPRITE_IMAGE, PUSH pulls tool-sprite at the superrepo's gitlink"
: >"$tmp/local"; fresh_registry
pinned_ts="testcabinet.azurecr.io/tool-sprite:$(cd "$HERE/.." && git rev-parse HEAD:tool-sprite)"
out="$(TOOL_SPRITE_IMAGE="" REUSE_INPUTS="" REGISTRY_ATTEMPTS=1 run sprite)" && status=0 || status=$?
check_contains "it pulls that image" "pulling $pinned_ts" "$out"

# The local path, deployments/local/Makefile's: no PUSH, so the tool image is built from
# the checkout under the local naming, once, before the first image that copies it.
run_local() {
	: >"$tmp/log"
	(cd "$HERE/.." && PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_LOCAL="$tmp/local" STUB_REGISTRY="$tmp/registry" \
		DOCKER="$tmp/docker" GG_TOOLCHAINS_IMAGE="$tc" IMAGE_TAG=local containers/build.sh "$@" 2>&1)
}
echo "without PUSH, tool-sprite is built from its checkout, once"
: >"$tmp/local"; fresh_registry
out="$(run_local sprite sprite-sheet full-stack-2d)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "tool-sprite is built once, after tools and before the first image copying it" \
	"${prefix}tools:local ${prefix}base:local ${prefix}base-wasm:local ${prefix}tool-sprite:local ${prefix}full-stack-2d:local " \
	"$(builds | cut -d' ' -f1-5) "
check_equal "exactly once" "1" "$(grep -cE -- "-t ${prefix}tool-sprite:local " "$tmp/log")"
check_contains "from the tool-sprite checkout's own Dockerfile and context" \
	"tool-sprite/Dockerfile $(cd "$HERE/.." && pwd)/containers/../tool-sprite" "$(grep -E -- "-t ${prefix}tool-sprite:local" "$tmp/log")"
check_contains "and passed as the build arg" "--build-arg TOOL_SPRITE_IMAGE=${prefix}tool-sprite:local" \
	"$(grep -E "^build .*${prefix}sprite-sheet:" "$tmp/log")"
check_equal "nothing is pulled" "" "$(pulls)"
check_lacks "and tool-paint, which none of them copies from, is not built" "tool-paint" "$(builds)"

echo "without PUSH, tool-paint is built from its checkout, once"
: >"$tmp/local"; fresh_registry
out="$(run_local ui material)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "tool-paint is built once, before the first image copying it, and tools not at all" \
	"${prefix}base:local ${prefix}tool-paint:local ${prefix}ui:local ${prefix}material:local " "$(builds)"
check_contains "from the tool-paint checkout's own Dockerfile and context" \
	"tool-paint/Dockerfile $(cd "$HERE/.." && pwd)/containers/../tool-paint" "$(grep -E -- "-t ${prefix}tool-paint:local" "$tmp/log")"
for name in ui material; do
	check_contains "and passed to $name as the build arg" "--build-arg TOOL_PAINT_IMAGE=${prefix}tool-paint:local" \
		"$(grep -E "^build .*${prefix}${name}:" "$tmp/log")"
done
check_equal "nothing is pulled" "" "$(pulls)"

echo "without PUSH, tool-voxel is built from its checkout, once"
: >"$tmp/local"; fresh_registry
out="$(run_local voxel voxel-animation)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "tool-voxel is built once, before the first image copying it, and tools not at all" \
	"${prefix}base:local ${prefix}tool-voxel:local ${prefix}voxel:local ${prefix}voxel-animation:local " "$(builds)"
check_contains "from the tool-voxel checkout's own Dockerfile and context" \
	"tool-voxel/Dockerfile $(cd "$HERE/.." && pwd)/containers/../tool-voxel" "$(grep -E -- "-t ${prefix}tool-voxel:local" "$tmp/log")"
for name in voxel voxel-animation; do
	check_contains "and passed to $name as the build arg" "--build-arg TOOL_VOXEL_IMAGE=${prefix}tool-voxel:local" \
		"$(grep -E "^build .*${prefix}${name}:" "$tmp/log")"
done
check_equal "nothing is pulled" "" "$(pulls)"

echo "without PUSH, tool-mc is built from its checkout for the image that copies from it alone"
: >"$tmp/local"; fresh_registry
out="$(run_local mc mc-skinned)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "tool-mc is built once, before the first image copying it" \
	"${prefix}base:local ${prefix}tool-mc:local ${prefix}mc:local ${prefix}mc-skinned:local " "$(builds)"
check_contains "from the tool-mc checkout" \
	"tool-mc/Dockerfile $(cd "$HERE/.." && pwd)/containers/../tool-mc" "$(grep -E -- "-t ${prefix}tool-mc:local" "$tmp/log")"

echo "without PUSH, a selection that copies from no tool image builds none"
: >"$tmp/local"
out="$(run_local base-wasm)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_lacks "and tool-sprite is not built" "tool-sprite" "$(builds)"
check_lacks "nor tool-paint" "tool-paint" "$(builds)"
check_lacks "nor tool-voxel" "tool-voxel" "$(builds)"

echo "naming tool-sprite builds just it"
: >"$tmp/local"
out="$(run_local tool-sprite)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "and only it" "${prefix}tool-sprite:local " "$(builds)"

echo "naming tool-paint builds just it"
: >"$tmp/local"
out="$(run_local tool-paint)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "and only it" "${prefix}tool-paint:local " "$(builds)"

for name in tool-voxel tool-mc tool-sn tool-dc; do
	echo "naming ${name} builds just it"
	: >"$tmp/local"
	out="$(run_local "${name}")" && status=0 || status=$?
	check_equal "the build passes" "0" "$status"
	check_equal "and only it" "${prefix}${name}:local " "$(builds)"
done

echo "TOOL_SPRITE_IMAGE wins without PUSH, and is pulled instead of built"
: >"$tmp/local"; fresh_registry
out="$(TOOL_SPRITE_IMAGE="$ts" run_local sprite)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "it is pulled" "$ts " "$(pulls)"
check_lacks "and not built" "tool-sprite:local" "$(builds)"

echo
echo "build.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
