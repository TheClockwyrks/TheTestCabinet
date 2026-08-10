#!/usr/bin/env bash
# Reflect the C# program language's signature catalogue out of the SDK's own XML documentation
# comments, and write it to crates/gg/src/sandbox/guests/csharp.signatures.json.
#
# WHY ROSLYN. Everything a model reads about this surface is written on the declaration it describes
# — a function's brief in its `<summary>`, its detail in its `<remarks>`, an argument's in that
# argument's `<param>`, a record component's in the `<param>` on the record, an enum constant's in
# the comment above it, a module's on the `static partial class` that IS the module, and a type's on
# its own declaration nested inside that module — and Roslyn reads all of it. It is also the
# compiler this arm runs on every turn, so the catalogue is reflected by the same reading of the same
# sources a model's program is compiled against, rather than by a second tool that could disagree
# with the first.
#
# WHAT THIS NEEDS. Only `scripts/ci/install-dotnet.sh`'s toolchain — the same ~122 MB tree that
# compiles a program. `Microsoft.CodeAnalysis.CSharp.dll` ships beside `csc.dll` in it, so nothing
# here fetches a package, and this script is runnable on any machine that can run this arm's tests.
#
# WHAT IT REFUSES. `tools/Signatures.cs` treats every Roslyn warning as fatal, including the
# documentation ones, and refuses to emit a catalogue with a blank anywhere in it. So a `<param>`
# naming an argument that is not there, a `<see cref>` pointing at nothing, an undocumented public
# member and an undocumented parameter each fail here rather than reaching a model.
#
# Usage:
#   packages/gg-sandbox-csharp/signatures.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/crates/gg/src/sandbox/guests/csharp.signatures.json"

# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$HERE/csharp-version.sh"

DOTNET_HOME="$(gg_dotnet_home)"
LAUNCHER="$DOTNET_HOME/dotnet/dotnet"
BINCORE="$DOTNET_HOME/roslyn/bincore"

if [ ! -x "$LAUNCHER" ] || [ ! -f "$BINCORE/Microsoft.CodeAnalysis.CSharp.dll" ]; then
	echo "error: no .NET toolchain at $DOTNET_HOME — run scripts/ci/install-dotnet.sh" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export DOTNET_ROOT="$DOTNET_HOME/dotnet"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

# The reflector runs beside Roslyn's own assemblies, because a .NET application with no `deps.json`
# resolves its dependencies out of its own directory. Symlinked rather than copied: they are 30 MB
# and they are read-only here.
for assembly in "$BINCORE"/*.dll; do
	ln -s "$assembly" "$WORK/$(basename "$assembly")"
done

{
	echo -nologo
	echo -nostdlib+
	echo -target:exe
	echo "-langversion:$GG_DOTNET_LANG_VERSION"
	echo -nullable:enable
	echo -warnaserror+
	echo "-main:Tools.Signatures"
	echo "-out:$WORK/Signatures.dll"
	find "$DOTNET_HOME/ref" -name '*.dll' | sort | sed 's/^/-r:/'
	echo "-r:$BINCORE/Microsoft.CodeAnalysis.dll"
	echo "-r:$BINCORE/Microsoft.CodeAnalysis.CSharp.dll"
	echo "$HERE/tools/Catalogue.cs"
	echo "$HERE/tools/Signatures.cs"
} >"$WORK/csc.rsp"

"$LAUNCHER" exec "$BINCORE/csc.dll" -noconfig "@$WORK/csc.rsp"

cat >"$WORK/Signatures.runtimeconfig.json" <<EOF
{
  "runtimeOptions": {
    "tfm": "$GG_DOTNET_TFM",
    "framework": { "name": "Microsoft.NETCore.App", "version": "$GG_DOTNET_RUNTIME_VERSION" },
    "configProperties": { "System.Reflection.Metadata.MetadataUpdater.IsSupported": false }
  }
}
EOF

"$LAUNCHER" exec "$WORK/Signatures.dll" \
	--sdk "$HERE/src/Gg" \
	--references "$DOTNET_HOME/ref" \
	--libraries "$HERE/libraries.txt" \
	--out "$WORK/csharp.signatures.json"

mv "$WORK/csharp.signatures.json" "$OUT"
echo "wrote $OUT ($(wc -c <"$OUT") bytes)"
