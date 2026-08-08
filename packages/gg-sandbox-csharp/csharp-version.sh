#!/usr/bin/env bash
# The pins the **C#** program language's guest and toolchain are built and run against.
#
# Sourced by `bindings.sh` and `build.sh`, by `scripts/ci/install-dotnet.sh` and by
# `containers/gg-toolchains/Dockerfile`, so there is one list rather than four.
#
# THIS ARM HAS TWO TOOLCHAINS AND ONLY ONE OF THEM SHIPS. `build.sh` needs a whole .NET SDK and a
# whole wasi-sdk to relink the guest, and it is a **developer's** command run once per pin bump
# whose output is committed. What a gg *run* needs is much smaller and is what
# `scripts/ci/install-dotnet.sh` installs: a .NET runtime, Roslyn, and the reference assemblies a
# program is compiled against. No wasm toolchain reaches a run container on this arm, because
# nothing about a C# program is compiled to wasm — the wasm was compiled once, here, and committed.
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
# toolchain silently a release ahead of the committed guest.
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
# arm's component is produced **once**, here, by a developer, and committed — so it is checked by
# every test run against the wasmtime gg links, and a component that arm's objection describes would
# fail in this checkout rather than inside somebody's run. What p2 buys is not cosmetic: .NET's
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
