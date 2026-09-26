#!/usr/bin/env bash
# The pins the **C#** program language's guest and toolchain are built and run against.
#
# Sourced by `bindings.sh` and `build.sh`, by `scripts/ci/install-dotnet.sh` and by
# `containers/gg-toolchains/Dockerfile`, so there is one list rather than four.
#
# THIS ARM HAS TWO TOOLCHAINS AND ONLY ONE OF THEM SHIPS. `build.sh` needs a whole .NET SDK and a
# whole, unpruned wasi-sdk to relink the guest. What a gg *run* needs is much smaller and is what
# `scripts/ci/install-dotnet.sh` installs: a .NET runtime, Roslyn, and the reference assemblies a
# program is compiled against. No wasm toolchain reaches a run container on this arm, because
# nothing about a C# program is compiled to wasm — the wasm is compiled once, by `build.sh`, and
# carried inside gg's binary.
#
# The two are kept in two SEPARATELY PREFIXED trees rather than one widened tree, and the functions
# at the foot of this file are what resolve each. See `gg_dotnet_build_sdk_home` for the argument.
set -euo pipefail

CSHARP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The .NET SDK release Roslyn is cut from and the runtime pack is taken at.
#
# ONE PIN FOR BOTH HALVES, deliberately. The compiler that reads a model's C# on the host and the
# BCL that runs it inside the guest are two sides of one release: a program compiled against
# `10.0.10` reference assemblies and interpreted by a `10.0.9` `System.Private.CoreLib` is a program
# whose `MissingMethodException` nobody would think to look for. The SDK band and the runtime it
# carries are spelled separately because Microsoft versions them separately — an SDK `10.0.3xx`
# carries runtime `10.0.x` — and both are checked at install.
GG_DOTNET_SDK_VERSION="10.0.302"
GG_DOTNET_RUNTIME_VERSION="10.0.10"

# The band `dotnet-install.sh` is asked for. It resolves to the SDK version above; the installer
# asserts that it did, so a channel that has moved on is an install-time failure rather than a
# toolchain silently a release ahead of the guest each build cuts.
GG_DOTNET_CHANNEL="10.0"

# The target framework moniker a model's program is compiled for. It names the reference assembly
# directory and it is what `runtimeconfig.json` inside the guest declares.
GG_DOTNET_TFM="net10.0"

# The C# language version a model's program is compiled as.
#
# `latest` is deliberately NOT taken: it means "whatever this Roslyn is", so a toolchain bump would
# silently change what a model may write and what the study is measuring. `14.0` is what SDK
# 10.0.3xx ships as its stable default — collection expressions, primary constructors, `field`
# keyword and extension members are all in it.
GG_DOTNET_LANG_VERSION="14.0"

# The Mono **WASI Preview 2** runtime pack the guest is relinked from.
#
# This is the piece that makes the arm affordable, and it is worth saying what it is: Microsoft
# publishes, on nuget.org, the whole of Mono's wasm build as static archives (`libmonosgen-2.0.a`,
# `libmono-ee-interp.a`, …) plus the C the runtime pack's own build compiles against them
# (`src/driver.c`, `src/runtime.c`, `src/pinvoke.c`). Relinking it with gg's shell and gg's WIT
# bindings is therefore the pack's own supported build, not a research exercise — the only thing gg
# adds is one more translation unit.
#
# It is the runtime version above, not the SDK version: the pack is versioned with the runtime.
GG_DOTNET_MONO_WASI_PACK="Microsoft.NETCore.App.Runtime.Mono.wasi-wasm"

# The wasi-sdk release the guest is linked by — the same release the C++ arm compiles with, read
# from that arm's own file rather than restated, so the two cannot drift.
#
# THE TARGET IS `wasm32-wasip2` AND THE C++ ARM'S IS NOT, and the reason the two differ is the
# reason that arm gives for its own choice. The C++ arm compiles a component **per turn** and will
# not instantiate one produced by a `wasm-component-ld` whose encoder gg does not version. This
# arm's component is produced **once per build** rather than once per turn, by this checkout's
# `build.sh` into `crates/gg-sandbox-artifacts/csharp`'s `OUT_DIR` — so the component every test run
# instantiates against the wasmtime gg links is the same component the build just linked, and an
# encoder mismatch of the kind that arm objects to fails here rather than inside somebody's run.
# (That argument used to rest on the component being cut by hand and committed, which made it a
# claim about a developer's habits; it rests on the build now, which is stronger.) What p2 buys is
# not cosmetic: .NET's
# `libSystem.Native.a` calls `socket`, `getaddrinfo` and `getnameinfo`, which wasi-libc supplies
# **only** for p2. On p1 the guest does not link at all.
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$CSHARP_ROOT/packages/gg-sandbox-cpp/cpp-version.sh"
GG_CSHARP_TARGET="wasm32-wasip2"

export GG_DOTNET_SDK_VERSION GG_DOTNET_RUNTIME_VERSION GG_DOTNET_CHANNEL GG_DOTNET_TFM
export GG_DOTNET_LANG_VERSION GG_DOTNET_MONO_WASI_PACK GG_CSHARP_TARGET CSHARP_ROOT

