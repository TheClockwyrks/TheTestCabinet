#!/usr/bin/env bash
# Build the two artifacts gg carries for the **C#** program language, and commit them:
#
#   crates/gg/src/sandbox/guests/csharp.component.wasm    the guest — Mono's IL interpreter, the
#                                                         whole BCL, ICU, and gg's shell, as one
#                                                         self-contained wasm component
#   crates/gg/src/sandbox/checkers/csharp.toolchain.json  what built it, and what is in it
#
# WHAT THIS ARM IS, IN ONE PARAGRAPH. Microsoft publishes a Mono **IL interpreter** built for wasm,
# as static archives plus the C its own build compiles against them. This script relinks it with
# gg's `wit-bindgen` C bindings and `Sources/shell.c` into a component that exports gg's `sandbox`
# world, and bundles the .NET class libraries into the same module so the guest needs no
# filesystem, no preopen and no toolchain at run time. A model's C# is then compiled to IL **on the
# host** by Roslyn (~0.3 s) and crosses the membrane as base64 in the world's existing `program`
# string. It is the same shape as the Python and Ruby arms — one committed runtime, a source-ish
# payload per turn — and the reason C# is affordable at all: the toolchain a prior study priced this
# arm out on compiles the *program* to native wasm and costs 25-43 s a turn.
#
# WHAT THIS SCRIPT NEEDS, AND WHY NONE OF IT REACHES A RUN. A whole .NET SDK and a whole wasi-sdk,
# both fetched into `.build/` below and both ~200 MB installed. Neither is in the gg toolchain image
# and neither is on the turn path: this output is committed, so a run needs only the much smaller
# host toolchain `scripts/ci/install-dotnet.sh` installs (a runtime, Roslyn, reference assemblies).
#
# WHY THE FULL wasi-sdk RATHER THAN THE SHARED PRUNED ONE. `scripts/ci/install-wasi-sdk.sh` keeps
# exactly the one target the C++ arm compiles to, `wasm32-wasip1`. This arm needs `wasm32-wasip2` —
# see `csharp-version.sh` for why, in one sentence: .NET's native library calls `socket` and
# `getaddrinfo`, which wasi-libc supplies only there. Rather than widen the shared installer for a
# toolchain no *run* needs, this developer-only script fetches its own copy.
#
# NOTHING IN CI RUNS THIS. It is a developer's command, run deliberately and committed with its
# output, and `scripts/ci/contract-drift.sh` names this arm's artifacts in its `$declared`
# exemption for that reason.
#
# Usage:
#   packages/gg-sandbox-csharp/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$HERE/csharp-version.sh"

BUILD="$HERE/.build"
STAGE="$BUILD/stage"
BINDINGS="$BUILD/bindings"
GUESTS="$ROOT/crates/gg/src/sandbox/guests"
CHECKERS="$ROOT/crates/gg/src/sandbox/checkers"

DOTNET_SDK_DIR="$BUILD/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
WASI_SDK_DIR="$BUILD/wasi-sdk-$GG_WASI_SDK_VERSION-full"

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export DOTNET_ROOT="$DOTNET_SDK_DIR"
export PATH="$DOTNET_SDK_DIR:$PATH"

# --- the two toolchains ------------------------------------------------------------------------

if [ ! -x "$DOTNET_SDK_DIR/dotnet" ]; then
	echo "==> fetching the .NET SDK $GG_DOTNET_SDK_VERSION ($(gg_dotnet_architecture))"
	mkdir -p "$DOTNET_SDK_DIR"
	curl -sSfL https://dot.net/v1/dotnet-install.sh -o "$BUILD/dotnet-install.sh"
	chmod +x "$BUILD/dotnet-install.sh"
	"$BUILD/dotnet-install.sh" --channel "$GG_DOTNET_CHANNEL" --version "$GG_DOTNET_SDK_VERSION" \
		--architecture "$(gg_dotnet_architecture)" --install-dir "$DOTNET_SDK_DIR" --no-path
fi

if [ ! -x "$WASI_SDK_DIR/bin/wasm-component-ld" ]; then
	echo "==> fetching the full wasi-sdk $GG_WASI_SDK_VERSION ($(gg_wasi_sdk_platform))"
	rm -rf "$WASI_SDK_DIR"
	mkdir -p "$WASI_SDK_DIR"
	curl -sSfL "$(gg_wasi_sdk_url)" | tar -xz -C "$WASI_SDK_DIR" --strip-components=1
fi

