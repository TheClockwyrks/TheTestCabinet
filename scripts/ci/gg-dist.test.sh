#!/usr/bin/env bash
# Table test for gg-dist.sh. Run it directly: scripts/ci/gg-dist.test.sh
#
# A copy of the script runs in a throwaway repository whose
# scripts/build-gg-static.sh is a stub that writes a small `gg` answering
# --version and `reference --out`, with `uname` stubbed to the machine the case
# declares. The subject is what lands in the output directory on each
# architecture: the binary named for its target and the reference tarball, on
# both, since each architecture's backend image bakes the documents.
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

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/gg-dist.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/scripts/build-gg-static.sh" <<'STUB'
#!/usr/bin/env bash
echo "build $1" >>"$STUB_LOG"
cat >"$1" <<'GG'
#!/usr/bin/env bash
case "$1" in
	--version) echo "gg 0.7.0" ;;
	reference) mkdir -p "$3" && echo "# the reference" >"$3/index.md" ;;
esac
GG
chmod +x "$1"
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "$STUB_UNAME_M"
STUB
chmod +x "$repo/scripts/build-gg-static.sh" "$repo/bin/uname"

run() { # machine args...
	local machine="$1"
	shift
	: >"$tmp/calls.log"
	(cd "$tmp" && STUB_LOG="$tmp/calls.log" STUB_UNAME_M="$machine" PATH="$repo/bin:$PATH" \
		"$repo/scripts/ci/gg-dist.sh" "$@" 2>&1)
}

out="$(run x86_64 "$tmp/dist-x86")"
check_equal "an x86_64 build succeeds" "0" "$?"
check_equal "builds the static gg for its musl target" \
	"build $tmp/dist-x86/gg-x86_64-unknown-linux-musl" "$(cat "$tmp/calls.log")"
check_contains "and runs it" "gg 0.7.0" "$out"
check_equal "writes the binary and the reference tarball, nothing else" \
	"gg-reference.tar.gz
gg-x86_64-unknown-linux-musl" "$(ls "$tmp/dist-x86")"
check_equal "the tarball holds the reference under gg-reference/" \
	"gg-reference/
gg-reference/index.md" "$(tar -tzf "$tmp/dist-x86/gg-reference.tar.gz" | sort)"

out="$(run aarch64 "$tmp/dist-arm")"
check_equal "an aarch64 build succeeds" "0" "$?"
check_equal "writes the binary and the reference tarball there too" \
	"gg-aarch64-unknown-linux-musl
gg-reference.tar.gz" "$(ls "$tmp/dist-arm")"
check_equal "whose tarball holds the same reference" \
	"gg-reference/
gg-reference/index.md" "$(tar -tzf "$tmp/dist-arm/gg-reference.tar.gz" | sort)"
check_contains "and prints the binary's digest, which gg-prebuilt.sh prints on the consuming side" \
	"$(sha256sum "$tmp/dist-arm/gg-aarch64-unknown-linux-musl" | cut -d' ' -f1)" "$out"

out="$(cd "$tmp" && run x86_64 relative/out)"
check_equal "a relative output directory succeeds" "0" "$?"
check_equal "and resolves against the repository root, where every CI script runs" \
	"build $repo/relative/out/gg-x86_64-unknown-linux-musl" "$(cat "$tmp/calls.log")"

out="$(run x86_64)"
check_equal "no output directory is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/gg-dist.sh <out-dir>" "$out"
check_equal "and builds nothing" "" "$(cat "$tmp/calls.log")"

echo
echo "gg-dist.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
