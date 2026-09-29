#!/usr/bin/env bash
# Table test for install-swift.sh. Run it directly: scripts/ci/install-swift.test.sh
#
# A copy of the script runs in a throwaway repository whose swift-version.sh pins
# a toolchain and a WebAssembly SDK, with a stand-in fetch.sh serving small
# tarballs shaped like the releases, a Debian package index and one package per
# vendored library, all built here. `ar`, `readelf` and `ldd` are stubbed: a .deb
# names the data tarball `ar` unpacks, readelf reads each file's NEEDED entries
# from a `<file>.needed` beside it, and ldd reports a missing library only when
# the case asks. The release's compilers record their arguments and write their
# -o output. The subject is the pruned toolchain (the shared-library closure of
# the kept binaries and nothing more), the SDK parts, the vendored libraries, the
# smoke builds, and that a complete install is left alone.
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
# A .deb here is a file naming the data tarball it carries, and `ar` is a stub
# whose `x` puts that tarball in the working directory as data.tar.gz.
stub_ar() { # bin-dir
	cat >"$1/ar" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == x ]] || exit 1
cp "$(cat "$2")" data.tar.gz
STUB
	chmod +x "$1/ar"
}

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-swift" "$tmp/bin" "$tmp/server"
cp "$CI_DIR/install-swift.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
stub_ar "$tmp/bin"
cat >"$repo/packages/gg-sandbox-swift/swift-version.sh" <<'EOF2'
GG_SWIFT_VERSION="6.3.3"
GG_SWIFT_WASM_SDK_VERSION="$GG_SWIFT_VERSION"
GG_SWIFT_TARGET="wasm32-unknown-wasip1"
gg_swift_platform() {
	case "$(uname -m)" in
	x86_64) echo "debian12" ;;
	aarch64) echo "debian12-aarch64" ;;
	*) echo "error: no pinned Swift build for $(uname -m)." >&2; return 1 ;;
	esac
}
gg_swift_toolchain_url() { echo "https://example.com/swift/swift-6.3.3-RELEASE-$(gg_swift_platform).tar.gz"; }
gg_swift_wasm_sdk_url() { echo "https://example.com/swift/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz"; }
GG_SWIFT_DEFAULT_HOME="$HOME/.local/share/tcab/gg-swift"
EOF2
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
cat >"$tmp/bin/readelf" <<'STUB'
#!/usr/bin/env bash
[[ -f "$2.needed" ]] || exit 0
for name in $(cat "$2.needed"); do
	printf ' 0x0000000000000001 (NEEDED)             Shared library: [%s]\n' "$name"
done
STUB
cat >"$tmp/bin/ldd" <<'STUB'
#!/usr/bin/env bash
[[ -n "${STUB_LDD_NOT_FOUND:-}" ]] && printf '\tlibedit.so.2 => not found\n'
exit 0
STUB
chmod +x "$tmp/bin/uname" "$tmp/bin/readelf" "$tmp/bin/ldd"

