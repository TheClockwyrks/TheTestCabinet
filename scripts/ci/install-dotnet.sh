#!/usr/bin/env bash
# Install the **C#** program language's host toolchain — a .NET runtime, Roslyn, and the reference
# assemblies a program is compiled against — so a machine running gg's test suite has what a gg run
# container has (containers/gg-toolchains/Dockerfile). Pinned by
# packages/gg-sandbox-csharp/csharp-version.sh.
#
# WHAT IT COSTS. `dotnet-install.sh` fetches the whole SDK (~770 MB installed) because that is the
# only artifact Microsoft publishes carrying Roslyn *and* the reference pack at one pin. This script
# keeps **~160 MB** of it — the smallest toolchain of the compiled arms, against wasi-sdk's ~200 MB,
# `rustc`'s ~376 MB and the Swift SDK's ~835 MB — and deletes the rest. Every deletion is named with
# its reason rather than swept up by a glob, because a toolchain pruned by guesswork fails months
# later inside a run container on the one program that needed the piece nobody missed.
#
# WHAT IS NOT HERE, and it is most of what a .NET developer would expect: MSBuild, NuGet, the
# templating engine, F#, the test host, the AOT compilers, the ASP.NET reference pack, and the whole
# wasm workload. gg never builds a *project* — it compiles one file with one compiler — and the wasm
# half of this arm is built by `packages/gg-sandbox-csharp/build.sh`, from the unpruned SDK
# `scripts/ci/install-gg-build-toolchains.sh` puts in a prefix of its own. A run container therefore
# carries no wasm toolchain for C# at all, which is why this is the only arm whose compiler emits
# something that is not wasm and whose image cost is the smallest.
#
# The layout, which `crates/gg/src/sandbox/language/csharp.compile.rs` depends on:
#
#   <home>/dotnet/dotnet          the launcher
#   <home>/dotnet/host/…          the resolver it loads
#   <home>/dotnet/shared/…        the shared framework it resolves — the runtime csc itself runs on
#   <home>/roslyn/bincore/csc.dll the compiler, and the Roslyn assemblies it loads
#   <home>/ref/<tfm>/*.dll        the reference assemblies a model's program is compiled against
#   <home>/lib/libicu*.so.*       the ICU the runtime `dlopen`s before `Main` — see the vendoring
#   <home>/dotnet-version         what is installed, for idempotency
#
# THE REFERENCE ASSEMBLIES ARE THE POINT OF PINNING THIS AT ALL. They decide what a model's program
# may call, and they have to be the release the BCL inside the baked guest was cut from — a
# program compiled against 10.0.10 references and interpreted by a 10.0.9 runtime is a program whose
# `MissingMethodException` nobody would think to look for. That is why gg does not use a machine's
# own `dotnet` even when it is the same version.
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore) is left
# alone — but "matching" is asked of the files as well as of the stamp, because a tree that predates
# a library the vendoring later added carries a current stamp over an incomplete tree. See the guard.
#
# Usage:
#   scripts/ci/install-dotnet.sh                                    # -> ~/.local/share/tcab/gg-dotnet
#   DOTNET_INSTALL_DIR=/opt/gg/toolchains/dotnet scripts/ci/install-dotnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$ROOT/packages/gg-sandbox-csharp/csharp-version.sh"

INSTALL_DIR="${DOTNET_INSTALL_DIR:-$GG_DOTNET_DEFAULT_HOME}"
STAMP="$INSTALL_DIR/dotnet-version"

# The three ICU sonames of the vendoring below, present under `<tree>/lib` at whatever version the
# distribution's index resolved to. Globbed rather than named, because the version is not this
# script's to know — that is the point of resolving the package from the index — and matched one
# soname at a time, because the failure worth catching is a `lib/` holding two of the three:
# `libicuuc` and `libicudata` are what the Swift arm vendors for `libxml2`, and a tree that borrowed
# its set would start `csc` nowhere.
gg_dotnet_icu_vendored() {
	local tree="$1" soname
	for soname in libicuuc libicui18n libicudata; do
		set -- "$tree/lib/$soname".so.*
		[ -f "$1" ] || return 1
	done
	return 0
}

# What the stamp is allowed to stand for is every part of the tree this script writes, and that is
# not pedantry: `lib/` was added to the tree long after the stamp was, so every machine that
# installed before it — a developer's, a CI cache, a warm image layer — carries a stamp naming the
# right SDK over a tree with no ICU in it, which is precisely the tree the C# arm dies on. A stamp
# check that asked only about the version would leave all of them broken and silent, and re-running
# this script (which is what `install-gg-toolchains.sh` does on every reconcile) would say
# "already installed" forever. So the check asks about the FILES, and a tree missing any of them is
# re-installed however current its stamp is.
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$GG_DOTNET_SDK_VERSION" ] &&
	[ -x "$INSTALL_DIR/dotnet/dotnet" ] && [ -f "$INSTALL_DIR/roslyn/bincore/csc.dll" ] &&
	gg_dotnet_icu_vendored "$INSTALL_DIR"; then
	echo ".NET $GG_DOTNET_SDK_VERSION already installed at $INSTALL_DIR"
	exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ARCH="$(gg_dotnet_architecture)"
