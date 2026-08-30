#!/usr/bin/env bash
# Install the toolchains that BUILDING gg's C# guest requires and that a gg RUN deliberately does
# not: a whole .NET SDK with the `wasi-experimental` workload, an unpruned wasi-sdk, and the Mono
# WASI runtime pack the guest is relinked from.
#
# WHY THIS IS A SEPARATE SCRIPT FROM `install-gg-toolchains.sh`, AND MUST STAY ONE.
#
# That script's list is the ELEVEN ARMS — every toolchain a gg run and gg's own reflectors execute,
# ~1.9 GB, run by the devcontainer image, both CI systems, the release workflow, the driver image's
# gg stage and `containers/gg-ci/Dockerfile`. Every one of those surfaces would pay for anything
# added to it. What is here is ~1.4 GB more, needed by exactly one build of exactly one arm, and
# needed by no run at all — so it is its own list, called by the one stage and the one developer that
# want it, and the eleven-arm list keeps its meaning.
#
# WHY IT IS A SECOND PREFIX AND NOT A WIDENING OF THE RUN ONE. The full argument is in
# `packages/gg-sandbox-csharp/csharp-version.sh`, beside the two functions that resolve these paths.
# The short version: `install-wasi-sdk.sh` and `install-dotnet.sh` PRUNE hard and their idempotence
# checks are what make re-running the eleven-arm list cheap on every surface, so anything appearing
# inside their prefixes that they did not write leaves the tree unequal to what they produce and the
# next reconcile either misses it or deletes it. Two trees, two prefixes, two questions.
#
#     ~/.local/share/tcab/gg-build/dotnet-sdk-<version>                 a whole SDK
#     ~/.local/share/tcab/gg-build/wasi-sdk-<version>-full              every sysroot target
#     ~/.local/share/tcab/gg-build/<runtime-pack>.<runtime-version>     Mono for wasi-wasm
#
# IDEMPOTENT, like every installer here: each of the three checks what is already there against its
# pin and exits without touching the network when they match. The checks are the same ones
# `packages/gg-sandbox-csharp/build.sh` makes, deliberately — a machine warmed by this script and a
# machine that warmed itself have to be in the same state, or the fallback in `csharp-version.sh`
# would resolve to one tree while the build tested for the other.
#
# Usage:
#   scripts/ci/install-gg-build-toolchains.sh
#   TCAB_GG_BUILD_PREFIX=/opt/gg/build scripts/ci/install-gg-build-toolchains.sh
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$REPO_ROOT/packages/gg-sandbox-csharp/csharp-version.sh"
# shellcheck source=scripts/ci/fetch.sh
source "$REPO_ROOT/scripts/ci/fetch.sh"

DOTNET_SDK_DIR="$GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
WASI_SDK_DIR="$GG_BUILD_PREFIX/wasi-sdk-$GG_WASI_SDK_VERSION-full"
PACK_DIR="$GG_BUILD_PREFIX/$GG_DOTNET_MONO_WASI_PACK.$GG_DOTNET_RUNTIME_VERSION"

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

mkdir -p "$GG_BUILD_PREFIX"

# --- the .NET SDK -----------------------------------------------------------------------------
#
# The whole thing, unpruned. `install-dotnet.sh` deletes MSBuild, NuGet and every workload from the
# RUN tree because a run only ever invokes `csc.dll`; this build drives MSBuild directly (the runtime
# pack's own tasks generate the P/Invoke table, the interpreter's thunks and the bundled BCL objects)
# and cannot have any of that missing.
log ".NET SDK $GG_DOTNET_SDK_VERSION, unpruned (gg's csharp guest is relinked with its MSBuild)"
if [ -x "$DOTNET_SDK_DIR/dotnet" ]; then
	echo ".NET SDK $GG_DOTNET_SDK_VERSION already installed at $DOTNET_SDK_DIR"
else
	WORK="$(mktemp -d)"
	trap 'rm -rf "$WORK"' EXIT
	echo "Installing the .NET SDK $GG_DOTNET_SDK_VERSION ($(gg_dotnet_architecture)) -> $DOTNET_SDK_DIR"
	mkdir -p "$DOTNET_SDK_DIR"
	gg_fetch https://dot.net/v1/dotnet-install.sh "$WORK/dotnet-install.sh"
	chmod +x "$WORK/dotnet-install.sh"
	"$WORK/dotnet-install.sh" --channel "$GG_DOTNET_CHANNEL" --version "$GG_DOTNET_SDK_VERSION" \
		--architecture "$(gg_dotnet_architecture)" --install-dir "$DOTNET_SDK_DIR" --no-path
fi

