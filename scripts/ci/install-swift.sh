#!/usr/bin/env bash
# Install the **Swift** program language's toolchain — a pruned Swift compiler, the Swift SDK
# for WebAssembly, and the handful of shared libraries the compiler's own linker needs — so a
# machine running gg's test suite has what a gg run container has
# (containers/gg-toolchains/Dockerfile). Pinned by packages/gg-sandbox-swift/swift-version.sh.
#
# WHAT IT COSTS. The published toolchain is ~1.05 GB compressed and 3.3 GB unpacked; the wasm
# SDK is another 72 MB / 286 MB. What is KEPT is **~835 MB** — 605 MB of compiler, 194 MB of SDK
# and 36 MB of vendored libraries — and every deletion below is named with its reason rather than
# swept up by a glob, because a toolchain pruned by guesswork fails months later inside a run
# container on the one program that needed the piece nobody missed.
#
# WHY A TREE RATHER THAN A BINARY ON $PATH, which is how the other compiled arms install. This
# arm needs three things that must agree with each other: a compiler, a target SDK holding a
# wasm sysroot and a wasm standard library, and — because the published toolchain is built for
# Debian 12 and the run images are not all Debian 12 — a vendored copy of the shared libraries
# its `lld` links against. A `swiftc` on `PATH` says nothing about where the other two are, so gg
# resolves a HOME and finds all three under it.
#
# The layout, which `crates/gg/src/sandbox/language/swift.compile.rs` depends on:
#
#   <home>/toolchain/usr/bin/{swiftc,swift-frontend,clang,lld,wasm-ld,...}
#   <home>/toolchain/usr/lib/{swift/…,clang/…}
#   <home>/sdk/WASI.sdk                                   the wasm sysroot
#   <home>/sdk/swift.xctoolchain/usr/lib/swift_static     the wasm standard library
#   <home>/sdk/swift.xctoolchain/usr/lib/clang            the wasm compiler-rt
#   <home>/lib/                                           the vendored ELF dependencies
#   <home>/swift-version                                  what is installed, for idempotency
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore) is
# left alone.
#
# Usage:
#   scripts/ci/install-swift.sh                                  # -> ~/.local/share/tcab/gg-swift
#   SWIFT_INSTALL_DIR=/opt/gg/toolchains/swift scripts/ci/install-swift.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$ROOT/packages/gg-sandbox-swift/swift-version.sh"

INSTALL_DIR="${SWIFT_INSTALL_DIR:-$GG_SWIFT_DEFAULT_HOME}"
STAMP="$INSTALL_DIR/swift-version"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$GG_SWIFT_VERSION" ] &&
	[ -x "$INSTALL_DIR/toolchain/usr/bin/swiftc" ]; then
	echo "Swift $GG_SWIFT_VERSION already installed at $INSTALL_DIR"
	exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PLATFORM="$(gg_swift_platform)"
echo "Installing Swift $GG_SWIFT_VERSION ($PLATFORM) -> $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/toolchain/usr/bin" "$INSTALL_DIR/toolchain/usr/lib/swift/linux" \
	"$INSTALL_DIR/toolchain/usr/lib/swift/host" "$INSTALL_DIR/toolchain/usr/lib/clang" \
	"$INSTALL_DIR/sdk/swift.xctoolchain/usr/lib" "$INSTALL_DIR/lib"

# --- the compiler ------------------------------------------------------------
curl -sSfL "$(gg_swift_toolchain_url)" -o "$WORK/toolchain.tar.gz"
mkdir -p "$WORK/toolchain"
tar -xzf "$WORK/toolchain.tar.gz" -C "$WORK/toolchain" --strip-components=1
SRC="$WORK/toolchain/usr"
DST="$INSTALL_DIR/toolchain/usr"

