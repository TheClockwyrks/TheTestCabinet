#!/usr/bin/env bash
# Install the **C++** program language's toolchain — wasi-sdk, which is a whole clang, a `wasm-ld`,
# a libc++ and a wasi-libc sysroot in one relocatable tree — so a machine running gg's test suite
# has what a gg run container has (containers/gg-toolchains/Dockerfile). Pinned by
# packages/gg-sandbox-cpp/cpp-version.sh.
#
# WHAT IT COSTS. The published tarball is ~193 MB and ~650 MB unpacked, and this script keeps
# **~200 MB** of it — the smallest toolchain of the four compiled arms, against `rustc`'s ~376 MB
# and the Swift SDK's ~835 MB. Every deletion below is named with its reason rather than swept up
# by a glob, because a toolchain pruned by guesswork fails months later inside a run container on
# the one program that needed the piece nobody missed.
#
# WHY IT IS THE SIMPLEST INSTALLER OF THE FOUR COMPILED ARMS, which is worth saying because it is a
# property of the toolchain rather than of this script. wasi-sdk is built for exactly this job: it
# is statically linked against nothing a distribution owns, `clang` derives its sysroot and its
# resource directory from its own path (`bin/clang.cfg` names `<CFGDIR>/../share/wasi-sysroot`), and
# the whole tree relocates. So constraint 1 of `containers/gg-toolchains/Dockerfile` — the same
# absolute path on Debian-derived images and on `blender-gg`'s Ubuntu — is satisfied by unpacking
# it, where the Swift arm's installer has to vendor `libxml2` and walk an ELF closure to get there.
#
# The layout, which `crates/gg/src/sandbox/language/cpp.compile.rs` depends on:
#
#   <home>/bin/{clang,clang++,wasm-ld,...}     the compiler and the linker
#   <home>/bin/clang.cfg, clang++.cfg          what points them at the sysroot below
#   <home>/lib/lib{LLVM,clang-cpp,edit}.so…    the shared objects those two load
#   <home>/lib/libstdc++.so.6, libgcc_s.so.1   the C++ runtime they were built against
#   <home>/lib/clang/<major>/lib/…             compiler-rt for the wasm target
#   <home>/share/wasi-sysroot/                 wasi-libc, libc++ and their headers
#   <home>/wasi-sdk-version                    what is installed, for idempotency
#
# Nothing has to be put on `LD_LIBRARY_PATH` to make that work, unlike the Swift arm: every one of
# those binaries carries an `RPATH` of `$ORIGIN/../lib`, so a vendored library in `<home>/lib` is
# found by the loader and by nothing else in the image.
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore) is left
# alone.
#
# Usage:
#   scripts/ci/install-wasi-sdk.sh                                       # -> ~/.local/share/tcab/gg-wasi-sdk
#   WASI_SDK_INSTALL_DIR=/opt/gg/toolchains/wasi-sdk scripts/ci/install-wasi-sdk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$ROOT/packages/gg-sandbox-cpp/cpp-version.sh"

INSTALL_DIR="${WASI_SDK_INSTALL_DIR:-$GG_WASI_SDK_DEFAULT_HOME}"
STAMP="$INSTALL_DIR/wasi-sdk-version"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$GG_WASI_SDK_VERSION" ] &&
	[ -x "$INSTALL_DIR/bin/clang++" ]; then
	echo "wasi-sdk $GG_WASI_SDK_VERSION already installed at $INSTALL_DIR"
	exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Installing wasi-sdk $GG_WASI_SDK_VERSION ($(gg_wasi_sdk_platform)) -> $INSTALL_DIR"
curl -sSfL "$(gg_wasi_sdk_url)" -o "$WORK/wasi-sdk.tar.gz"
mkdir -p "$WORK/sdk"
tar -xzf "$WORK/wasi-sdk.tar.gz" -C "$WORK/sdk" --strip-components=1

SRC="$WORK/sdk"

