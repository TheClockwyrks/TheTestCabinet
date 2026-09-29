#!/usr/bin/env bash
# Table test for publish-gg.sh. Run it directly: scripts/ci/publish-gg.test.sh
#
# A copy of the script and of the version gate it runs sit in a throwaway
# repository with `az` and `curl` stubbed first on PATH, each recording its
# arguments; nothing reaches Azure. The dist directory holds stand-ins for the
# three objects, the x86_64 one a small `gg` reporting the version the case
# declares. The subject is the blob names, that each upload is read back, and
# that a missing object or a version the tag disagrees with uploads nothing.
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

readonly URL="https://testcabinetartifacts.blob.core.windows.net/gg-releases"
readonly OBJECTS="gg-x86_64-unknown-linux-musl gg-aarch64-unknown-linux-musl gg-reference.tar.gz"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/publish-gg.sh" "$CI_DIR/gg-version-gate.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
for tool in az curl; do
	cat >"$repo/bin/$tool" <<STUB
#!/usr/bin/env bash
echo "$tool \$*" >>"\$STUB_LOG"
[[ "$tool" == curl ]] && exit "\${STUB_CURL_EXIT:-0}"
exit 0
STUB
	chmod +x "$repo/bin/$tool"
done

fresh_dist() { # version [objects...]
	local dist version="$1" object
	dist="$(mktemp -d "$tmp/distXXXXXX")"
	shift
	for object in "$@"; do
		printf 'bytes\n' >"$dist/$object"
	done
	if [ -e "$dist/gg-x86_64-unknown-linux-musl" ]; then
		printf '#!/usr/bin/env bash\necho "gg %s"\n' "$version" >"$dist/gg-x86_64-unknown-linux-musl"
		chmod 644 "$dist/gg-x86_64-unknown-linux-musl"
	fi
	printf '%s' "$dist"
}
run() {
	: >"$tmp/calls.log"
	(cd "$tmp" && STUB_LOG="$tmp/calls.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/publish-gg.sh" "$@" 2>&1)
}

# shellcheck disable=SC2086 # the object list is split on purpose
dist="$(fresh_dist 0.7.0 $OBJECTS)"
out="$(run "$dist" refs/tags/v0.7.0)"
check_equal "a tag whose version gg reports publishes" "0" "$?"
expected=""
for object in $OBJECTS; do
	expected+="az storage blob upload --auth-mode login --account-name testcabinetartifacts --container-name gg-releases --name v0.7.0/$object --file $dist/$object --content-type application/octet-stream --overwrite --only-show-errors
curl --fail --silent --show-error --head --output /dev/null $URL/v0.7.0/$object
"
done
check_equal "uploads each object under v<version>/ and reads it back anonymously" \
	"${expected%$'\n'}" "$(cat "$tmp/calls.log")"
for object in $OBJECTS; do
	check_contains "prints the URL of $object" "$URL/v0.7.0/$object" "$out"
done
check_equal "the probe is made executable" "755" "$(stat -c %a "$dist/gg-x86_64-unknown-linux-musl")"

out="$(run "$dist" refs/heads/master)"
check_equal "a branch publishes under the version gg reports" "0" "$?"
check_contains "which names the blobs" "--name v0.7.0/gg-reference.tar.gz" "$(cat "$tmp/calls.log")"

out="$(run "$dist" refs/tags/v0.7.1)"
check_equal "a tag gg does not report fails" "1" "$?"
check_contains "through the version gate" "gg reports version '0.7.0' but the tag is 'v0.7.1'." "$out"
check_equal "and uploads nothing" "" "$(cat "$tmp/calls.log")"

for missing in $OBJECTS; do
	# shellcheck disable=SC2086 # the object list is split on purpose
	dist="$(fresh_dist 0.7.0 ${OBJECTS/$missing/})"
	out="$(run "$dist" refs/tags/v0.7.0)"
	check_equal "a dist without $missing fails" "1" "$?"
	check_contains "naming it" "$dist/$missing is missing" "$out"
	check_equal "and uploads nothing ($missing missing)" "" "$(cat "$tmp/calls.log")"
done

# shellcheck disable=SC2086 # the object list is split on purpose
dist="$(fresh_dist 0.7.0 $OBJECTS)"
out="$(STUB_CURL_EXIT=22 run "$dist" refs/tags/v0.7.0)"
check_equal "an upload that cannot be read back anonymously fails" "22" "$?"
check_equal "at the first object" "2" "$(grep -c . "$tmp/calls.log")"

out="$(run "$dist")"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/publish-gg.sh <dist-dir> <ref>" "$out"

echo
echo "publish-gg.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