echo "Installing .NET SDK $GG_DOTNET_SDK_VERSION ($ARCH) -> $INSTALL_DIR"
curl -sSfL https://dot.net/v1/dotnet-install.sh -o "$WORK/dotnet-install.sh"
chmod +x "$WORK/dotnet-install.sh"
"$WORK/dotnet-install.sh" --channel "$GG_DOTNET_CHANNEL" --version "$GG_DOTNET_SDK_VERSION" \
	--architecture "$ARCH" --install-dir "$WORK/sdk" --no-path

SRC="$WORK/sdk"
test -x "$SRC/dotnet"
test -d "$SRC/sdk/$GG_DOTNET_SDK_VERSION/Roslyn/bincore"

# The runtime pack the SDK carried has to be the one this arm pins, or the reference assemblies and
# the guest's BCL are two different releases. Checked here, at install time, rather than left to
# present as a missing method inside somebody's run.
if [ ! -d "$SRC/shared/Microsoft.NETCore.App/$GG_DOTNET_RUNTIME_VERSION" ]; then
	echo "error: SDK $GG_DOTNET_SDK_VERSION carries $(ls "$SRC/shared/Microsoft.NETCore.App"), not the pinned runtime $GG_DOTNET_RUNTIME_VERSION." >&2
	exit 1
fi
if [ ! -d "$SRC/packs/Microsoft.NETCore.App.Ref/$GG_DOTNET_RUNTIME_VERSION/ref/$GG_DOTNET_TFM" ]; then
	echo "error: SDK $GG_DOTNET_SDK_VERSION carries no $GG_DOTNET_TFM reference pack at $GG_DOTNET_RUNTIME_VERSION." >&2
	exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/dotnet/shared" "$INSTALL_DIR/ref"

# The launcher, its resolver, and the framework it resolves. `host/` is not optional decoration: the
# launcher is a thin native binary that loads `hostfxr` out of it to find the framework below.
cp -a "$SRC/dotnet" "$INSTALL_DIR/dotnet/dotnet"
cp -a "$SRC/host" "$INSTALL_DIR/dotnet/host"
cp -a "$SRC/shared/Microsoft.NETCore.App" "$INSTALL_DIR/dotnet/shared/Microsoft.NETCore.App"

# Roslyn, whole. `bincore/` holds `csc.dll`, the two `Microsoft.CodeAnalysis` assemblies it loads,
# and the `csc.runtimeconfig.json` that tells the launcher which framework to run it on.
cp -a "$SRC/sdk/$GG_DOTNET_SDK_VERSION/Roslyn" "$INSTALL_DIR/roslyn"

# The reference assemblies, which are the whole reason for the pin above.
cp -a "$SRC/packs/Microsoft.NETCore.App.Ref/$GG_DOTNET_RUNTIME_VERSION/ref/$GG_DOTNET_TFM" \
	"$INSTALL_DIR/ref/$GG_DOTNET_TFM"

# --- what is dropped out of what was kept --------------------------------------------------------

# The Visual Basic compiler and its code-analysis assembly. gg compiles C#; `vbc` is ~30 MB of a
# language no arm of this study writes, and it sits in `bincore/` beside `csc` only because they
# share a Roslyn.
rm -f "$INSTALL_DIR/roslyn/bincore/vbc.dll" \
	"$INSTALL_DIR/roslyn/bincore/vbc.deps.json" \
	"$INSTALL_DIR/roslyn/bincore/vbc.runtimeconfig.json" \
	"$INSTALL_DIR/roslyn/bincore/Microsoft.CodeAnalysis.VisualBasic.dll"

# The compiler SERVER — `VBCSCompiler`, the resident process an SDK build reuses across
# compilations. It is deleted rather than merely unused, and that is the point: a compiler process
# shared between two agents' programs is the exact shape of the silent-corruption bug the seam's
# isolation contract exists to prevent (crates/gg/src/sandbox/language/compile.rs). gg runs
# `csc.dll` directly, which never starts it; removing it means nothing on this machine can.
rm -f "$INSTALL_DIR/roslyn/bincore/VBCSCompiler.dll" \
	"$INSTALL_DIR/roslyn/bincore/VBCSCompiler.deps.json" \
	"$INSTALL_DIR/roslyn/bincore/VBCSCompiler.runtimeconfig.json" \
	"$INSTALL_DIR/roslyn/bincore/VBCSCompiler"