# --- what is pruned, and why each is safe ------------------------------------
# The turn path runs exactly two programs out of this tree: `clang++` (which is `clang`, which is
# `clang-22`) and the `wasm-ld` it hands the link to. Everything below is a tool nothing on that
# path invokes.
#
# `lldb` (117 MB) — there is no debugger in a run container. `clang-tidy`,
# `clang-apply-replacements`, `run-clang-tidy`, `clang-format`, `clang-scan-deps`, `clang-cl`,
# `git-clang-format` — an arm that linted or reformatted a model's program would be gg imposing a
# style policy on an experiment about capability, and nothing here does. `lld-link`, `ld64.lld`,
# `ld.lld` — the PE, Mach-O and ELF drivers of the same linker; this arm links wasm. The `llvm-*`
# utilities and `nm`/`objdump`/`strip`/`ranlib`/`ar`/`size`/`strings`/`objcopy`/`c++filt` — object
# inspection, which gg does in its own process with `wit_component` rather than by shelling out.
# `wasm-component-ld` — the p2 linker this arm deliberately does not use (see
# `cpp-version.sh`'s note on the target).
#
# What is KEPT beyond the two: the `.cfg` files, without which `clang` cannot find its own sysroot;
# `lib/clang/<major>` (headers and the wasm `compiler-rt`); and `share/wasi-sysroot`, which is
# wasi-libc, libc++, libc++abi, libunwind and every header a program includes.
#
# The wasi-sysroot is kept for **one target**, and that is the largest single deletion here: it
# publishes five (`wasm32-wasi`, `-threads` variants of two of them, `wasm32-wasip1`,
# `wasm32-wasip2`), each with its own 33 MB of headers and ~55 MB of libraries, and this arm
# compiles to exactly the one `cpp-version.sh` pins. That is ~250 MB of the ~578 MB an unpruned
# copy weighs. It is safe because the target is read from the same file gg reads and because the
# check below compiles with it — a target changed without changing this line fails here, at
# install time, rather than inside a run container.
#
# Two things inside the kept target are dropped with it. `llvm-lto` (5.7 MB) is the LTO plugin, and
# nothing here links with `-flto`: a whole-program optimisation on the turn path would be seconds
# of compile buying a program that runs for milliseconds nothing at all. `lib/<target>/noeh`
# (27 MB) is the libc++ built WITHOUT exception support, and this arm compiles every translation
# unit with `-fwasm-exceptions` — so the `eh` build beside it is the one every link resolves
# against, and keeping both would be keeping a library no invocation can reach. Its HEADERS stay,
# deliberately: clang picks between the two include trees by that same flag, and deleting the
# unused half would turn a stray `-fno-exceptions` into "no such file" from inside libc++ rather
# than into a link error naming the library.
#
# The two real binaries are `clang-22` and `lld`; every other name in `bin/` is a symlink to one
# of them, and the name matters — `clang++` is how `clang-22` is told it is compiling C++, and
# `wasm-ld` is how `lld` is told which linker driver to be. So the symlinks are recreated rather
# than copied, which is also what keeps a dangling link out of the tree.
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/lib" "$INSTALL_DIR/share"
cp -a "$SRC/bin/clang-22" "$SRC/bin/lld" "$INSTALL_DIR/bin/"
ln -sf clang-22 "$INSTALL_DIR/bin/clang"
ln -sf clang "$INSTALL_DIR/bin/clang++"
ln -sf clang "$INSTALL_DIR/bin/clang-cpp"
ln -sf lld "$INSTALL_DIR/bin/wasm-ld"
cp -a "$SRC/bin/clang.cfg" "$SRC/bin/clang++.cfg" "$INSTALL_DIR/bin/"
cp -a "$SRC/lib/clang" "$INSTALL_DIR/lib/clang"

SYSROOT="$INSTALL_DIR/share/wasi-sysroot"
mkdir -p "$SYSROOT/include" "$SYSROOT/lib"
cp -a "$SRC/share/wasi-sysroot/include/c++" "$SYSROOT/include/c++"
cp -a "$SRC/share/wasi-sysroot/include/$GG_CPP_TARGET" "$SYSROOT/include/$GG_CPP_TARGET"
cp -a "$SRC/share/wasi-sysroot/lib/$GG_CPP_TARGET" "$SYSROOT/lib/$GG_CPP_TARGET"
rm -rf "$SYSROOT/lib/$GG_CPP_TARGET/llvm-lto" "$SYSROOT/lib/$GG_CPP_TARGET/noeh"

