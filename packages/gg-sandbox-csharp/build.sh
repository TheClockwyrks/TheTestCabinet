#!/usr/bin/env bash
# Build the one artifact gg carries for the **C#** program language, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   csharp.component.wasm    the guest — Mono's IL interpreter, the whole BCL, ICU, and gg's shell,
#                            as one self-contained wasm component
#
# WHAT THIS ARM IS, IN ONE PARAGRAPH. Microsoft publishes a Mono **IL interpreter** built for wasm,
# as static archives plus the C its own build compiles against them. This script relinks it with
# gg's `wit-bindgen` C bindings and `Sources/shell.c` into a component that exports gg's `sandbox`
# world, and bundles the .NET class libraries into the same module so the guest needs no
# filesystem, no preopen and no toolchain at run time. A model's C# is then compiled to IL **on the
# host** by Roslyn (~0.3 s) and crosses the membrane as base64 in the world's existing `program`
# string. It is the same shape as the Python and Ruby arms — one prebuilt runtime, a source-ish
# payload per turn — and the reason C# is affordable at all: the toolchain a prior study priced this
# arm out on compiles the *program* to native wasm and costs 25-43 s a turn.
#
# WHAT THIS SCRIPT NEEDS, AND WHY NONE OF IT REACHES A RUN. A whole .NET SDK and a whole, unpruned
# wasi-sdk — ~1.4 GB between them, and neither on the turn path. A run needs only the much smaller
# host toolchain `scripts/ci/install-dotnet.sh` installs (a runtime, Roslyn, reference assemblies),
# because nothing about a C# program is compiled to wasm: the wasm is what this script produces.
#
# WHY THE FULL wasi-sdk RATHER THAN THE SHARED PRUNED ONE. `scripts/ci/install-wasi-sdk.sh` keeps
# exactly the one target the C++ arm compiles to, `wasm32-wasip1`, and deletes the `noeh` libc++ this
# script's link line names. This arm needs `wasm32-wasip2` — see `csharp-version.sh` for why, in one
# sentence: .NET's native library calls `socket` and `getaddrinfo`, which wasi-libc supplies only
# there. Widening the shared installer would mean shipping more in every gg run image to serve a
# build no run image performs, so the two trees are separately prefixed instead.
#
# WHERE THOSE TWO COME FROM. `gg_dotnet_build_sdk_home` and `gg_wasi_sdk_build_home` in
# `csharp-version.sh` resolve them: the build prefix
# `scripts/ci/install-gg-build-toolchains.sh` populates if it is there, and this package's own
# `.build/` otherwise — which is where this script used to fetch them itself, so a developer with
# neither prefix is in exactly the state they were in before, and one who ran that installer
# reaches nothing at all.
#
# Usage:
#   scripts/ci/install-gg-build-toolchains.sh   # once, unless you want the ~1.4 GB fetched below
#   scripts/gg-artifacts.sh                                      # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-csharp/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$HERE/csharp-version.sh"

# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$HERE"

BUILD="$HERE/.build"
STAGE="$BUILD/stage"
BINDINGS="$BUILD/bindings"