# Localised compiler messages, in thirteen languages. A diagnostic gg hands a model is read by a
# model, and every prompt in this repository is English; a `de/` beside `csc` would only ever be
# selected by a run container whose locale nobody chose.
find "$INSTALL_DIR/roslyn" -mindepth 2 -maxdepth 2 -type d -name '*.resources' -exec rm -rf {} +
for locale in cs de es fr it ja ko pl pt-BR ru tr zh-Hans zh-Hant; do
	rm -rf "$INSTALL_DIR/roslyn/bincore/$locale" "$INSTALL_DIR/roslyn/$locale"
done

# The XML documentation beside every reference assembly — 43 MB of IntelliSense prose for an editor
# nobody is running. `csc` reads the `.dll`; it reads a sibling `.xml` only to copy documentation
# into an output nobody asks this compile for.
find "$INSTALL_DIR/ref" -name '*.xml' -delete

# --- the ICU the runtime dlopens -----------------------------------------------------------------
#
# Everything above is managed code over one small native host, and that is exactly what hides this
# arm's one native dependency. The .NET runtime does not LINK ICU: `libSystem.Globalization.Native.so`
# `dlopen`s `libicuuc.so.<v>` and `libicui18n.so.<v>` by name while the CLR is still starting, before
# any managed `Main`, and calls `FailFast` when neither resolves. So `csc` on a machine with no ICU
# dies of SIGABRT — exit 134, nothing on stdout — while `readelf` and `ldd` report a complete
# closure, because a `dlopen`ed library appears in no ELF header. `libicudata` is not probed for
# directly; it arrives as `libicuuc`'s own `DT_NEEDED` and has to be here for `libicuuc` to load at
# all.
#
# WHY IT TRAVELS WITH THE TOOLCHAIN RATHER THAN BEING INSTALLED ON THE MACHINE. This tree is copied
# to the same absolute path into all twenty-seven `-gg` variants, and they do not agree about ICU.
# `node:24.18.0-bookworm-slim`, under twenty-six of them, ships none; `blender-gg`'s `ubuntu:26.04`
# ships `libicu78` because Blender's apt closure drags it in; and every image that installs the mesa
# stack — the render kinds `voxel-gg`, `mc-gg`, `material-gg` and the rest, and `full-stack-3d-gg`,
# which renders a 3D full-stack run's asset previews through Mesa's software Vulkan exactly as they
# do — ships `libicu72` because `mesa-vulkan-drivers` does. Not one of those Dockerfiles asks for an
# ICU. An arm whose health is decided by a package some unrelated tool pulled is an arm that works
# on some gg runs and not others — and that moves the next time any of those closures changes.
# That is constraint 1 of `containers/gg-toolchains/Dockerfile`, so the libraries go under
# `<home>/lib` and `crates/gg/src/sandbox/language/csharp.compile.rs` names that directory on
# `LD_LIBRARY_PATH` for every `dotnet` it runs. It is the Swift arm's arrangement
# (`scripts/ci/install-swift.sh`) reached from the same constraint; Swift's own vendored set does
# not rescue this one, because it carries `libicuuc` and `libicudata` for `libxml2` and not the
# `libicui18n` .NET also loads.
#
# NOT `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`, which would also start the compiler. It changes
# what Roslyn does with a program rather than what the machine gives it — string comparison, casing
# and culture all move to an invariant that is not this machine's — and this arm compiles
# `-deterministic` precisely so one program yields one assembly wherever it is compiled. Supplying
# the libraries keeps that promise; switching the compiler's globalization off would trade a loud
# crash for a difference nobody is measuring.
echo "Vendoring the ICU the .NET runtime loads at startup"
if ! command -v ar >/dev/null 2>&1; then
	echo "error: ar (binutils) is needed to unpack the ICU package this toolchain vendors." >&2
	exit 1
fi
# Resolved from Debian bookworm's own index rather than hard-coded, so a security update to ICU is
# picked up without a version bump here — and bookworm rather than the machine's own distribution
# because the rest of this tree is Microsoft's Debian build and because the version the loader
# probes for must be the same on every machine that installs it.
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
ICU_FILENAME="$(awk '$0=="Package: libicu72"{found=1} found&&/^Filename:/{print $2; exit}' "$WORK/Packages")"
if [ -z "$ICU_FILENAME" ]; then
	echo "error: Debian bookworm has no libicu72 for $DEB_ARCH." >&2
	exit 1