# The shared objects the two kept binaries load. `libLLVM` and `libclang-cpp` are the compiler and
# the linker themselves — the `bin/` entries are thin drivers — and `libedit` is what `libLLVM`
# links for its own line editing. `libclang.so` (35 MB) and `liblldb.so` (18 MB) are deliberately
# left behind: the first is for programs that embed clang as a library and the second is the
# debugger.
for library in libLLVM.so.*-wasi-sdk libclang-cpp.so.*-wasi-sdk 'libedit.so.0*'; do
	# shellcheck disable=SC2086 # the glob is the point
	cp -a $SRC/lib/$library "$INSTALL_DIR/lib/"
done

# --- what makes the tree distribution-portable -------------------------------
# Constraint 1 of `containers/gg-toolchains/Dockerfile`, taken literally: this tree is copied to
# the same absolute path onto the Debian-derived run images AND onto `blender-gg`'s Ubuntu, so a
# library only one of them ships is a toolchain that works on some gg runs and not others.
# wasi-sdk's binaries are published for Debian and hard-link that distribution's `libstdc++` and
# `libgcc_s` sonames — the only two things in the closure above that glibc does not provide.
#
# They are vendored from the machine doing the install rather than named on `LD_LIBRARY_PATH` the
# way the Swift arm's are, because these binaries already carry `RPATH=$ORIGIN/../lib`: a copy here
# is found by them and by nothing else, so gg's compile needs no environment at all.
for soname in libstdc++.so.6 libgcc_s.so.1; do
	resolved="$(ldd "$INSTALL_DIR/bin/clang-22" | sed -n "s|^[[:space:]]*$soname => \\([^ ]*\\).*|\\1|p")"
	if [ -z "$resolved" ] || [ ! -f "$resolved" ]; then
		echo "error: could not find $soname to vendor beside the wasi-sdk compiler." >&2
		echo "       install libstdc++6 on this machine and re-run." >&2
		exit 1
	fi
	cp -aL "$resolved" "$INSTALL_DIR/lib/$soname"
done

# Nothing unresolved, checked rather than hoped for: an unresolved soname here is the failure that
# would otherwise surface months later inside a run container, on the one image that did not
# happen to ship it.
for binary in "$INSTALL_DIR/bin/clang-22" "$INSTALL_DIR/bin/wasm-ld"; do
	if ldd "$binary" | grep -q 'not found'; then
		echo "error: $binary has unresolved libraries:" >&2
		ldd "$binary" | grep 'not found' >&2
		exit 1
	fi
done

# --- prove the copy is the thing that will run -------------------------------
# With the COPY, not with the tarball: relocation, the `.cfg` sysroot resolution and the pruning
# above are each a thing that could have broken exactly one of the two compiles below, and a
# smoke test against the source tree would have caught none of them.
#
# Both are compiled, because the two halves of this arm are a C object (the generated WIT
# bindings) and a C++ one (gg's shell and the model's program) and they fail differently: a C++
# compile additionally needs libc++'s headers, its static archives and — for the exception flags
# this arm uses — `libunwind.a`, none of which a C compile touches.
cat >"$WORK/smoke.c" <<'EOF'
int gg_smoke(int value) { return value + 1; }
EOF
cat >"$WORK/smoke.cpp" <<'EOF'
#include <algorithm>
#include <format>
#include <ranges>
#include <expected>
#include <string>
#include <vector>
extern "C" int gg_smoke(int value);
extern "C" int gg_smoke_cpp() {
  std::vector<int> values{3, 1, 2};
  std::ranges::sort(values);
  std::expected<int, std::string> parsed = gg_smoke(values.front());
  try {
    if (!parsed) throw std::runtime_error(parsed.error());
  } catch (const std::exception &failure) {
    return (int)std::string(failure.what()).size();
  }
  return (int)std::format("{}", *parsed).size();
}
EOF
"$INSTALL_DIR/bin/clang" --target="$GG_CPP_TARGET" -Os -c -o "$WORK/smoke.o" "$WORK/smoke.c"
"$INSTALL_DIR/bin/clang++" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" -Os \
	-fwasm-exceptions -mllvm -wasm-use-legacy-eh=false \
	-mexec-model=reactor -Wl,--gc-sections -Wl,--no-entry \
	-o "$WORK/smoke.wasm" "$WORK/smoke.cpp" "$WORK/smoke.o" -lunwind
test -s "$WORK/smoke.wasm"

echo "$GG_WASI_SDK_VERSION" >"$STAMP"
"$INSTALL_DIR/bin/clang++" --version | head -1
du -sh "$INSTALL_DIR"
