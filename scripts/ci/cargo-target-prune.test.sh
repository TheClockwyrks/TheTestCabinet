#!/usr/bin/env bash
# Table test for cargo-target-prune.sh. Run it directly:
# scripts/ci/cargo-target-prune.test.sh
#
# A copy of the script runs in a throwaway repository whose target/ holds a
# small tree shaped like cargo's: linked binaries (Linux, and Windows .exe/.pdb)
# beside the libraries, dep-info and build-script outputs a cache must keep.
# The subject is exactly which files go.
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

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/cargo-target-prune.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	printf '%s' "$repo"
}
touch_all() { # root paths...
	local root="$1" path
	shift
	for path in "$@"; do
		mkdir -p "$(dirname "$root/$path")"
		printf 'x' >"$root/$path"
	done
}
run() { (cd "$tmp" && "$1/scripts/ci/cargo-target-prune.sh" 2>&1); }

readonly GONE=(
	target/debug/deps/test_cabinet_core-0123abcd
	target/debug/deps/gg-4567ef01
	target/debug/tcab
	target/debug/examples/demo
	target/debug/examples/demo-89ab
	target/release/tcab
	target/release/deps/tcab-cdef0123
	target/release/tcab.exe
	target/release/tcab.pdb
	target/release/deps/tcab-cdef0123.exe
	target/release/deps/tcab-cdef0123.pdb
)
readonly KEPT=(
	target/debug/deps/libserde-0123abcd.rlib
	target/debug/deps/libserde-0123abcd.rmeta
	target/debug/deps/libserde_derive-4567.so
	target/debug/deps/serde_derive-4567.dll
	target/debug/deps/test_cabinet_core-0123abcd.d
	target/debug/tcab.d
	target/debug/build/ring-0123/out/libring.a
	target/debug/build/ring-0123/build-script-build
	target/debug/.fingerprint/core-0123/lib-core
	target/debug/incremental/core-0123/s-abc/dep-graph
	target/CACHEDIR.TAG
	target/doc/index.html
	target/doc/LICENSE
	target/nextest/ci/junit
)

repo="$(fresh_repo)"
touch_all "$repo" "${GONE[@]}" "${KEPT[@]}"
out="$(run "$repo")"
check_equal "a pruned tree succeeds" "0" "$?"
for path in "${GONE[@]}"; do
	check_absent "removes $path" "$repo/$path"
done
for path in "${KEPT[@]}"; do
	check_exists "keeps $path" "$repo/$path"
done
check_contains "reports the size before" "target before prune" "$out"
check_contains "and after" "target after prune" "$out"

repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "no target/ is not an error" "0" "$?"
check_contains "and says there is nothing to prune" "no target/ to prune" "$out"

repo="$(fresh_repo)"
touch_all "$repo" target/debug/deps/tcab-0123
mkdir -p "$tmp/elsewhere/debug/deps"
printf 'x' >"$tmp/elsewhere/debug/deps/tcab-0123"
out="$(cd "$tmp" && CARGO_TARGET_DIR="$tmp/elsewhere" "$repo/scripts/ci/cargo-target-prune.sh" 2>&1)"
check_absent "prunes the literal target/ the cache saves" "$repo/target/debug/deps/tcab-0123"
check_exists "whatever CARGO_TARGET_DIR says" "$tmp/elsewhere/debug/deps/tcab-0123"

echo
echo "cargo-target-prune.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