DOTNET_SDK_DIR="$(gg_dotnet_build_sdk_home)"
WASI_SDK_DIR="$(gg_wasi_sdk_build_home)"

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
PACK_DIR="$(gg_dotnet_runtime_pack_home)"
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
mkdir -p "$STAGE/bundle"

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
# `System.Net.Http.dll` is EXCLUDED FROM THE SCAN AND KEPT IN THE BUNDLE, and the difference between
# those two lists is this arm's one deliberate subtraction from the class library. Its WASI handler
# is a set of `[DllImport]`s against `wasi:http/outgoing-handler@0.2.0`, which is not an interface
# gg's world declares and not one gg's linker defines — so SCANNING it produces a component that
# cannot be encoded at all ("module requires an import interface named
# `wasi:http/outgoing-handler@0.2.0`"). BUNDLING it costs nothing and is what makes the assembly
# loadable, so `Uri`, `HttpMethod` and the rest of the vocabulary work and only the transport under
# `HttpClient` is gone. The two item groups exist for exactly that: one assembly is in the bundle and
# not in the scan, and it was in neither until a program that named the type failed to load it.
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
      <Assembly Include="$MANAGED/*.dll" />
      <Assembly Include="$NATIVE/System.Private.CoreLib.dll" />
      <Scanned Include="@(Assembly)" Exclude="$MANAGED/System.Net.Http.dll" />
      <PInvokeModule Include="libSystem.Native" />
      <PInvokeModule Include="libSystem.IO.Compression.Native" />
      <PInvokeModule Include="libSystem.Globalization.Native" />
      <IcuData Include="$NATIVE/icudt.dat" />
      <ParsedConfig Include="$STAGE/runtimeconfig.bin" />
    </ItemGroup>
    <ManagedToNativeGenerator Assemblies="@(Scanned)" PInvokeModules="@(PInvokeModule)"
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
# the artifact self-contained, and what keeps the class libraries out of a run's own working
# directory where a model would find them.
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
"$CLANG" "${CFLAGS[@]}" -c -o "$STAGE/bridge.o" "$HERE/Sources/bridge.c"
"$CLANG" "${CFLAGS[@]}" -c -o "$STAGE/m2n.o" "$HERE/Sources/m2n.c"

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
	"$STAGE/synthetic-pthread.o" "$STAGE/sandbox.o" "$STAGE/shell.o" "$STAGE/bridge.o" "$STAGE/m2n.o" \
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

cp "$STAGE/csharp.component.wasm" "$GG_ARTIFACTS_OUT_DIR/csharp.component.wasm"

# WHAT USED TO BE THE LAST STEP: `csharp.toolchain.json`, written beside the component — the pins the
# build read, the `clang` that linked it, the component's own byte count, the SHA-256 of each of the
# three C sources above, and how many assemblies were bundled. It is gone, and it is the one
# declaration of its kind that went rather than moving into `$GG_ARTIFACTS_OUT_DIR` with its arm.
#
# THE DIFFERENCE IS WHO READ IT. Every other arm's `*.toolchain.json` / `*.compiler.json` is read at
# RUN TIME by that arm's `*.compile.rs` — the crate list and `extern` flags the Rust arm links with,
# the header list the C++ prelude includes, the module list `swiftc` is given, the Opal release the
# Ruby arm reports. Those are content declarations gg itself consumes, so they are artifacts and they
# are generated like artifacts. This one was consumed by nothing on the turn path. Its only reader
# was `csharp.manifest.test.rs`, and that file's whole subject was whether the COMMITTED component
# matched the checkout beside it — the question a generated component does not have.
#
# NOTHING IT RECORDED IS LOST, WHICH IS WHY DELETING IT COSTS NOTHING:
#
#   the pins            are `csharp-version.sh`, which is where this script reads them from and is
#                       the only place they are declared. A JSON copy of a shell variable is a second
#                       spelling of one fact.
#   the source digests  were a way of asking whether the component was cut after the last edit to
#                       `Sources/`. That directory is in this arm's rerun set in
#                       `crates/gg-sandbox-artifacts/build-support`, so it is cut after every edit.
#   the byte count      was a way of pairing the declaration with the component. There is one
#                       artifact now and nothing to pair it with.
#   `clang` and the     were never read by anything. They are printed by the build instead, above,
#   assembly count      where somebody watching a 26-second link can see them.
#
# The one cross-language invariant that gate really held — `csharp.compile.rs` and `csharp-version.sh`
# agreeing about which C# a model may write, which no rerun set can enforce because the two are not
# inputs to one another — survives in `crates/gg/src/sandbox/language/csharp.pins.test.rs`.

echo "==> done"
ls -la "$GG_ARTIFACTS_OUT_DIR/csharp.component.wasm"
