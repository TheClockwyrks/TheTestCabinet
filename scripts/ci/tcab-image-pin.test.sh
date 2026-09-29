#!/usr/bin/env bash
# Table test for scripts/ci/tcab-image-pin.sh, against fixture files in a
# temporary tree: the check passing and failing, the write, and the refusals.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT="$here/tcab-image-pin.sh"
readonly REPO="testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

# A tree holding the script, a tags file naming $1 and a jobs file pinning $2.
fixture() {
	local dir="$work/$1"
	mkdir -p "$dir/scripts/ci" "$dir/ci/images" "$dir/.azure/project"
	cp "$SCRIPT" "$dir/scripts/ci/"
	printf 'variables:\n  rustImageTag: %s\n  webImageTag: v1-bbbbbbbbbbbb\n' "$2" >"$dir/ci/images/tags.yml"
	cat >"$dir/.azure/project/jobs.yml" <<-EOF
		# a header the script leaves alone
		parameters:
		  - name: arm64Pool
		    type: string
		    default: some-pool
		  # the image
		  - name: rustImage
		    type: string
		    default: $3
		  - name: architectures
		    type: string
		    default: amd64,arm64

		jobs: []
	EOF
	echo "$dir"
}

run() { # dir args... ; sets out and status
	local dir="$1"
	shift
	status=0
	out="$("$dir/scripts/ci/tcab-image-pin.sh" "$@" 2>&1)" || status=$?
}

# 1. Equal: the check passes and the write changes nothing.
dir="$(fixture equal v1-aaaaaaaaaaaa "$REPO:v1-aaaaaaaaaaaa")"
before="$(cat "$dir/.azure/project/jobs.yml")"
run "$dir" --check
[[ "$status" -eq 0 ]] || fail "equal: --check exited $status: $out"
run "$dir"
[[ "$status" -eq 0 ]] || fail "equal: write exited $status: $out"
[[ "$(cat "$dir/.azure/project/jobs.yml")" == "$before" ]] || fail "equal: the write changed the file"

# 2. Stale: the check fails naming both values and leaves the file alone.
dir="$(fixture stale v1-cccccccccccc "$REPO:v1-aaaaaaaaaaaa")"
before="$(cat "$dir/.azure/project/jobs.yml")"
run "$dir" --check
[[ "$status" -eq 1 ]] || fail "stale: --check exited $status, wanted 1"
[[ "$out" == *"$REPO:v1-aaaaaaaaaaaa"* ]] || fail "stale: --check does not name the pinned value: $out"
[[ "$out" == *"$REPO:v1-cccccccccccc"* ]] || fail "stale: --check does not name the wanted value: $out"
[[ "$(cat "$dir/.azure/project/jobs.yml")" == "$before" ]] || fail "stale: --check changed the file"

# 3. The write fixes exactly the rustImage default, and the check then passes.
run "$dir"
[[ "$status" -eq 0 ]] || fail "write: exited $status: $out"
after="$(cat "$dir/.azure/project/jobs.yml")"
expected="${before//"$REPO:v1-aaaaaaaaaaaa"/"$REPO:v1-cccccccccccc"}"
[[ "$after" == "$expected" ]] || fail "write: the file is not the old one with the pin replaced:
$after"
grep -q '^    default: some-pool$' "$dir/.azure/project/jobs.yml" || fail "write: touched another parameter"
run "$dir" --check
[[ "$status" -eq 0 ]] || fail "write: --check after the write exited $status: $out"

# 4. A tags file without the Rust tag is refused, naming the command that writes it.
dir="$(fixture notag "" "$REPO:v1-aaaaaaaaaaaa")"
printf 'variables:\n  webImageTag: v1-bbbbbbbbbbbb\n' >"$dir/ci/images/tags.yml"
run "$dir" --check
[[ "$status" -eq 1 ]] || fail "no tag: exited $status, wanted 1"
[[ "$out" == *"ci-image.sh tag"* ]] || fail "no tag: does not name ci-image.sh tag: $out"

# 5. A jobs file without the parameter is refused.
dir="$(fixture noparam v1-aaaaaaaaaaaa "$REPO:v1-aaaaaaaaaaaa")"
printf 'jobs: []\n' >"$dir/.azure/project/jobs.yml"
run "$dir"
[[ "$status" -eq 1 ]] || fail "no parameter: exited $status, wanted 1"
[[ "$out" == *"rustImage"* ]] || fail "no parameter: does not name rustImage: $out"

# 6. An unknown argument is a usage error.
run "$dir" --write
[[ "$status" -eq 2 ]] || fail "usage: exited $status, wanted 2"

if [[ "$failures" -ne 0 ]]; then
	echo "tcab-image-pin.test.sh: $failures failure(s)" >&2
	exit 1
fi
echo "tcab-image-pin.test.sh: all cases passed"