# The Mono WASI runtime pack, straight off nuget rather than out of the SDK's `packs/`, so this
# script depends on the pin in `csharp-version.sh` and not on which workloads happen to be installed.
PACK_DIR="$BUILD/$GG_DOTNET_MONO_WASI_PACK.$GG_DOTNET_RUNTIME_VERSION"
if [ ! -d "$PACK_DIR/runtimes/wasi-wasm/native" ]; then
	echo "==> fetching $GG_DOTNET_MONO_WASI_PACK $GG_DOTNET_RUNTIME_VERSION"
	rm -rf "$PACK_DIR"
	mkdir -p "$PACK_DIR"
	lower="$(echo "$GG_DOTNET_MONO_WASI_PACK" | tr '[:upper:]' '[:lower:]')"
	curl -sSfL "https://api.nuget.org/v3-flatcontainer/$lower/$GG_DOTNET_RUNTIME_VERSION/$lower.$GG_DOTNET_RUNTIME_VERSION.nupkg" \
		-o "$BUILD/mono-wasi.nupkg"
	unzip -q -o "$BUILD/mono-wasi.nupkg" -d "$PACK_DIR"
	rm -f "$BUILD/mono-wasi.nupkg"
fi

NATIVE="$PACK_DIR/runtimes/wasi-wasm/native"
MANAGED="$PACK_DIR/runtimes/wasi-wasm/lib/$GG_DOTNET_TFM"
CLANG="$WASI_SDK_DIR/bin/clang"
SYSROOT_LIB="$WASI_SDK_DIR/share/wasi-sysroot/lib/$GG_CSHARP_TARGET"
WASI_TASKS="$DOTNET_SDK_DIR/packs/Microsoft.NET.Runtime.WebAssembly.Wasi.Sdk/$GG_DOTNET_RUNTIME_VERSION/tasks/$GG_DOTNET_TFM/WasmAppBuilder.dll"
MONO_TASKS="$DOTNET_SDK_DIR/packs/Microsoft.NET.Runtime.MonoTargets.Sdk/$GG_DOTNET_RUNTIME_VERSION/tasks/$GG_DOTNET_TFM/MonoTargetsTasks.dll"

if [ ! -f "$WASI_TASKS" ] || [ ! -f "$MONO_TASKS" ]; then
	echo "==> installing the wasi-experimental workload (for its build tasks)"
	dotnet workload install wasi-experimental --skip-manifest-update >/dev/null
fi
test -f "$WASI_TASKS"
test -f "$MONO_TASKS"

echo "==> bindings"
"$HERE/bindings.sh" >/dev/null

rm -rf "$STAGE"
mkdir -p "$STAGE/bundle" "$GUESTS" "$CHECKERS"

# --- what the runtime pack's own build generates -------------------------------------------------
#
# Three generated inputs, and all three are produced by the runtime pack's OWN MSBuild tasks rather
# than by anything written here. That is the difference between relinking Mono and reimplementing
# its build:
#
#   pinvoke-table.h / wasm_m2n_invoke.g.h  every `[DllImport]` in the BCL, resolved to the static
#                                          symbol that answers it, plus the interpreter's
#                                          managed-to-native thunks. Reflected out of the assemblies
#                                          themselves — 141 entries for `libSystem.Native` alone.
#   runtimeconfig.bin                      the runtime configuration `monovm` initialises from.
#   bundle/*.o                             the BCL, ICU and that configuration, as wasm objects the
#                                          runtime registers as bundled resources.
#
# `System.Net.Http.dll` is EXCLUDED from the scan, and this is the arm's one deliberate subtraction
# from the class library. Its WASI handler is a set of `[DllImport]`s against
# `wasi:http/outgoing-handler@0.2.0`, which is not an interface gg's world declares and not one gg's
# linker defines — so scanning it produces a component that cannot be encoded at all ("module
# requires an import interface named `wasi:http/outgoing-handler@0.2.0`"). The assembly is still
# bundled, so the types exist and a program compiles against them; what is absent is the native
# handler underneath `HttpClient`. A program has `shell` for the network, like every other arm.
echo "==> generating the runtime's link inputs"
cat >"$STAGE/runtimeconfig.json" <<EOF
{
  "runtimeOptions": {
    "tfm": "$GG_DOTNET_TFM",
    "framework": { "name": "Microsoft.NETCore.App", "version": "$GG_DOTNET_RUNTIME_VERSION" },
    "configProperties": {}
  }
}
EOF

