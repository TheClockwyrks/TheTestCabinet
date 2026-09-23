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
# absolute path on Debian-derived images and on `blender-gg`'s Ubuntu — is nearly satisfied by
# unpacking it: what is left is three sonames its Debian build links that glibc does not provide,
# vendored below into a directory the binaries' own `RPATH` already names. The Swift arm's
# installer has to do the same thing the hard way, resolving packages from a distribution index and
# naming the result on `LD_LIBRARY_PATH` for every compile.
#
# The layout, which `crates/gg/src/sandbox/language/cpp.compile.rs` depends on:
#
#   <home>/bin/{clang,clang++,wasm-ld,...}     the compiler and the linker
#   <home>/bin/clang.cfg, clang++.cfg          what points them at the sysroot below
#   <home>/lib/lib{LLVM,clang-cpp,edit}.so…    the shared objects those two load
#   <home>/lib/libstdc++.so.6, libgcc_s.so.1   the C++ runtime they were built against
#   <home>/lib/libtinfo.so.6                   what `libedit` needs, one level down the closure
#   <home>/lib/clang/<major>/lib/…             compiler-rt for the wasm target
#   <home>/share/wasi-sysroot/                 wasi-libc, libc++ and their headers
#   <home>/wasi-sdk-version                    what is installed, for idempotency
#
# Nothing has to be put on `LD_LIBRARY_PATH` to make that work, unlike the Swift arm: every one of
# those binaries carries an `RPATH` of `$ORIGIN/../lib`, so a vendored library in `<home>/lib` is
# found by the loader and by nothing else in the image.
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore) is left
# alone — but "matching" is asked of the files as well as of the stamp, because a tree that predates
# a library the vendoring later added carries a current stamp over an incomplete tree. See the guard.
#
# Usage:
#   scripts/ci/install-wasi-sdk.sh                                       # -> ~/.local/share/tcab/gg-wasi-sdk
#   WASI_SDK_INSTALL_DIR=/opt/gg/toolchains/wasi-sdk scripts/ci/install-wasi-sdk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$ROOT/packages/gg-sandbox-cpp/cpp-version.sh"
# shellcheck source=scripts/ci/fetch.sh
source "$ROOT/scripts/ci/fetch.sh"

INSTALL_DIR="${WASI_SDK_INSTALL_DIR:-$GG_WASI_SDK_DEFAULT_HOME}"
STAMP="$INSTALL_DIR/wasi-sdk-version"

# The three sonames the vendoring below takes off the machine doing the install, named exactly
# rather than globbed: unlike the ICU the C# arm resolves from a distribution index, these are
# whatever the build machine's glibc-era `libstdc++6` and `libtinfo6` are called, and the name the
# `RPATH` reaches is the soname itself. The libraries that arrive inside the tarball — `libLLVM`,
# `libclang-cpp`, `libedit` — are not on this list, because a tarball that unpacked at all carried
# them and a tarball that did not never reached the stamp.
gg_wasi_sdk_libraries_vendored() {
	local tree="$1" soname
	for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
		[ -f "$tree/lib/$soname" ] || return 1
	done
	return 0
}

# What the stamp is allowed to stand for is every part of the tree this script writes, and the C#
# arm's sibling installer (`scripts/ci/install-dotnet.sh`) carries the same paragraph for the same
# reason. `libtinfo.so.6` was added to the vendored set long after the stamp existed, so every
# machine that installed before it — a developer's, a CI cache — holds a stamp naming the right wasi-sdk over a tree that does not carry it. A
# check that asked only about the version would leave all of them resolving `libtinfo` off whatever
# the surrounding image happens to ship, which is the accident constraint 3 of
# `containers/gg-toolchains/Dockerfile` says does not count as satisfied — and, because
# `install-gg-toolchains.sh` re-runs this on every reconcile, would say "already installed" forever
# rather than ever repairing it. So the check asks about the FILES, and a tree missing any of them
# is re-installed however current its stamp is.
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$GG_WASI_SDK_VERSION" ] &&
	[ -x "$INSTALL_DIR/bin/clang++" ] && gg_wasi_sdk_libraries_vendored "$INSTALL_DIR"; then
	echo "wasi-sdk $GG_WASI_SDK_VERSION already installed at $INSTALL_DIR"
	exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Installing wasi-sdk $GG_WASI_SDK_VERSION ($(gg_wasi_sdk_platform)) -> $INSTALL_DIR"