# The platform build of the .NET SDK for this machine, in `dotnet-install.sh`'s own vocabulary.
gg_dotnet_architecture() {
	case "$(uname -m)" in
	x86_64) echo "x64" ;;
	aarch64 | arm64) echo "arm64" ;;
	*)
		echo "error: no pinned .NET build for $(uname -m)." >&2
		return 1
		;;
	esac
}

# Where this arm's host toolchain is, in the order gg itself looks — see `dotnet_home` in
# `crates/gg/src/sandbox/language/csharp.compile.rs`, which must agree with this.
GG_DOTNET_DEFAULT_HOME="$HOME/.local/share/tcab/gg-dotnet"
GG_DOTNET_IMAGE_HOME="/opt/gg/toolchains/dotnet"

gg_dotnet_home() {
	if [ -n "${TCAB_GG_DOTNET_HOME:-}" ]; then
		echo "$TCAB_GG_DOTNET_HOME"
		return 0
	fi
	if [ -x "$GG_DOTNET_IMAGE_HOME/dotnet/dotnet" ]; then
		echo "$GG_DOTNET_IMAGE_HOME"
		return 0
	fi
	echo "$GG_DOTNET_DEFAULT_HOME"
}

export GG_DOTNET_DEFAULT_HOME GG_DOTNET_IMAGE_HOME

# ------------------------------------------------------------------------------------------------
# The BUILD-capable toolchains — the second of this arm's two, and the one no run ever sees.
# ------------------------------------------------------------------------------------------------
#
# WHY A SECOND PREFIX RATHER THAN WIDENING THE FIRST. The two run prefixes above are PRUNED, hard:
# `scripts/ci/install-wasi-sdk.sh` keeps exactly `wasm32-wasip1` and deletes four sysroot targets
# including the `noeh` variants, and `scripts/ci/install-dotnet.sh` keeps a runtime, Roslyn and the
# reference assemblies and deletes MSBuild, NuGet and every workload. Both prunings are deliberate
# and both must STAY exact, because those installers' idempotence checks are what let every surface
# re-run `install-gg-toolchains.sh` cheaply: a `wasm32-wasip2` sysroot appearing under
# `~/.local/share/tcab/gg-wasi-sdk` would leave that tree no longer equal to what its installer
# writes, and the next reconcile would either miss it or delete it.
#
# And this arm genuinely needs what those prunings remove. The link line in `build.sh` names
# `$SYSROOT_LIB/noeh/libc++.a` under `wasm32-wasip2` — a target the run installer drops and a
# directory it explicitly deletes — and the guest's link inputs are generated by MSBuild tasks that
# only exist once the `wasi-experimental` workload is installed. Widening would mean deleting less
# from every run image to serve a build nothing in a run image does.
#
# So: a second tree, separately prefixed, populated by `scripts/ci/install-gg-build-toolchains.sh`,
# which is deliberately NOT called from `install-gg-toolchains.sh` — that script's list is the
# ELEVEN ARMS a run needs, and adding ~1.4 GB of developer toolchain to it would change what every
# gg toolchain image costs. The names below mirror `build.sh`'s own `.build/` names, so a developer
# who has neither prefix falls through to exactly the tree that script used to fetch for itself and
# nothing about their workflow changes.
GG_BUILD_PREFIX="${TCAB_GG_BUILD_PREFIX:-$HOME/.local/share/tcab/gg-build}"

# The whole .NET SDK, with the `wasi-experimental` workload installed for its build tasks.
gg_dotnet_build_sdk_home() {
	if [ -x "$GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION/dotnet" ]; then
		echo "$GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
		return 0
	fi
	echo "$CSHARP_ROOT/packages/gg-sandbox-csharp/.build/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
}

# The Mono WASI runtime pack, unpacked. Taken straight off nuget rather than out of the SDK's
# `packs/`, so the guest depends on the pin above and not on which workloads happen to be installed —
# which is why it is resolved separately from the SDK even though it usually sits beside it.
gg_dotnet_runtime_pack_home() {
	local stamp="$GG_DOTNET_MONO_WASI_PACK.$GG_DOTNET_RUNTIME_VERSION"
	if [ -d "$GG_BUILD_PREFIX/$stamp/runtimes/wasi-wasm/native" ]; then
		echo "$GG_BUILD_PREFIX/$stamp"
		return 0
	fi
	echo "$CSHARP_ROOT/packages/gg-sandbox-csharp/.build/$stamp"
}

# The unpruned wasi-sdk, with every sysroot target the release publishes.
gg_wasi_sdk_build_home() {
	if [ -x "$GG_BUILD_PREFIX/wasi-sdk-$GG_WASI_SDK_VERSION-full/bin/clang" ]; then
		echo "$GG_BUILD_PREFIX/wasi-sdk-$GG_WASI_SDK_VERSION-full"
		return 0
	fi
	echo "$CSHARP_ROOT/packages/gg-sandbox-csharp/.build/wasi-sdk-$GG_WASI_SDK_VERSION-full"
}

export GG_BUILD_PREFIX
