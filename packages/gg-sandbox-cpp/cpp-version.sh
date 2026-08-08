#!/usr/bin/env bash
# The pins the **C++** program language's toolchain and guest are built and run against.
#
# Sourced by `bindings.sh` and `build.sh`, by `containers/gg-toolchains/Dockerfile` and by
# `scripts/ci/install-wasi-sdk.sh`, so there is one list rather than four.
#
# WHY THE COMPILER IS PINNED. Two of the three things gg commits for this arm are *objects* —
# the generated WIT bindings and gg's shell, compiled for wasm at build time — and an object
# is not a compiler-private format the way a `.swiftmodule` or an `.rlib` is: `wasm-ld` will
# link one clang's object against another's. So the pin here is softer than the Swift and
# Rust arms', and it is still a pin, for the thing that *is* version-private: the
# **precompiled header** this arm builds once per machine out of `Sources/prelude.hpp`. A PCH
# may only be read by the clang that wrote it, so `cpp.compile.rs` keys the shared directory
# it lives in on this release AND on a stamp of the compiler binary itself — a reinstall at
# the same version writes a different key rather than leaving a PCH that every compile would
# then fail to load.
set -euo pipefail

CPP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The wasi-sdk release a model's program is compiled by, on the host, once per turn. It is a
# whole LLVM: `clang` 22.1.0, `wasm-ld`, `libc++` with its headers, and a wasi-libc sysroot,
# all cross-configured for wasm and relocatable — which is what lets one tarball satisfy both
# of `containers/gg-toolchains`'s constraints without a single line of vendoring.
GG_WASI_SDK_VERSION="33.0"

# The release tag the version above is published under. wasi-sdk tags a major and names its
# assets with a `major.minor`, so the two are spelled separately rather than derived.
GG_WASI_SDK_TAG="wasi-sdk-33"

# The target a model's program is compiled to.
#
# `wasm32-wasip1` and deliberately not `wasm32-wasip2`, which this SDK also publishes. The p2
# target links through the SDK's own `wasm-component-ld`, which bundles a *different* release
# of `wasm-encoder` from the `wit-component` gg links — so the component a run instantiates
# would be produced by a toolchain gg does not version, and a component-model feature the
# runtime's validator does not know would arrive as a validation error on a program nobody
# wrote wrong. The p1 core module is encoded in gg's own process instead, by the same
# `wit_component` the Rust and Swift arms use, with the adapter below.
GG_CPP_TARGET="wasm32-wasip1"

# The C++ standard a model's program is compiled as.
#
# `c++23` rather than `c++20`, and the difference is not decoration: `std::expected`,
# `std::print`'s formatting machinery and the ranges algorithms that take a projection are all
# C++23, and all three are what a model reaches for when it writes modern C++. libc++ 22 ships
# them. `c++26` is not taken because libc++'s implementation of it is still partial, and an arm
# whose model is told it may write a standard its library only half has is an arm measuring
# gg's flag rather than the language.
GG_CPP_STD="c++23"

# The `wasi_snapshot_preview1` REACTOR adapter that turns the preview1 core module wasi-sdk
# emits into a preview 2 component.
#
# Pinned to the wasmtime release gg links, because the adapter and the runtime are two halves
# of one ABI. It is downloaded once by `build.sh` and COMMITTED
# (`crates/gg/src/sandbox/checkers/cpp.adapter.wasm`, 52 KB), for the reason every other arm's
# committed artifact is: gg is copied as a single file into an ephemeral run container and must
# carry everything the turn path needs with it.
#
# It is this arm's OWN copy of a file the Swift arm also carries, and that duplication is
# deliberate. The two arms pin their adapter from their own version file, and the whole point
# of a pin is that bumping one arm's toolchain cannot silently move another arm's ABI —
# 52 KB is a cheap price for two arms of one study failing independently rather than together.
GG_WASMTIME_ADAPTER_VERSION="45.0.3"

# The `wit-bindgen` release the guest bindings are generated with, and the generator: **C**.
#
# The canonical ABI is generated once as C, compiled to a wasm object at build time, and
# reached from C++ through `extern "C"` — which is what C++ does with C and needs no shim. The
# same generator and the same release the Swift arm uses, deliberately: all three read the same
# `crates/gg/wit`, and two generators of different vintages reading it would be two chances for
# the wire to be described differently.
GG_WIT_BINDGEN_VERSION="0.60.0"

export GG_WASI_SDK_VERSION GG_WASI_SDK_TAG GG_CPP_TARGET GG_CPP_STD
export GG_WASMTIME_ADAPTER_VERSION GG_WIT_BINDGEN_VERSION CPP_ROOT

# The platform build of the SDK for this machine. Exported as a function rather than resolved
# here, because the Dockerfile's build stage and a developer's machine may be different
# distributions and only one of them is `uname`-able at the point this file is sourced.
gg_wasi_sdk_platform() {
	case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) echo "x86_64-linux" ;;
	Linux-aarch64 | Linux-arm64) echo "arm64-linux" ;;
	Darwin-x86_64) echo "x86_64-macos" ;;
	Darwin-arm64) echo "arm64-macos" ;;
	*)
		echo "error: no pinned wasi-sdk build for $(uname -s)-$(uname -m)." >&2
		return 1
		;;
	esac
}

gg_wasi_sdk_url() {
	local platform
	platform="$(gg_wasi_sdk_platform)" || return 1
	echo "https://github.com/WebAssembly/wasi-sdk/releases/download/${GG_WASI_SDK_TAG}/wasi-sdk-${GG_WASI_SDK_VERSION}-${platform}.tar.gz"
}

gg_wasmtime_adapter_url() {
	echo "https://github.com/bytecodealliance/wasmtime/releases/download/v${GG_WASMTIME_ADAPTER_VERSION}/wasi_snapshot_preview1.reactor.wasm"
}

# Where this arm's toolchain tree is, in the order gg itself looks — see `wasi_sdk_home` in
# `crates/gg/src/sandbox/language/cpp.compile.rs`, which must agree with this.
#
# A tree rather than a binary on `PATH`, for the reason the Swift arm resolves one: what this
# arm needs is a compiler, a sysroot and a libc++ that agree with each other, and a `clang++`
# on `PATH` says nothing about where the other two are. wasi-sdk keeps all three under one
# prefix and finds the sysroot from the compiler's own path, so naming the prefix is enough.
GG_WASI_SDK_DEFAULT_HOME="$HOME/.local/share/tcab/gg-wasi-sdk"
GG_WASI_SDK_IMAGE_HOME="/opt/gg/toolchains/wasi-sdk"

gg_wasi_sdk_home() {
	if [ -n "${TCAB_GG_WASI_SDK_HOME:-}" ]; then
		echo "$TCAB_GG_WASI_SDK_HOME"
		return 0
	fi
	if [ -x "$GG_WASI_SDK_IMAGE_HOME/bin/clang++" ]; then
		echo "$GG_WASI_SDK_IMAGE_HOME"
		return 0
	fi
	echo "$GG_WASI_SDK_DEFAULT_HOME"
}

export GG_WASI_SDK_DEFAULT_HOME GG_WASI_SDK_IMAGE_HOME