fi
curl -sSfL "https://deb.debian.org/debian/$ICU_FILENAME" -o "$WORK/libicu72.deb"
mkdir -p "$WORK/icu" "$INSTALL_DIR/lib"
(cd "$WORK/icu" && ar x "$WORK/libicu72.deb" && tar -xf data.tar.*)
# Three of the package's six libraries. `libicutu`, `libicuio` and `libicutest` are the transliterator
# utilities, the iostream wrapper and the test harness: nothing in the runtime's probe list names any
# of them. The symlinks beside each real file are copied with it, because the name the runtime
# `dlopen`s is the versioned soname rather than the file the package installs it as.
find "$WORK/icu" \( -name 'libicuuc.so.*' -o -name 'libicui18n.so.*' -o -name 'libicudata.so.*' \) \
	-exec cp -a {} "$INSTALL_DIR/lib/" \;
if ! gg_dotnet_icu_vendored "$INSTALL_DIR"; then
	echo "error: libicu72 for $DEB_ARCH did not carry all three of libicuuc, libicui18n and libicudata." >&2
	ls -l "$INSTALL_DIR/lib" >&2
	exit 1
fi

# --- the check ----------------------------------------------------------------------------------
#
# Not decoration. Everything above is a claim about which files a compiler needs, and the only way to
# be sure of one is to compile something — on a tree with the deletions already applied, which is
# what makes this catch a prune that went one directory too far.
#
# WHY THIS IS A COMPILE AND NOT AN `ldd` SWEEP, which is what the Swift arm's equivalent check is
# and which would be cheaper. This paragraph is the whole reason the ICU defect survived a
# verification step that already existed, so it is worth stating plainly: `ldd` walks `DT_NEEDED`,
# and the libraries this arm was missing are reached by `dlopen` from inside
# `libSystem.Globalization.Native.so`. They are named in no ELF header of anything in this tree, so
# `ldd` over every binary here reports a clean, fully resolved closure on a machine where `csc`
# cannot start. Swift's sweep works because Swift's problem is `DT_NEEDED` — `lld` really does link
# `libxml2.so.2` — and the identical sweep here would have passed for years while proving nothing.
# Only running the compiler answers the question.
#
# WHERE THAT LEAVES THE COMPILE BELOW. It names `<home>/lib` on `LD_LIBRARY_PATH` and nothing else,
# exactly as `csharp.compile.rs` does, so on a machine with NO system ICU it passes only because the
# vendoring worked — and `containers/gg-toolchains/Dockerfile` makes that the case where it matters,
# because its C# stage deliberately installs no ICU and the builder running this script therefore
# has nothing to fall back on. On a machine that does have ICU the check is weaker than it looks,
# and weaker than "first on the path wins": the runtime probes versioned sonames from newest down,
# so `blender-gg`'s Ubuntu 26.04 loads its own `libicuuc.so.78` whatever `<home>/lib` holds (which
# is measured, not assumed — `LD_DEBUG=libs` names the `/usr/lib` copy there). The vendored trio is
# a floor rather than an override. What covers the rest is the assertion above that all three files
# landed, and `gg selfcheck` run inside the built `-gg` images, which is the only place the
# question is asked of the environment a run actually gets.
echo "Verifying the pruned toolchain compiles C# against the vendored ICU"
cat >"$WORK/Check.cs" <<'EOF'
using System;
using System.Linq;
using System.Collections.Generic;
public static class Check {
    public static void Main() {
        List<int> squares = [.. Enumerable.Range(1, 4).Select(value => value * value)];
        Console.WriteLine(string.Join(",", squares));
    }
}
EOF
REFERENCES=()
for assembly in "$INSTALL_DIR/ref/$GG_DOTNET_TFM"/*.dll; do REFERENCES+=("-r:$assembly"); done
LD_LIBRARY_PATH="$INSTALL_DIR/lib" \
	"$INSTALL_DIR/dotnet/dotnet" exec "$INSTALL_DIR/roslyn/bincore/csc.dll" \
	-nologo -noconfig -nostdlib+ -target:exe "-langversion:$GG_DOTNET_LANG_VERSION" \
	-nullable:enable -optimize+ -deterministic \
	"${REFERENCES[@]}" -out:"$WORK/Check.dll" "$WORK/Check.cs"
test -s "$WORK/Check.dll"

# The stamp is written LAST, after the check rather than before it, which is where the Swift arm
# writes its own. A stamp written first is a tree that failed its verification and then claims to be
# installed: the next run of this script — and `install-gg-toolchains.sh` runs it on every reconcile
# — reads the stamp, agrees, and leaves the broken tree exactly where it is.
echo "$GG_DOTNET_SDK_VERSION" >"$STAMP"

echo "Installed .NET $GG_DOTNET_SDK_VERSION ($(du -sh "$INSTALL_DIR" | cut -f1)) at $INSTALL_DIR"
