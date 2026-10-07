#!/usr/bin/env bash
# Table test for build.sh's REUSE_INPUTS mode, driving it through a docker stub. Run it
# directly: containers/build.test.sh
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
sprite d3 base,tools
gg-toolchains d4 -
sprite-gg d5 sprite,gg-toolchains
TABLE

reg="registry.test/ns"
prefix="test-cabinet-"
run() {
	: >"$tmp/log"
	(cd "$HERE/.." && PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_LOCAL="$tmp/local" STUB_REGISTRY="$tmp/registry" \
		STUB_PUSH_FAIL_REF="${STUB_PUSH_FAIL_REF:-}" STUB_PUSH_FAILS="$tmp/push-fails" REGISTRY_RETRY_DELAY=0 \
		DOCKER="$tmp/docker" PUSH=1 RECLAIM=1 REUSE_INPUTS="${REUSE_INPUTS:-$inputs}" \
		IMAGE_REGISTRY="$reg" IMAGE_TAG=sha1-amd64 containers/build.sh "$@" 2>&1)
}
builds() { grep -E '^build ' "$tmp/log" | grep -oE -- '-t [^ ]+' | cut -d' ' -f2 | tr '\n' ' '; }
retags() { grep -E '^buildx imagetools create' "$tmp/log" | awk '{print $5}' | tr '\n' ' '; }
pulls() { grep -E '^pull ' "$tmp/log" | awk '{print $NF}' | tr '\n' ' '; }

echo "an empty registry builds everything and pushes each image under both tags"
: >"$tmp/local"; : >"$tmp/registry"
out="$(run base sprite sprite-gg)"
check_equal "the build passes" "0" "$?"
check_equal "every image is built" \
	"${prefix}tools:sha1-amd64 ${prefix}gg-toolchains:sha1-amd64 ${prefix}base:sha1-amd64 ${prefix}sprite:sha1-amd64 ${prefix}sprite-gg:sha1-amd64 " \
	"$(builds)"
check_equal "nothing is retagged" "" "$(retags)"
for pair in tools:d1 base:d2 sprite:d3 gg-toolchains:d4 sprite-gg:d5; do
	name="${pair%%:*}"; digest="${pair##*:}"
	check_contains "$name is pushed under its inputs tag" "${reg}/${prefix}${name}:inputs-${digest}-amd64" "$(cat "$tmp/registry")"
done
check_lacks "tools gets no commit tag" "${reg}/${prefix}tools:sha1-amd64" "$(cat "$tmp/registry")"
check_contains "sprite-gg gets the commit tag" "${reg}/${prefix}sprite-gg:sha1-amd64" "$(cat "$tmp/registry")"
check_contains "and its reference line" "==> sprite-gg reference: ${reg}/${prefix}sprite-gg@sha256:pushed-sha1-amd64" "$out"
# The reclaim has to take the inputs tag with the others: a tag left on an image keeps
# every one of its layers, and `docker image rm` of another tag exits 0 regardless.
for name in sprite sprite-gg; do
	check_equal "the reclaimed $name has no tag left in the local store" "" "$(grep -F "${prefix}${name}:" "$tmp/local" | tr '\n' ' ')"
done
for name in tools gg-toolchains base; do
	check_contains "$name, which the reclaim keeps, is still local" "${prefix}${name}:sha1-amd64" "$(cat "$tmp/local")"
done
check_lacks "and no reclaim is reported as failed" "NOT reclaimed" "$out"

echo "a registry holding every inputs tag builds nothing"
: >"$tmp/local"
out="$(run base sprite sprite-gg)"
check_equal "the build passes" "0" "$?"
check_equal "nothing is built" "" "$(builds)"
check_equal "nothing is pulled" "" "$(pulls)"
check_equal "every image but tools is retagged for the commit" \
	"${reg}/${prefix}gg-toolchains:sha1-amd64 ${reg}/${prefix}base:sha1-amd64 ${reg}/${prefix}sprite:sha1-amd64 ${reg}/${prefix}sprite-gg:sha1-amd64 " \
	"$(retags)"
check_contains "and says so" "==> reusing ${prefix}sprite-gg:sha1-amd64: its inputs are unchanged" "$out"
check_contains "with the reference line a build prints" "==> sprite-gg reference: ${reg}/${prefix}sprite-gg@sha256:manifest-sha1-amd64" "$out"
check_equal "gg-toolchains is retagged once, though two rules reach it" "1" "$(grep -c 'imagetools create --tag registry.test/ns/test-cabinet-gg-toolchains:sha1-amd64' "$tmp/log")"

echo "a changed child pulls its reused parents and builds"
: >"$tmp/local"
sed -i 's/^sprite-gg d5 /sprite-gg d6 /' "$inputs"
out="$(run base sprite sprite-gg)"
check_equal "the build passes" "0" "$?"
check_equal "only the child is built" "${prefix}sprite-gg:sha1-amd64 " "$(builds)"
check_equal "its parents are pulled from their inputs tags" \
	"${reg}/${prefix}sprite:inputs-d3-amd64 ${reg}/${prefix}gg-toolchains:inputs-d4-amd64 " "$(pulls)"