# ~650 MB, through `gg_fetch` — which resumes, retries, and stages the archive where a partial one
# outlives the run that failed, so a dropped connection costs the remainder of the transfer rather
# than the whole of it. It is deleted at the bottom, once the pruned tree has compiled something.
SDK_ARCHIVE="$(gg_fetch_dir)/wasi-sdk-$GG_WASI_SDK_VERSION-$(gg_wasi_sdk_platform).tar.gz"
gg_fetch "$(gg_wasi_sdk_url)" "$SDK_ARCHIVE"
mkdir -p "$WORK/sdk"
tar -xzf "$SDK_ARCHIVE" -C "$WORK/sdk" --strip-components=1

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
#
# THE OLD TREE GOES FIRST, and it goes here — after the download and the unpack, so a fetch that
# failed leaves the working toolchain a machine already had rather than no toolchain at all. That is
# `install-dotnet.sh`'s order rather than `install-swift.sh`'s, and it is the better of the two.
#
# An install that merged into whatever was there would keep a file a later prune stopped wanting,
# and — because this is the tree whose binaries carry `RPATH=$ORIGIN/../lib` — it breaks outright:
# the vendoring below resolves each soname by running `ldd` on the installed `clang-22`, so a `lib/`
# that already holds `libstdc++.so.6` makes `ldd` name the tree's OWN copy and the `cp` that follows
# fails with "are the same file". That is not hypothetical. It is what a version bump has always
# done to a warm tree, and adding `libtinfo.so.6` to the guard above put every machine installed
# before it on the same path at its next reconcile.
rm -rf "$INSTALL_DIR"
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
# `libgcc_s` sonames, which glibc does not provide.
#
# `libtinfo.so.6` is the third, and it is here because THE CLOSURE IS WALKED RATHER THAN READ OFF
# THE TWO BINARIES. It is a `DT_NEEDED` of no binary in `bin/`: it is what `libedit.so.0` needs,
# one level further down, and `libedit` is copied out of the tarball above rather than resolved
# from the machine — so a list written by reading `clang-22`'s own header would name the two GCC
# sonames and stop. Every run image happens to ship `libtinfo6` — both parents' `bash` depends on
# it, Debian's and Ubuntu's alike — which is exactly the objection: a dependency satisfied by whatever a base
# image happens to contain is not satisfied, it is a dependency that leaves the day an unrelated
# package stops pulling it in. That is the failure mode this arm's sibling C# toolchain was
# actually shipped with — see the ICU vendoring in `scripts/ci/install-dotnet.sh` — and vendoring
# `libtinfo` costs 200 KB.
#
# All three are vendored from the machine doing the install rather than named on `LD_LIBRARY_PATH`
# the way the Swift arm's are, because these binaries already carry `RPATH=$ORIGIN/../lib`: a copy
# here is found by them and by nothing else, so gg's compile needs no environment at all. An
# `RPATH` — not a `RUNPATH` — is searched for a dependency's dependencies too, which is what lets
# it reach `libtinfo` on `libedit`'s behalf; a `RUNPATH` would not, and the check below is what
# would say so.
#
# Each is resolved through `ldd` on the tree as it stands rather than by a distribution path, so
# the copy is the file the loader would have chosen. `ldd` finds the machine's copy and not one of
# these only because the tree was removed above before it was written: a `lib/` carried over from a
# previous install would answer for its own soname through the `RPATH`, and the copy would be a
# file onto itself. The loop reads each name exactly once, so nothing it writes shadows a name it
# has yet to read.
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	resolved="$(ldd "$INSTALL_DIR/bin/clang-22" | sed -n "s|^[[:space:]]*$soname => \\([^ ]*\\).*|\\1|p")"
	if [ -z "$resolved" ] || [ ! -f "$resolved" ]; then
		echo "error: could not find $soname to vendor beside the wasi-sdk compiler." >&2
		echo "       install libstdc++6 and libtinfo6 on this machine and re-run." >&2
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

# The staged archive, and only now: every line above this one is a way for the install to fail with
# it still worth having, and an install that got this far has a tree the stamp vouches for.
rm -f "$SDK_ARCHIVE"

"$INSTALL_DIR/bin/clang++" --version | head -1
du -sh "$INSTALL_DIR"
