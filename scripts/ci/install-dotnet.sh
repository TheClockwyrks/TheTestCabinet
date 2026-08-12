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
#   <home>/dotnet-version         what is installed, for idempotency
#
# THE REFERENCE ASSEMBLIES ARE THE POINT OF PINNING THIS AT ALL. They decide what a model's program
# may call, and they have to be the release the BCL inside the baked guest was cut from — a
# program compiled against 10.0.10 references and interpreted by a 10.0.9 runtime is a program whose
# `MissingMethodException` nobody would think to look for. That is why gg does not use a machine's
# own `dotnet` even when it is the same version.
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore) is left
# alone.
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

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$GG_DOTNET_SDK_VERSION" ] &&
	[ -x "$INSTALL_DIR/dotnet/dotnet" ] && [ -f "$INSTALL_DIR/roslyn/bincore/csc.dll" ]; then
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

echo "$GG_DOTNET_SDK_VERSION" >"$STAMP"

# --- the check ----------------------------------------------------------------------------------
#
# Not decoration. Everything above is a claim about which files a compiler needs, and the only way to
# be sure of one is to compile something — on a tree with the deletions already applied, which is
# what makes this catch a prune that went one directory too far.
echo "Verifying the pruned toolchain compiles C#"
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
"$INSTALL_DIR/dotnet/dotnet" exec "$INSTALL_DIR/roslyn/bincore/csc.dll" \
	-nologo -noconfig -nostdlib+ -target:exe "-langversion:$GG_DOTNET_LANG_VERSION" \
	-nullable:enable -optimize+ -deterministic \
	"${REFERENCES[@]}" -out:"$WORK/Check.dll" "$WORK/Check.cs"
test -s "$WORK/Check.dll"

echo "Installed .NET $GG_DOTNET_SDK_VERSION ($(du -sh "$INSTALL_DIR" | cut -f1)) at $INSTALL_DIR"