cat >"$STAGE/generate.proj" <<EOF
<Project DefaultTargets="Generate">
  <UsingTask TaskName="Microsoft.WebAssembly.Build.Tasks.ManagedToNativeGenerator" AssemblyFile="$WASI_TASKS" TaskFactory="TaskHostFactory" />
  <UsingTask TaskName="RuntimeConfigParserTask" AssemblyFile="$MONO_TASKS" TaskFactory="TaskHostFactory" />
  <UsingTask TaskName="EmitBundleObjectFiles" AssemblyFile="$MONO_TASKS" TaskFactory="TaskHostFactory" />
  <Target Name="Generate">
    <ItemGroup>
      <Assembly Include="$MANAGED/*.dll" Exclude="$MANAGED/System.Net.Http.dll" />
      <Assembly Include="$NATIVE/System.Private.CoreLib.dll" />
      <PInvokeModule Include="libSystem.Native" />
      <PInvokeModule Include="libSystem.IO.Compression.Native" />
      <PInvokeModule Include="libSystem.Globalization.Native" />
      <IcuData Include="$NATIVE/icudt.dat" />
      <ParsedConfig Include="$STAGE/runtimeconfig.bin" />
    </ItemGroup>
    <ManagedToNativeGenerator Assemblies="@(Assembly)" PInvokeModules="@(PInvokeModule)"
      PInvokeOutputPath="$STAGE/pinvoke-table.h"
      InterpToNativeOutputPath="$STAGE/wasm_m2n_invoke.g.h"
      CacheFilePath="$STAGE/m2n-cache.json" />
    <RuntimeConfigParserTask RuntimeConfigFile="$STAGE/runtimeconfig.json" OutputFile="$STAGE/runtimeconfig.bin" />
    <EmitBundleObjectFiles FilesToBundle="@(Assembly)" ClangExecutable="$CLANG"
      BundleRegistrationFunctionName="mono_register_assemblies_bundle"
      BundleFile="wasi_bundled_assemblies.o" OutputDirectory="$STAGE/bundle/" />
    <EmitBundleObjectFiles FilesToBundle="@(IcuData)" ClangExecutable="$CLANG"
      BundleRegistrationFunctionName="mono_register_icu_bundle"
      BundleFile="wasi_bundled_icu.o" OutputDirectory="$STAGE/bundle/" />
    <EmitBundleObjectFiles FilesToBundle="@(ParsedConfig)" ClangExecutable="$CLANG"
      BundleRegistrationFunctionName="mono_register_runtimeconfig_bin"
      BundleFile="wasi_bundled_runtimeconfig_bin.o" OutputDirectory="$STAGE/bundle/" />
  </Target>
</Project>
EOF
dotnet msbuild "$STAGE/generate.proj" -v:q -nologo

# --- the compile -------------------------------------------------------------------------------
#
# `-DGEN_PINVOKE=1` selects the generated table above over the runtime pack's absent default, and
# `-DWASM_SINGLE_FILE=1` selects the bundled BCL over one read off a filesystem — which is what makes
# the committed artifact self-contained, and what keeps the class libraries out of a run's own
# working directory where a model would find them.
echo "==> compiling"
CFLAGS=(--target="$GG_CSHARP_TARGET" -O2
	-I"$NATIVE/include/wasm" -I"$NATIVE/include/mono-2.0" -I"$STAGE" -I"$BINDINGS"
	-DGEN_PINVOKE=1 -DWASM_SINGLE_FILE=1
	-ffile-prefix-map="$HERE=/gg-sandbox-csharp")

for source in driver runtime pinvoke stubs synthetic-pthread; do
	"$CLANG" "${CFLAGS[@]}" -c -o "$STAGE/$source.o" "$NATIVE/src/$source.c"
done
"$CLANG" "${CFLAGS[@]}" -c -o "$STAGE/sandbox.o" "$BINDINGS/sandbox.c"
"$CLANG" "${CFLAGS[@]}" -c -o "$STAGE/shell.o" "$HERE/Sources/shell.c"

