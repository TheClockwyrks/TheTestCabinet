#!/usr/bin/env bash
# Table test for install-rust-wasm.sh. Run it directly:
# scripts/ci/install-rust-wasm.test.sh
#
# A copy of the script runs in a throwaway repository whose rust-version.sh
# names a release and a target, with `rustc` and `rustup` stubbed first on PATH.
# The rustc stub prints a target libdir under the temporary directory, which
# exists only once the rustup stub has "installed" it. The subject is that the
# answer comes from the disk rather than from rustc, and each refusal.
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
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-rust" "$tmp/bin" "$tmp/no-rustup"
cp "$CI_DIR/install-rust-wasm.sh" "$repo/scripts/ci/"
cat >"$repo/packages/gg-sandbox-rust/rust-version.sh" <<'EOF2'
GG_RUST_VERSION="1.97.1"
GG_RUST_TARGET="wasm32-wasip1"
export GG_RUST_VERSION GG_RUST_TARGET
EOF2
cat >"$tmp/bin/rustc" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == "--print target-libdir --target wasm32-wasip1" ]] || exit 1
echo "$STUB_LIBDIR"
STUB
cat >"$tmp/bin/rustup" <<'STUB'
#!/usr/bin/env bash
echo "rustup $*" >>"$STUB_LOG"
[[ -n "${STUB_RUSTUP_CREATES:-}" ]] && mkdir -p "$STUB_LIBDIR"
exit 0
STUB
chmod +x "$tmp/bin/rustc" "$tmp/bin/rustup"
ln -s "$tmp/bin/rustc" "$tmp/no-rustup/rustc"

run() { # libdir bin-dir
	: >"$tmp/rustup.log"
	(STUB_LOG="$tmp/rustup.log" STUB_LIBDIR="$1" PATH="$2:/usr/bin:/bin" \
		"$repo/scripts/ci/install-rust-wasm.sh" 2>&1)
}

mkdir -p "$tmp/present/lib"
out="$(run "$tmp/present/lib" "$tmp/bin")"
check_equal "a standard library on disk succeeds" "0" "$?"
check_contains "and says so" "rustc already has the wasm32-wasip1 standard library" "$out"
check_equal "without rustup" "" "$(cat "$tmp/rustup.log")"

out="$(STUB_RUSTUP_CREATES=1 run "$tmp/installed/lib" "$tmp/bin")"
check_equal "a missing one is installed" "0" "$?"
check_equal "for the pinned release, by rustup" \
	"rustup target add --toolchain 1.97.1 wasm32-wasip1" "$(cat "$tmp/rustup.log")"
check_exists "where rustc looks" "$tmp/installed/lib"

out="$(run "$tmp/elsewhere/lib" "$tmp/bin")"
check_equal "an install rustc still cannot see fails" "1" "$?"
check_contains "naming the toolchain to check" "the active toolchain is not 1.97.1" "$out"

if PATH=/usr/bin:/bin command -v rustup >/dev/null 2>&1; then
	echo "  skip a missing library and no rustup: this machine has rustup in /usr/bin"
else
	out="$(run "$tmp/absent/lib" "$tmp/no-rustup")"
	check_equal "a missing library and no rustup fails" "1" "$?"
	check_contains "saying so" "the wasm32-wasip1 standard library is missing and rustup is not installed." "$out"
fi

echo
echo "install-rust-wasm.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