# The four binaries a cross-compile to wasm actually runs, and nothing else. `swift-driver` is
# the thing `swiftc` is (a symlink), and it is statically linked against the Swift runtime, so it
# needs nothing from lib/swift itself. `swift-frontend` is the compiler. `clang` drives the LINK
# — the Swift driver hands the link to it — and `lld` is `wasm-ld`, the linker every wasm build
# runs. `swift-autolink-extract` is the ELF-era step the driver still invokes and refuses to
# proceed without.
cp -a "$SRC/bin/swift-driver" "$SRC/bin/swift-frontend" "$SRC/bin/clang-21" "$SRC/bin/lld" \
	"$SRC/bin/swift-autolink-extract" "$DST/bin/"
ln -sf swift-driver "$DST/bin/swiftc"
ln -sf swift-driver "$DST/bin/swift"
ln -sf clang-21 "$DST/bin/clang"
ln -sf lld "$DST/bin/wasm-ld"
ln -sf lld "$DST/bin/ld.lld"

# `swift-frontend` links against the host Swift runtime and against the swift-syntax libraries
# that implement macro expansion; both are hard `DT_NEEDED`s and it will not start without them.
# What is copied is the **transitive closure** of what those five binaries actually need, walked
# with `readelf`, rather than the two directories they live in. That is not tidiness: the
# directories hold 305 MB and the closure is 104 MB, and the 200 MB left behind is Foundation's
# networking and testing halves — which drag in `libcurl`, and with it a system-library closure
# (TLS, HTTP/2, IDN, LDAP, GSSAPI) that would have to be vendored below for something no compile
# here ever loads.
#
# The `.swiftmodule` directories beside them are not copied either: they are for compiling HOST
# Swift, which this arm never does — every compile resolves its standard library out of the wasm
# SDK's `swift_static`.
if ! command -v readelf >/dev/null 2>&1; then
	echo "error: readelf (binutils) is needed to work out which Swift libraries to keep." >&2
	exit 1
fi
gg_needed() { readelf -d "$1" | sed -n 's/.*NEEDED.*\[\(.*\)\]/\1/p'; }
GG_SWIFT_LIB_DIRS="$SRC/lib/swift/linux $SRC/lib/swift/host $SRC/lib/swift/host/compiler"
GG_SEEN=""
gg_close() {
	local path="$1" name found dir
	case " $GG_SEEN " in *" $path "*) return 0 ;; esac
	GG_SEEN="$GG_SEEN $path"
	for name in $(gg_needed "$path"); do
		found=""
		for dir in $GG_SWIFT_LIB_DIRS; do
			if [ -f "$dir/$name" ]; then
				found="$dir/$name"
				break
			fi
		done
		if [ -n "$found" ]; then
			local target="$DST/${found#"$SRC"/}"
			mkdir -p "$(dirname "$target")"
			cp -a "$found" "$target"
			gg_close "$found"
		fi
	done
}
for binary in swift-driver swift-frontend clang-21 lld swift-autolink-extract; do
	gg_close "$SRC/bin/$binary"
