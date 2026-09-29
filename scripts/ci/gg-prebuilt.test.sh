#!/usr/bin/env bash
# Table test for gg-prebuilt.sh. Run it directly: scripts/ci/gg-prebuilt.test.sh
#
# A copy of the script runs in a throwaway repository with `uname` stubbed to the
# machine the case declares, against a fake `gg-<arch>` artifact: a small `gg`
# answering --version and a `gg-reference.tar.gz` the case builds. The subject is
# the staged `gg-build` context (`gg` and `gg-reference/`, readable by anyone),
# and that every defect in the artifact fails before anything could be built.
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

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/gg-prebuilt.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/bin/uname"

# An artifact directory as gg_<arch> publishes it: the binary for <target>, and a
# reference tarball holding gg-reference/ with the index (unless told otherwise).
artifact() { # dir target [no-index]
	local dir="$1" target="$2"
	rm -rf "$dir"
	mkdir -p "$dir" "$tmp/ref/gg-reference"
	rm -rf "$tmp/ref/gg-reference"/*
	printf '#!/usr/bin/env bash\necho "gg 0.7.0"\n' >"$dir/gg-${target}"
	# A download does not reliably keep the executable bit.
	chmod 0644 "$dir/gg-${target}"
	[[ "${3:-}" == no-index ]] || echo '{"languages":[]}' >"$tmp/ref/gg-reference/index.json"
	echo '{}' >"$tmp/ref/gg-reference/rust.json"
	tar -czf "$dir/gg-reference.tar.gz" -C "$tmp/ref" gg-reference
}

run() { # args...
	(cd "$tmp" && PATH="$repo/bin:$PATH" "$repo/scripts/ci/gg-prebuilt.sh" "$@" 2>&1)
}

artifact "$tmp/gg-amd64" x86_64-unknown-linux-musl
out="$(run "$tmp/gg-amd64" "$tmp/stage")"
check_equal "an x86_64 artifact stages" "0" "$?"
check_contains "after running the binary on this agent" "gg 0.7.0" "$out"
check_equal "as the gg-build context: gg and gg-reference/" "gg
gg-reference" "$(ls "$tmp/stage")"
check_equal "the binary is the artifact's" \
	"$(cat "$tmp/gg-amd64/gg-x86_64-unknown-linux-musl")" "$(cat "$tmp/stage/gg")"
check_equal "and executable" "0755" "$(stat -c %a "$tmp/stage/gg" | sed 's/^/0/')"
check_equal "the documents are the tarball's" "index.json
rust.json" "$(ls "$tmp/stage/gg-reference")"
check_equal "readable by anyone" "644" "$(stat -c %a "$tmp/stage/gg-reference/rust.json")"
check_contains "and it prints the digest gg-dist.sh printed" \
	"$(sha256sum "$tmp/stage/gg" | cut -d' ' -f1)" "$out"

touch "$tmp/stage/leftover"
out="$(run "$tmp/gg-amd64" "$tmp/stage")"
check_equal "a second call succeeds" "0" "$?"
check_absent "and empties the context first" "$tmp/stage/leftover"

artifact "$tmp/gg-arm64" aarch64-unknown-linux-musl
out="$(STUB_UNAME_M=aarch64 run "$tmp/gg-arm64" "$tmp/stage-arm")"
check_equal "an aarch64 artifact stages on an aarch64 agent" "0" "$?"
check_exists "with its binary" "$tmp/stage-arm/gg"

out="$(STUB_UNAME_M=aarch64 run "$tmp/gg-amd64" "$tmp/stage-wrong")"
check_equal "the other architecture's artifact fails" "1" "$?"
check_contains "naming the binary it lacks" "gg-aarch64-unknown-linux-musl is missing" "$out"

rm "$tmp/gg-amd64/gg-reference.tar.gz"
out="$(run "$tmp/gg-amd64" "$tmp/stage")"
check_equal "an artifact without the tarball fails" "1" "$?"
check_contains "naming it" "gg-reference.tar.gz is missing" "$out"

artifact "$tmp/gg-amd64" x86_64-unknown-linux-musl no-index
out="$(run "$tmp/gg-amd64" "$tmp/stage")"
check_equal "a tarball without the index fails" "1" "$?"
check_contains "naming it" "index.json is missing or empty" "$out"

artifact "$tmp/gg-amd64" x86_64-unknown-linux-musl
printf '#!/usr/bin/env bash\nexit 139\n' >"$tmp/gg-amd64/gg-x86_64-unknown-linux-musl"
out="$(run "$tmp/gg-amd64" "$tmp/stage")"
check_equal "a binary that cannot run fails" "139" "$?"

out="$(run "$tmp/absent" "$tmp/stage")"
check_equal "a missing artifact directory fails" "1" "$?"
check_contains "naming it" "artifact directory '$tmp/absent' does not exist" "$out"

mkdir -p "$repo/keep"
out="$(run "$tmp/gg-amd64" keep)"
check_equal "a relative output directory is refused" "1" "$?"
check_contains "saying why" "'keep' is not an absolute path" "$out"
check_exists "and nothing in the checkout is removed" "$repo/keep"

out="$(run "$tmp/gg-amd64" /)"
check_equal "the filesystem root is refused" "1" "$?"
check_contains "saying so" "refusing to stage into '/'" "$out"

out="$(run "$tmp/gg-amd64")"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/gg-prebuilt.sh <artifact-dir> <out-dir>" "$out"

echo
echo "gg-prebuilt.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