# The toolchain: five kept binaries and one that is not; libraries the binaries
# need (transitively, with a cycle), one nothing needs, and clang's headers.
compiler() { # path
	cat >"$1" <<'STUB'
#!/usr/bin/env bash
echo "$(basename "$0") $*" >>"$STUB_LOG"
while [[ $# -gt 0 ]]; do
	[[ "$1" == -o ]] && printf 'out' >"$2"
	shift
done
STUB
	chmod +x "$1"
}
for platform in debian12 debian12-aarch64; do
	tc="$tmp/build/$platform/swift-6.3.3-RELEASE-$platform/usr"
	mkdir -p "$tc/bin" "$tc/lib/swift/linux" "$tc/lib/swift/host/compiler" "$tc/lib/clang/21/include"
	compiler "$tc/bin/swift-driver"
	compiler "$tc/bin/clang-21"
	for file in bin/swift-frontend bin/lld bin/swift-autolink-extract bin/sourcekit-lsp \
		lib/swift/linux/libswiftCore.so lib/swift/linux/libFoundation.so lib/swift/host/libSwiftSyntax.so \
		lib/swift/host/compiler/libSwiftCompilerPlugin.so lib/clang/21/include/stdint.h; do
		printf 'x' >"$tc/$file"
	done
	echo "libswiftCore.so libc.so.6" >"$tc/bin/swift-driver.needed"
	echo "libSwiftSyntax.so libswiftCore.so libstdc++.so.6" >"$tc/bin/swift-frontend.needed"
	echo "libSwiftCompilerPlugin.so" >"$tc/lib/swift/host/libSwiftSyntax.so.needed"
	echo "libSwiftSyntax.so" >"$tc/lib/swift/host/compiler/libSwiftCompilerPlugin.so.needed"
	tar -C "$tmp/build/$platform" -czf "$tmp/server/swift-6.3.3-RELEASE-$platform.tar.gz" "swift-6.3.3-RELEASE-$platform"
done

# The WebAssembly SDK bundle, with its target variant three levels down.
wasm_sdk() { # target
	local b="$tmp/build/wasm/swift-6.3.3-RELEASE_wasm.artifactbundle/swift-6.3.3-RELEASE_wasm/$1"
	rm -rf "$tmp/build/wasm"
	mkdir -p "$b/WASI.sdk/usr/include" "$b/swift.xctoolchain/usr/lib/swift_static/wasi" \
		"$b/swift.xctoolchain/usr/lib/clang/21" "$b/swift.xctoolchain/usr/lib/swift/wasi"
	printf 'x' >"$b/WASI.sdk/usr/include/stdio.h"
	printf 'x' >"$b/swift.xctoolchain/usr/lib/swift_static/wasi/libswiftCore.a"
	printf 'x' >"$b/swift.xctoolchain/usr/lib/clang/21/libclang_rt.a"
	printf 'x' >"$b/swift.xctoolchain/usr/lib/swift/wasi/libswiftCore.so"
	tar -C "$tmp/build/wasm" -czf "$tmp/server/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz" \
		swift-6.3.3-RELEASE_wasm.artifactbundle
}
wasm_sdk wasm32-unknown-wasip1

# One package per vendored library, and bookworm's index naming them per architecture.
# Each library carries its full version, as the real file does, so that none of
# these stand-ins is the soname a real program here loads through the
# LD_LIBRARY_PATH the script's verification sets.
readonly PACKAGES="libxml2:libxml2.so.2.9.14 libicu72:libicuuc.so.72.1 liblzma5:liblzma.so.5.4.1 zlib1g:libz.so.1.2.13 libncurses6:libncursesw.so.6.4 libtinfo6:libtinfo.so.6.4 libsqlite3-0:libsqlite3.so.0.8.6 libuuid1:libuuid.so.1.3.0"
index=""
for entry in $PACKAGES; do
	package="${entry%%:*}"
	lib="${entry#*:}"
	mkdir -p "$tmp/build/deb-$package/usr/lib/x86_64-linux-gnu"
	printf 'vendored %s' "$lib" >"$tmp/build/deb-$package/usr/lib/x86_64-linux-gnu/$lib"
	printf 'not vendored' >"$tmp/build/deb-$package/usr/lib/x86_64-linux-gnu/$package-helper"
	tar -C "$tmp/build/deb-$package" -czf "$tmp/build/deb-$package.tar.gz" usr
	for arch in amd64 arm64; do
		printf '%s' "$tmp/build/deb-$package.tar.gz" >"$tmp/server/${package}_1.0_$arch.deb"
	done
	index+="Package: $package
Filename: pool/main/x/$package/${package}_1.0_ARCH.deb

"
done
publish_index() { # arch [package to leave out]
	awk -v RS= -v ORS='\n\n' -v skip="Package: ${2:-none}" 'index($0, skip "\n") != 1' <<<"${index//ARCH/$1}" |
		gzip >"$tmp/server/Packages.gz"
}
publish_index amd64

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/calls.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u SWIFT_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/calls.log" STUB_SERVER="$tmp/server" \
		STUB_DOWNLOADS="$home/downloads" PATH="$tmp/bin:$PATH" "$@" "$repo/scripts/ci/install-swift.sh" 2>&1)
}

home="$tmp/home"
prefix="$home/.local/share/tcab/gg-swift"
out="$(run "$home")"
check_equal "a fresh install succeeds" "0" "$?"
check_equal "fetches the toolchain, the SDK and the index first" \
	"https://example.com/swift/swift-6.3.3-RELEASE-debian12.tar.gz
https://example.com/swift/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz
https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz" "$(head -3 "$tmp/calls.log")"
check_equal "then one package per vendored library" "8" "$(grep -c '^https://deb.debian.org/debian/pool/' "$tmp/calls.log")"
tc="$prefix/toolchain/usr"
for path in bin/swift-driver bin/swift-frontend bin/clang-21 bin/lld bin/swift-autolink-extract \
	lib/swift/linux/libswiftCore.so lib/swift/host/libSwiftSyntax.so lib/swift/host/compiler/libSwiftCompilerPlugin.so \
	lib/clang/21/include/stdint.h; do
	check_exists "keeps $path" "$tc/$path"
done
check_absent "leaves out a binary no arm runs" "$tc/bin/sourcekit-lsp"
check_absent "and a library no kept binary needs" "$tc/lib/swift/linux/libFoundation.so"
for link in swiftc:swift-driver swift:swift-driver clang:clang-21 wasm-ld:lld ld.lld:lld; do
	check_equal "${link%%:*} is ${link#*:}" "${link#*:}" "$(readlink "$tc/bin/${link%%:*}")"
done
for path in WASI.sdk/usr/include/stdio.h swift.xctoolchain/usr/lib/swift_static/wasi/libswiftCore.a \
	swift.xctoolchain/usr/lib/clang/21/libclang_rt.a; do
	check_exists "installs the SDK's $path" "$prefix/sdk/$path"
done
check_absent "but not its shared stdlib" "$prefix/sdk/swift.xctoolchain/usr/lib/swift"
for entry in $PACKAGES; do
	lib="${entry#*:}"
	check_equal "vendors $lib" "vendored $lib" "$(cat "$prefix/lib/$lib" 2>/dev/null)"
done
check_equal "and nothing else from the packages" "8" "$(find "$prefix/lib" -type f | wc -l | tr -d ' ')"
compiles="$(grep -E '^(clang|swiftc) ' "$tmp/calls.log")"
check_contains "smoke-compiles C against the SDK, through the clang link" \
	"clang --target=wasm32-unknown-wasip1 --sysroot=$prefix/sdk/WASI.sdk -O2 -c" "$compiles"
check_contains "and Swift, through the swiftc link" "swiftc -target wasm32-unknown-wasip1 -sdk $prefix/sdk/WASI.sdk" "$compiles"
check_equal "stamps the version" "6.3.3" "$(cat "$prefix/swift-version")"
check_absent "deletes the staged toolchain" "$home/downloads/swift-6.3.3-RELEASE-debian12.tar.gz"
check_absent "and SDK" "$home/downloads/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz"

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "and leaves the install alone" "Swift 6.3.3 already installed at $prefix" "$out"
check_equal "without fetching" "" "$(cat "$tmp/calls.log")"

publish_index arm64
out="$(run "$tmp/arm-home" STUB_UNAME_M=aarch64)"
check_equal "an aarch64 install succeeds" "0" "$?"
check_contains "with the aarch64 toolchain" "swift-6.3.3-RELEASE-debian12-aarch64.tar.gz" "$(cat "$tmp/calls.log")"
check_contains "and arm64's packages" "binary-arm64/Packages.gz" "$(cat "$tmp/calls.log")"
publish_index amd64

out="$(run "$tmp/dir-home" SWIFT_INSTALL_DIR="$tmp/opt/swift")"
check_equal "SWIFT_INSTALL_DIR is honoured" "0" "$?"
check_exists "as the prefix" "$tmp/opt/swift/toolchain/usr/bin/swift-driver"

out="$(run "$tmp/ldd-home" STUB_LDD_NOT_FOUND=1)"
check_equal "a toolchain with an unresolved library fails" "1" "$?"
check_contains "naming it" "libedit.so.2 => not found" "$out"
check_absent "and stamps nothing" "$tmp/ldd-home/.local/share/tcab/gg-swift/swift-version"

publish_index amd64 libsqlite3-0
out="$(run "$tmp/deb-home")"
check_equal "an index without a vendored package fails" "1" "$?"
check_contains "naming it" "Debian bookworm has no libsqlite3-0 for amd64." "$out"
publish_index amd64

wasm_sdk wasm32-unknown-emscripten
out="$(run "$tmp/sdk-home")"
check_equal "an SDK bundle without the target variant fails" "1" "$?"
check_contains "naming it" "the Swift wasm SDK bundle has no wasm32-unknown-wasip1 variant." "$out"
check_absent "and installs nothing" "$tmp/sdk-home/.local/share/tcab/gg-swift"
wasm_sdk wasm32-unknown-wasip1

out="$(run "$tmp/odd-home" STUB_UNAME_M=riscv64)"
check_equal "a machine with no pinned build fails" "1" "$?"
check_equal "without fetching" "" "$(cat "$tmp/calls.log")"

echo
echo "install-swift.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