done
# NOT copied: `lib/swift/host/lib_InternalSwiftScan.so`, the dependency scanner the driver loads by
# NAME rather than by `DT_NEEDED` — so the closure above does not reach it, and that is the right
# answer. It is **184 MB**, a fifth of this whole tree, and without it the driver prints one warning
# and falls back to scanning through `swift-frontend`, which for a single-module compile with no
# package dependencies is the same work. What the warning would otherwise cost is not size but
# clarity: it lands on the channel a failed compile's diagnostics are read from, so
# `swift.compile.rs` drops it there by name.
# clang's own headers (`stddef.h` and the rest), under the version directory clang derives from
# its own path. The wasm SDK ships a `clang/lib` but no `clang/include`, so the compile side
# resolves them here and only the LINK side uses the SDK's.
for headers in "$SRC"/lib/clang/*/include; do
	version="$(basename "$(dirname "$headers")")"
	mkdir -p "$DST/lib/clang/$version"
	cp -a "$headers" "$DST/lib/clang/$version/include"
done

# WHAT IS DROPPED, and why each is safe. `sourcekit-lsp`, `clangd`, `swift-format`, `docc`,
# `lldb*`, `swift-package*`, `swift-build*` and the `llvm-*` utilities — nothing on the turn path
# runs an editor service, a debugger, a formatter, a documentation tool or a build system.
# `lib/libclang.so`, `lib/liblldb.so`, `lib/libsourcekitdInProc.so`, `lib/libLTO.so` — the
# libraries those tools load. `lib/swift_static` (the HOST static standard library, 175 MB) and
# `lib/swift/embedded` (577 MB of Embedded Swift resources for every target) — this arm compiles
# for wasm against the SDK's resources and links neither. `lib/swift/pm`, `share/`, `libexec/`.

# --- the Swift SDK for WebAssembly ------------------------------------------
echo "Installing the Swift SDK for WebAssembly $GG_SWIFT_WASM_SDK_VERSION"
curl -sSfL "$(gg_swift_wasm_sdk_url)" -o "$WORK/wasm-sdk.tar.gz"
mkdir -p "$WORK/wasm-sdk"
tar -xzf "$WORK/wasm-sdk.tar.gz" -C "$WORK/wasm-sdk"
BUNDLE="$(find "$WORK/wasm-sdk" -maxdepth 3 -type d -name "$GG_SWIFT_TARGET" | head -1)"
if [ -z "$BUNDLE" ]; then
	echo "error: the Swift wasm SDK bundle has no $GG_SWIFT_TARGET variant." >&2
	exit 1
fi
cp -a "$BUNDLE/WASI.sdk" "$INSTALL_DIR/sdk/"
# `swift_static` and not `swift`: every compile passes `-static-stdlib`, because a component is
# one self-contained module and there is nothing to dynamically link against inside it. The
# dynamic copy is 93 MB nothing here would load.
cp -a "$BUNDLE/swift.xctoolchain/usr/lib/swift_static" "$INSTALL_DIR/sdk/swift.xctoolchain/usr/lib/"
cp -a "$BUNDLE/swift.xctoolchain/usr/lib/clang" "$INSTALL_DIR/sdk/swift.xctoolchain/usr/lib/"

# --- the vendored ELF dependencies ------------------------------------------
# The toolchain is built for Debian 12 and expects that distribution's sonames: `lld` wants
# `libxml2.so.2`, `swift-frontend` wants `libncurses.so.6` and `libsqlite3.so.0`. Debian bookworm
# ships some of those and not others (`libncurses6` and `libsqlite3-0` are not in the slim base at
# all), `blender-gg`'s Ubuntu ships `libxml2.so.16` instead of `.2`, and a developer's machine may
# ship none of them — and this same tree is copied to the same absolute path in all of them. So the
# closure travels with the toolchain, and `swift.compile.rs` puts this directory on
# `LD_LIBRARY_PATH` for every compile it runs. This is the "the language's own step vendors what it
# needs" clause of constraint 1 in containers/gg-toolchains/Dockerfile, taken literally.
#
# What is NOT vendored is `libc`, `libm`, `libgcc_s` and `libstdc++`: every image gg runs in has a
# C and C++ runtime, both are backward compatible, and a vendored `libstdc++` older than the image's
# would be the one way to make this tree *less* portable rather than more.
echo "Vendoring the shared libraries the toolchain expects at Debian sonames"
# Resolved from the distribution's own index rather than hard-coded, so a security update to any
# of them is picked up without a version bump here.
case "$(uname -m)" in
x86_64) DEB_ARCH="amd64" ;;
aarch64 | arm64) DEB_ARCH="arm64" ;;
*)
	echo "error: no Debian bookworm architecture for $(uname -m)." >&2
	exit 1
	;;
esac
curl -sSfL "https://deb.debian.org/debian/dists/bookworm/main/binary-$DEB_ARCH/Packages.gz" \
	-o "$WORK/Packages.gz"
gzip -dc "$WORK/Packages.gz" >"$WORK/Packages"
for package in libxml2 libicu72 liblzma5 zlib1g libncurses6 libtinfo6 libsqlite3-0 libuuid1; do
	filename="$(awk -v P="$package" '$0=="Package: "P{found=1} found&&/^Filename:/{print $2; exit}' "$WORK/Packages")"
	if [ -z "$filename" ]; then
		echo "error: Debian bookworm has no $package for $DEB_ARCH." >&2
		exit 1
	fi
	curl -sSfL "https://deb.debian.org/debian/$filename" -o "$WORK/$package.deb"
	rm -rf "$WORK/deb" && mkdir -p "$WORK/deb"
	(cd "$WORK/deb" && ar x "$WORK/$package.deb" && tar -xf data.tar.*)
	# Only what the closure actually needs. ICU ships six libraries and libxml2 links one of them
	# (`libicuuc`), which in turn loads the data blob; everything else in these packages stays out.
	find "$WORK/deb" \( -name 'libxml2.so.*' -o -name 'libicuuc.so.*' -o -name 'libicudata.so.*' \
		-o -name 'liblzma.so.*' -o -name 'libz.so.*' -o -name 'libncurses.so.*' \
		-o -name 'libncursesw.so.*' -o -name 'libtinfo.so.*' -o -name 'libsqlite3.so.*' \
		-o -name 'libuuid.so.*' \) -exec cp -a {} "$INSTALL_DIR/lib/" \;
done

# --- prove the pruned tree is the one that works ----------------------------
# Not "assume": every deletion above is a thing that could have broken this, and the last time
# a toolchain was pruned by inspection it failed on the machine that had no other copy.
#
# BOTH compilers, because they fail in different places. `clang` compiles the WIT bindings and
# resolves its headers out of the tree above; `swiftc` compiles the program and its shell and
# resolves the standard library out of the SDK. A pruning that broke only the first would leave
# this passing and every real build failing at `stddef.h`.
# Nothing the toolchain needs may be left unresolved. This is the check the first build of the
# gg image failed on — `libncurses.so.6` is a dependency of `swift-frontend` that a developer's
# machine happened to have and `debian:bookworm-slim` does not — and it is here rather than only in
# the smoke builds below because a missing library is an *operator's* failure with an obvious fix,
# where "swiftc: error while loading shared libraries" three layers down inside a run is not.
echo "Verifying the pruned toolchain"
missing="$(
	for binary in "$INSTALL_DIR"/toolchain/usr/bin/*; do
		[ -f "$binary" ] || continue
		LD_LIBRARY_PATH="$INSTALL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
			ldd "$binary" 2>/dev/null | grep "not found" || true
	done | sort -u
)"
if [ -n "$missing" ]; then
	echo "error: the installed Swift toolchain cannot resolve:" >&2
	echo "$missing" >&2
	echo "       Add them to the vendored set above." >&2
	exit 1
fi
printf '#include <stdint.h>\nuint32_t gg_smoke(void) { return 1; }\n' >"$WORK/smoke.c"
LD_LIBRARY_PATH="$INSTALL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
	"$INSTALL_DIR/toolchain/usr/bin/clang" \
	--target="$GG_SWIFT_TARGET" --sysroot="$INSTALL_DIR/sdk/WASI.sdk" -O2 \
	-c "$WORK/smoke.c" -o "$WORK/smoke.o"
test -s "$WORK/smoke.o"
printf 'let answer = 40 + 2\nprint(answer)\n' >"$WORK/main.swift"
LD_LIBRARY_PATH="$INSTALL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
	"$INSTALL_DIR/toolchain/usr/bin/swiftc" \
	-target "$GG_SWIFT_TARGET" \
	-sdk "$INSTALL_DIR/sdk/WASI.sdk" \
	-resource-dir "$INSTALL_DIR/sdk/swift.xctoolchain/usr/lib/swift_static" \
	-static-stdlib -Osize -wmo \
	-Xclang-linker -resource-dir -Xclang-linker "$INSTALL_DIR/sdk/swift.xctoolchain/usr/lib/clang" \
	"$WORK/main.swift" -o "$WORK/smoke.wasm"
test -s "$WORK/smoke.wasm"

echo "$GG_SWIFT_VERSION" >"$STAMP"
du -sh "$INSTALL_DIR"
echo "Swift $GG_SWIFT_VERSION installed at $INSTALL_DIR"
