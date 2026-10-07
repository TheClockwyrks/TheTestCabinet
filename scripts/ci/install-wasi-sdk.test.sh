#!/usr/bin/env bash
# Table test for install-wasi-sdk.sh. Run it directly:
# scripts/ci/install-wasi-sdk.test.sh
#
# A copy of the script runs in a throwaway repository whose cpp-version.sh pins
# a wasi-sdk, with a stand-in fetch.sh serving a small tarball shaped like the
# release, `ldd` stubbed to resolve the three host libraries to files made here,
# and HOME in a temporary directory. The release's compiler is a stub that
# records its arguments and writes its -o output. The subject is the pruned
# layout it installs, the libraries it vendors, the smoke compile, and that a
# complete install is left alone.
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

# A stand-in for fetch.sh: it serves each URL out of $STUB_SERVER by the URL's
# last path segment and records the URL. The real one is fetch.test.sh's subject.
fake_fetch() { # repo
	cat >"$1/scripts/ci/fetch.sh" <<'EOF2'
gg_fetch_dir() { echo "$STUB_DOWNLOADS"; }
gg_fetch() {
	echo "$1" >>"$STUB_LOG"
	mkdir -p "$(dirname "$2")"
	cp "$STUB_SERVER/${1##*/}" "$2"
}
EOF2
}

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-cpp" "$tmp/bin" "$tmp/server" "$tmp/syslib"
cp "$CI_DIR/install-wasi-sdk.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
cat >"$repo/packages/gg-sandbox-cpp/cpp-version.sh" <<'EOF2'
GG_WASI_SDK_VERSION="33.0"
GG_CPP_TARGET="wasm32-wasip1"
GG_CPP_STD="c++23"
gg_wasi_sdk_platform() { echo "x86_64-linux"; }
gg_wasi_sdk_url() { echo "https://example.com/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz"; }
GG_WASI_SDK_DEFAULT_HOME="$HOME/.local/share/tcab/gg-wasi-sdk"
EOF2

# The host libraries ldd resolves the compiler to.
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	printf 'host %s' "$soname" >"$tmp/syslib/$soname"
done
cat >"$tmp/bin/ldd" <<'STUB'
#!/usr/bin/env bash
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	[[ "$soname" == "${STUB_LDD_UNRESOLVED:-}" ]] && continue
	printf '\t%s => %s/%s (0x00007f0000000000)\n' "$soname" "$STUB_SYSLIB" "$soname"
done
[[ -n "${STUB_LDD_NOT_FOUND:-}" ]] && printf '\tlibz.so.1 => not found\n'
exit 0
STUB
chmod +x "$tmp/bin/ldd"

# The release tarball: what is kept, and what the prune leaves behind.
sdk="$tmp/build/wasi-sdk-33.0-x86_64-linux"
mkdir -p "$sdk/bin" "$sdk/lib/clang/22/include" "$sdk/share/wasi-sysroot/include/c++/v1" \
	"$sdk/share/wasi-sysroot/include/wasm32-wasip1" "$sdk/share/wasi-sysroot/include/wasm32-wasip2" \
	"$sdk/share/wasi-sysroot/lib/wasm32-wasip1/llvm-lto" "$sdk/share/wasi-sysroot/lib/wasm32-wasip1/noeh" \
	"$sdk/share/wasi-sysroot/lib/wasm32-wasip2"