# The workload is installed for its BUILD TASKS and nothing else: `WasmAppBuilder.dll` and
# `MonoTargetsTasks.dll`, which reflect every `[DllImport]` in the BCL and emit the bundle objects.
# The check is on the two files the build actually names, rather than on a workload manifest, for the
# reason every check here is: what matters is whether the thing the build reads is present.
WASI_TASKS="$DOTNET_SDK_DIR/packs/Microsoft.NET.Runtime.WebAssembly.Wasi.Sdk/$GG_DOTNET_RUNTIME_VERSION/tasks/$GG_DOTNET_TFM/WasmAppBuilder.dll"
MONO_TASKS="$DOTNET_SDK_DIR/packs/Microsoft.NET.Runtime.MonoTargets.Sdk/$GG_DOTNET_RUNTIME_VERSION/tasks/$GG_DOTNET_TFM/MonoTargetsTasks.dll"
if [ -f "$WASI_TASKS" ] && [ -f "$MONO_TASKS" ]; then
	echo "the wasi-experimental workload's build tasks are already installed"
else
	echo "Installing the wasi-experimental workload (for its build tasks)"
	DOTNET_ROOT="$DOTNET_SDK_DIR" PATH="$DOTNET_SDK_DIR:$PATH" \
		dotnet workload install wasi-experimental --skip-manifest-update >/dev/null
fi
test -f "$WASI_TASKS"
test -f "$MONO_TASKS"

# --- the unpruned wasi-sdk --------------------------------------------------------------------
#
# The same release and the same URL `install-wasi-sdk.sh` fetches — read from the C++ arm's version
# file, which this sourced through `csharp-version.sh`, so the two cannot name different releases —
# and then NOT pruned. `wasm32-wasip2` and its `noeh` libc++ are what the link line needs and what
# the run installer deletes.
log "wasi-sdk $GG_WASI_SDK_VERSION, unpruned (gg's csharp guest links against its wasm32-wasip2 sysroot)"
if [ -x "$WASI_SDK_DIR/bin/clang" ]; then
	echo "wasi-sdk $GG_WASI_SDK_VERSION already installed at $WASI_SDK_DIR"
else
	echo "Installing wasi-sdk $GG_WASI_SDK_VERSION ($(gg_wasi_sdk_platform)) -> $WASI_SDK_DIR"
	# Staged to a file rather than piped into `tar`, which is what it used to be. A pipe cannot be
	# resumed: this is ~650 MB, and the whole of it was re-fetched every time the connection dropped
	# once. `gg_fetch` resumes and retries, and the archive is deleted once it has been unpacked.
	SDK_ARCHIVE="$(gg_fetch_dir)/wasi-sdk-$GG_WASI_SDK_VERSION-$(gg_wasi_sdk_platform).tar.gz"
	gg_fetch "$(gg_wasi_sdk_url)" "$SDK_ARCHIVE"
	rm -rf "$WASI_SDK_DIR"
	mkdir -p "$WASI_SDK_DIR"
	tar -xzf "$SDK_ARCHIVE" -C "$WASI_SDK_DIR" --strip-components=1
	rm -f "$SDK_ARCHIVE"
fi
test -d "$WASI_SDK_DIR/share/wasi-sysroot/lib/$GG_CSHARP_TARGET/noeh"

# --- the Mono WASI runtime pack -----------------------------------------------------------------
#
# Straight off nuget rather than out of the SDK's `packs/`, exactly as the build takes it, so what is
# cached here is what the build resolves and the pin in `csharp-version.sh` is the only thing that
# decides which.
log "$GG_DOTNET_MONO_WASI_PACK $GG_DOTNET_RUNTIME_VERSION (the guest is relinked from its archives)"
if [ -d "$PACK_DIR/runtimes/wasi-wasm/native" ]; then
	echo "the runtime pack is already unpacked at $PACK_DIR"
else
	echo "Fetching $GG_DOTNET_MONO_WASI_PACK $GG_DOTNET_RUNTIME_VERSION -> $PACK_DIR"
	rm -rf "$PACK_DIR"
	mkdir -p "$PACK_DIR"
	lower="$(echo "$GG_DOTNET_MONO_WASI_PACK" | tr '[:upper:]' '[:lower:]')"
	gg_fetch "https://api.nuget.org/v3-flatcontainer/$lower/$GG_DOTNET_RUNTIME_VERSION/$lower.$GG_DOTNET_RUNTIME_VERSION.nupkg" \
		"$PACK_DIR/mono-wasi.nupkg"
	unzip -q -o "$PACK_DIR/mono-wasi.nupkg" -d "$PACK_DIR"
	rm -f "$PACK_DIR/mono-wasi.nupkg"
fi
test -d "$PACK_DIR/runtimes/wasi-wasm/native"

log "gg's csharp build toolchains are installed ($(du -sh "$GG_BUILD_PREFIX" | cut -f1))"