# --- the link ----------------------------------------------------------------------------------
#
# The archive list is the runtime pack's own, with the three optional components taken as **stubs**:
# the managed debugger (there is no debugger to attach and its non-stub half wants a TCP listener),
# hot reload, and the diagnostics tracing server. `marshal-ilgen` is NOT a stub — it is what
# generates the interpreter's marshalling for a `[DllImport]`, and without it the BCL's own native
# calls fail at the first `Console.Write`.
#
# `-mexec-model=reactor` is what makes this a component with exported functions rather than a
# command with a `main`: gg calls `run`, nothing calls the guest's entry point, and there is no
# `_start`.
#
# ONE LINKER WARNING IS EXPECTED AND IS NOT SUPPRESSED. `wasm-ld` reports a signature mismatch
# for `descriptor_table_get_ref` between `libSystem.Native.a(pal_networking.c.obj)` and this
# wasi-sdk's `libc.a`: .NET's socket layer was built against an older wasi-libc where that
# internal helper took two arguments. It is confined to the socket path — nothing else in the
# runtime references it — and it is left visible rather than silenced, because a warning that
# stops being printed is a warning nobody re-reads when the pin moves.
echo "==> linking"
"$CLANG" --target="$GG_CSHARP_TARGET" -O2 -mexec-model=reactor \
	-o "$STAGE/csharp.component.wasm" \
	"$STAGE/driver.o" "$STAGE/runtime.o" "$STAGE/pinvoke.o" "$STAGE/stubs.o" \
	"$STAGE/synthetic-pthread.o" "$STAGE/sandbox.o" "$STAGE/shell.o" \
	"$STAGE"/bundle/*.o "$BINDINGS/sandbox_component_type.o" \
	"$NATIVE/libmono-component-debugger-stub-static.a" \
	"$NATIVE/libmono-component-hot_reload-stub-static.a" \
	"$NATIVE/libmono-component-diagnostics_tracing-stub-static.a" \
	"$NATIVE/libmono-component-marshal-ilgen-static.a" \
	"$NATIVE/libmono-ee-interp.a" "$NATIVE/libmono-icall-table.a" "$NATIVE/libmono-wasm-nosimd.a" \
	"$NATIVE/libmonosgen-2.0.a" "$NATIVE/wasm-bundled-timezones.a" \
	"$NATIVE/libSystem.Native.a" "$NATIVE/libSystem.Globalization.Native.a" \
	"$NATIVE/libSystem.IO.Compression.Native.a" \
	"$NATIVE/libicui18n.a" "$NATIVE/libicuuc.a" "$NATIVE/libicudata.a" \
	"$NATIVE/libbrotlienc.a" "$NATIVE/libbrotlidec.a" "$NATIVE/libbrotlicommon.a" "$NATIVE/libz.a" \
	"$SYSROOT_LIB/noeh/libc++.a" "$SYSROOT_LIB/noeh/libc++abi.a" \
	-lwasi-emulated-process-clocks -lwasi-emulated-signal -lwasi-emulated-mman \
	-Wl,-z,stack-size=8388608,--initial-memory=52428800

cp "$STAGE/csharp.component.wasm" "$GUESTS/csharp.component.wasm"

echo "==> csharp.toolchain.json"
{
	printf '{\n'
	printf '  "dotnetSdk": "%s",\n' "$GG_DOTNET_SDK_VERSION"
	printf '  "dotnetRuntime": "%s",\n' "$GG_DOTNET_RUNTIME_VERSION"
	printf '  "targetFramework": "%s",\n' "$GG_DOTNET_TFM"
	printf '  "languageVersion": "%s",\n' "$GG_DOTNET_LANG_VERSION"
	printf '  "runtimePack": "%s",\n' "$GG_DOTNET_MONO_WASI_PACK"
	printf '  "wasiSdk": "%s",\n' "$GG_WASI_SDK_VERSION"
	printf '  "clang": "%s",\n' "$("$CLANG" --version | head -1 | sed 's/^clang version //; s/ (.*//')"
	printf '  "target": "%s",\n' "$GG_CSHARP_TARGET"
	printf '  "witBindgen": "%s",\n' "$GG_WIT_BINDGEN_VERSION"
	printf '  "componentBytes": %s,\n' "$(stat -c%s "$GUESTS/csharp.component.wasm")"
	printf '  "shellSha256": "%s",\n' "$(sha256sum "$HERE/Sources/shell.c" | cut -d' ' -f1)"
	printf '  "excludedAssemblies": ["System.Net.Http.dll"],\n'
	printf '  "bundledAssemblies": %s\n' "$(find "$MANAGED" -name '*.dll' ! -name 'System.Net.Http.dll' | wc -l | tr -d ' ')"
	printf '}\n'
} >"$CHECKERS/csharp.toolchain.json"

echo "==> done"
ls -la "$GUESTS/csharp.component.wasm" "$CHECKERS/csharp.toolchain.json"