cat >"$sdk/bin/clang-22" <<'STUB'
#!/usr/bin/env bash
case "$1" in --version) echo "clang version 22.1.0 (wasi-sdk)"; exit 0 ;; esac
echo "$(basename "$0") $*" >>"$STUB_LOG"
while [[ $# -gt 0 ]]; do
	[[ "$1" == -o ]] && printf 'wasm' >"$2"
	shift
done
STUB
chmod +x "$sdk/bin/clang-22"
for file in bin/lld bin/clang.cfg bin/clang++.cfg bin/llvm-objdump lib/clang/22/include/stddef.h \
	share/wasi-sysroot/include/c++/v1/vector share/wasi-sysroot/include/wasm32-wasip1/stdio.h \
	share/wasi-sysroot/include/wasm32-wasip2/stdio.h share/wasi-sysroot/lib/wasm32-wasip1/libc.a \
	share/wasi-sysroot/lib/wasm32-wasip1/llvm-lto/libc.a share/wasi-sysroot/lib/wasm32-wasip1/noeh/libc++.a \
	share/wasi-sysroot/lib/wasm32-wasip2/libc.a lib/libLLVM.so.22.1-wasi-sdk lib/libclang-cpp.so.22.1-wasi-sdk \
	lib/libedit.so.0.0.72 lib/liblldb.so.22; do
	printf 'x' >"$sdk/$file"
done
tar -C "$tmp/build" -czf "$tmp/server/wasi-sdk-33.0-x86_64-linux.tar.gz" wasi-sdk-33.0-x86_64-linux

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/calls.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u WASI_SDK_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/calls.log" STUB_SERVER="$tmp/server" \
		STUB_DOWNLOADS="$home/downloads" STUB_SYSLIB="$tmp/syslib" PATH="$tmp/bin:$PATH" "$@" \
		"$repo/scripts/ci/install-wasi-sdk.sh" 2>&1)
}

home="$tmp/home"
prefix="$home/.local/share/tcab/gg-wasi-sdk"
out="$(run "$home")"
check_equal "a fresh install succeeds" "0" "$?"
check_contains "fetches the pinned release" "https://example.com/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz" \
	"$(head -1 "$tmp/calls.log")"
for path in bin/clang-22 bin/lld bin/clang.cfg bin/clang++.cfg lib/clang/22/include/stddef.h \
	share/wasi-sysroot/include/c++/v1/vector share/wasi-sysroot/include/wasm32-wasip1/stdio.h \
	share/wasi-sysroot/lib/wasm32-wasip1/libc.a lib/libLLVM.so.22.1-wasi-sdk lib/libclang-cpp.so.22.1-wasi-sdk \
	lib/libedit.so.0.0.72; do
	check_exists "keeps $path" "$prefix/$path"
done
for path in bin/llvm-objdump share/wasi-sysroot/include/wasm32-wasip2 share/wasi-sysroot/lib/wasm32-wasip2 \
	share/wasi-sysroot/lib/wasm32-wasip1/llvm-lto share/wasi-sysroot/lib/wasm32-wasip1/noeh lib/liblldb.so.22; do
	check_absent "prunes $path" "$prefix/$path"
done
check_equal "clang is clang-22" "clang-22" "$(readlink "$prefix/bin/clang")"
check_equal "clang++ and clang-cpp are clang" "clang clang" \
	"$(readlink "$prefix/bin/clang++") $(readlink "$prefix/bin/clang-cpp")"
check_equal "wasm-ld is lld" "lld" "$(readlink "$prefix/bin/wasm-ld")"
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	check_equal "vendors the host's $soname" "host $soname" "$(cat "$prefix/lib/$soname" 2>/dev/null)"
done
compiles="$(grep '^clang' "$tmp/calls.log")"
check_contains "smoke-compiles C for the target" "clang --target=wasm32-wasip1 -Os -c" "$compiles"
check_contains "and C++ at the pinned standard, as a reactor" \
	"clang++ --target=wasm32-wasip1 -std=c++23 -Os -fwasm-exceptions" "$compiles"
check_equal "stamps the version" "33.0" "$(cat "$prefix/wasi-sdk-version")"
check_absent "and deletes the staged archive" "$home/downloads/wasi-sdk-33.0-x86_64-linux.tar.gz"
check_contains "reports the compiler" "clang version 22.1.0 (wasi-sdk)" "$out"

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "and leaves the install alone" "wasi-sdk 33.0 already installed at $prefix" "$out"
check_equal "without fetching" "" "$(cat "$tmp/calls.log")"

rm "$prefix/lib/libtinfo.so.6"
out="$(run "$home")"
check_equal "an install missing a vendored library is redone" "0" "$?"
check_contains "from the release" "wasi-sdk-33.0-x86_64-linux.tar.gz" "$(cat "$tmp/calls.log")"
check_exists "and the library is back" "$prefix/lib/libtinfo.so.6"

out="$(run "$tmp/dir-home" WASI_SDK_INSTALL_DIR="$tmp/opt/wasi-sdk")"
check_equal "WASI_SDK_INSTALL_DIR is honoured" "0" "$?"
check_exists "as the prefix" "$tmp/opt/wasi-sdk/bin/clang-22"

out="$(run "$tmp/unresolved-home" STUB_LDD_UNRESOLVED=libgcc_s.so.1)"
check_equal "a host library ldd cannot find fails" "1" "$?"
check_contains "naming it" "could not find libgcc_s.so.1 to vendor beside the wasi-sdk compiler." "$out"
check_absent "and stamps nothing" "$tmp/unresolved-home/.local/share/tcab/gg-wasi-sdk/wasi-sdk-version"

out="$(run "$tmp/notfound-home" STUB_LDD_NOT_FOUND=1)"
check_equal "a compiler with an unresolved library fails" "1" "$?"
check_contains "naming it" "libz.so.1 => not found" "$out"
check_absent "and stamps nothing" "$tmp/notfound-home/.local/share/tcab/gg-wasi-sdk/wasi-sdk-version"

echo
echo "install-wasi-sdk.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