check_contains "the child is pushed under its new inputs tag" "${reg}/${prefix}sprite-gg:inputs-d6-amd64" "$(cat "$tmp/registry")"
check_contains "sprite is retagged, not built" "${reg}/${prefix}sprite:sha1-amd64" "$(retags)"

echo "a changed parent rebuilds what is below it, from the pulled builder"
: >"$tmp/local"
sed -i 's/^base d2 /base d7 /; s/^sprite d3 /sprite d8 /; s/^sprite-gg d6 /sprite-gg d9 /' "$inputs"
out="$(run base sprite sprite-gg)"
check_equal "the build passes" "0" "$?"
check_equal "base, sprite and the variant are built" \
	"${prefix}base:sha1-amd64 ${prefix}sprite:sha1-amd64 ${prefix}sprite-gg:sha1-amd64 " "$(builds)"
check_equal "tools and gg-toolchains are pulled" \
	"${reg}/${prefix}tools:inputs-d1-amd64 ${reg}/${prefix}gg-toolchains:inputs-d4-amd64 " "$(pulls)"

echo "one variant selected alone reuses its whole parent chain without a pull"
: >"$tmp/local"
out="$(run sprite-gg)"
check_equal "the build passes" "0" "$?"
check_equal "nothing is built" "" "$(builds)"
check_equal "nothing is pulled" "" "$(pulls)"
check_equal "the variant and its parent chain are retagged (base too: the rule that wants it present reaches it)" \
	"${reg}/${prefix}gg-toolchains:sha1-amd64 ${reg}/${prefix}base:sha1-amd64 ${reg}/${prefix}sprite:sha1-amd64 ${reg}/${prefix}sprite-gg:sha1-amd64 " \
	"$(retags)"

echo "a table that names a parent it does not list is refused"
grep -v '^sprite ' "$inputs" >"$tmp/inputs2"
# `$?` of a failed substitution is what the check wants, and `set -e` would end the script
# on it first, so the status is taken on the same line.
out="$(REUSE_INPUTS="$tmp/inputs2" run sprite-gg)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says which" "sprite-gg is built from sprite, which the table does not list" "$out"
check_equal "before anything is built" "" "$(builds)"

echo "a push the registry refuses for a moment is retried, and the build passes"
: >"$tmp/local"; : >"$tmp/registry"
variant="${reg}/${prefix}sprite-gg:sha1-amd64"
pushes_of() { grep -cxF "push $1" "$tmp/log" || true; }
echo 2 >"$tmp/push-fails"
out="$(STUB_PUSH_FAIL_REF="$variant" run base sprite sprite-gg)" && status=0 || status=$?
check_equal "the build passes" "0" "$status"
check_equal "the refused push is tried three times" "3" "$(pushes_of "$variant")"
check_contains "and each retry is reported" "attempt 2 of 4); retrying" "$out"
check_contains "the commit tag is in the registry" "$variant" "$(cat "$tmp/registry")"
check_contains "with its reference line" "==> sprite-gg reference: ${reg}/${prefix}sprite-gg@sha256:pushed-sha1-amd64" "$out"

# The failure this guards against: a push inside `$(push_and_pin ...)` ran without `set -e`,
# so a refused push was followed by the inputs tag, a reference line, a reclaim and exit 0,
# and the commit's tag was only found missing when the architectures were fused.
echo "a push the registry keeps refusing ends the build there"
: >"$tmp/local"; : >"$tmp/registry"
echo 99 >"$tmp/push-fails"
out="$(STUB_PUSH_FAIL_REF="$variant" run base sprite sprite-gg)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_equal "after every attempt" "4" "$(pushes_of "$variant")"
check_contains "and says it gave up" "failed 4 time(s), exiting 1; giving up" "$out"
check_lacks "no commit tag reached the registry" "$variant" "$(cat "$tmp/registry")"
check_lacks "no inputs tag was pushed for it" "${reg}/${prefix}sprite-gg:inputs-" "$(cat "$tmp/registry")"
check_lacks "no reference line was printed for it" "==> sprite-gg reference:" "$out"
check_lacks "and it was not reclaimed" "reclaiming ${prefix}sprite-gg:" "$out"

echo "a retry count that is not a positive integer is refused"
out="$(REGISTRY_ATTEMPTS=0 run base 2>&1)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says why" "REGISTRY_ATTEMPTS must be a positive integer" "$out"

echo "REUSE_INPUTS without PUSH is refused"
out="$(cd "$HERE/.." && PATH="$tmp/bin:$PATH" DOCKER="$tmp/docker" STUB_LOG="$tmp/log" STUB_LOCAL="$tmp/local" STUB_REGISTRY="$tmp/registry" REUSE_INPUTS="$inputs" containers/build.sh base 2>&1)" && status=0 || status=$?
check_equal "with exit 1" "1" "$status"
check_contains "and says why" "REUSE_INPUTS needs PUSH=1" "$out"

echo
echo "build.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
