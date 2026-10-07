#!/usr/bin/env bash
# The pins the **Swift** program language's toolchain, SDK and library set are built and run
# against.
#
# Sourced by `bindings.sh` and `build.sh`, by `containers/gg-toolchains/Dockerfile` and by
# `scripts/ci/install-swift.sh`, so there is one list rather than four.
#
# WHY THE COMPILER IS PINNED, AND WHY THE PIN IS HARD. gg carries a `.swiftmodule` for this
# arm's SDK, and a `.swiftmodule` is a **compiler-version-private format**: the release that
# reads one must be the release that wrote it. So the pin is not a preference about which
# diagnostics a model is shown — it is the one release that can compile a program here at
# all. Bumping it invalidates every artifact this arm carries, and nothing has to be done
# about that: this file is in `crates/gg-sandbox-artifacts/swift`'s rerun set, so the next
# `cargo build` re-cuts them with the release named here.
#
# Before the SDK landed this arm committed only C objects, two headers and one Swift SOURCE
# file, and a run image one patch release ahead would still have linked. That is no longer
# true, and `swift.compile.test.rs` fails by name when the toolchain gg finds and the manifest
# disagree rather than letting a program fail with a deserialisation error a model cannot act
# on.
set -euo pipefail

SWIFT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The Swift release a model's program is compiled by, on the host, once per turn.
GG_SWIFT_VERSION="6.3.3"

# The Swift SDK for WebAssembly, published beside the toolchain under the same release tag.
# Its version is the release's; it is named separately because it is a separate download with
# its own checksum, and because the SDK is what actually decides which standard library a
# program links.
GG_SWIFT_WASM_SDK_VERSION="$GG_SWIFT_VERSION"

# The target a model's program is compiled to.
#
# `wasm32-unknown-wasip1` and deliberately not a component target, because the Swift SDK
# publishes no other: the artifact bundle declares exactly this triple. The core module the
# compiler emits is turned into a COMPONENT afterwards, in gg's own process, by
# `wit_component` with the preview1 adapter below — see
# `crates/gg/src/sandbox/language/swift.compile.rs`.
#
# The consequence worth writing down is that this arm's guest imports the whole WASI preview 2
# surface whether a program touches it or not, because the target's own start-up does. gg links
# that surface ambiently for every guest (`sandbox::linker`), so it costs this arm nothing —
# and it is what gives a Swift program its own `print`, its own clock and its own files.
GG_SWIFT_TARGET="wasm32-unknown-wasip1"

# The `wasi_snapshot_preview1` REACTOR adapter that turns the preview1 core module the Swift
# SDK emits into a preview 2 component.
#
# Pinned to the wasmtime release gg links, because the adapter and the runtime are two halves
# of one ABI: an adapter from a newer line may lower an interface the host's `wasmtime-wasi`
# does not yet define. `build.sh` resolves it through `scripts/gg-downloads.sh` — an override,
# the toolchain image, a version-stamped per-user cache the installers warm, and only then a
# download — and copies it into this arm's artifact directory as `swift.adapter.wasm`, 52 KB,
# which gg `include_bytes!`s. It rides inside the binary for the reason every other artifact
# does: gg is copied as a single file into an ephemeral run container and must carry
# everything the turn path needs with it.
#
# The REACTOR one, not the command one: a component's exports are called after `_initialize`,
# and the command adapter would insist on running a `_start` this guest does not have.
GG_WASMTIME_ADAPTER_VERSION="45.0.3"

# The `wit-bindgen` release the guest bindings are generated with, and the generator: **C**.
#
# There is no Swift generator in `wit-bindgen`, and this arm does not need one. Swift imports C
# natively, so the canonical ABI is generated once as C — the same generator the C++ arm would
# use — compiled to a wasm object, and reached from Swift through a clang module. Writing
# the lowering by hand in Swift would have been a second implementation of a specification
# `wit-bindgen` already implements, drifting from the WIT on its own schedule.
#
# The version is the one the Rust arm pins, and deliberately the same one: both read the same
# `crates/gg/wit`, and two generators of different vintages reading it would be two chances for
# the wire to be described differently.
GG_WIT_BINDGEN_VERSION="0.60.0"

# The **curated library set** a program may `import`, beyond what the Swift SDK for WebAssembly
# already ships.
#
# Three packages, pinned to a release tag each, vendored by `build.sh` and compiled for this
# arm's target into one static archive. They are Apple's own, they are pure Swift, and they are
# what a Swift author reaches for when the standard library's `Array` and `Dictionary` are the
# wrong shape: `Deque`, `OrderedDictionary`, `Heap`, `BitSet`, `TreeDictionary`, and the eager
# and lazy sequence algorithms `chunks`, `windows`, `combinations` and `uniqued`.
#
# `swift-numerics` is here because `swift-algorithms` depends on it (`RandomSample` uses
# `RealModule`'s `log`), not because a program was thought likely to want it — but it is a
# perfectly good library and `libraries.txt` lists it rather than hiding it, since a name that
# links and is not declared is a capability a model is never told it has.
#
# WHY VENDORED AND COMPILED RATHER THAN FETCHED AT RUN TIME. There is no SwiftPM in the run
# image: the pruned toolchain is a compiler and a linker, and a package manager reaching a
# network from inside a run container is not something this sandbox is going to grow. So the
# set is built once per build, by `build.sh` into `crates/gg-sandbox-artifacts/swift`'s `OUT_DIR`,
# and embedded as a static archive gg unpacks per machine — the same arrangement the Rust arm's
# library set has, and for the same reason. The three sources it is compiled from are a pinned
# download like every other (`gg_swift_library` in `scripts/gg-downloads.sh`), not a fetch this
# build makes.
GG_SWIFT_COLLECTIONS_VERSION="1.2.1"
GG_SWIFT_ALGORITHMS_VERSION="1.2.1"
GG_SWIFT_NUMERICS_VERSION="1.0.3"

export GG_SWIFT_VERSION GG_SWIFT_WASM_SDK_VERSION GG_SWIFT_TARGET
export GG_WASMTIME_ADAPTER_VERSION GG_WIT_BINDGEN_VERSION
export GG_SWIFT_COLLECTIONS_VERSION GG_SWIFT_ALGORITHMS_VERSION GG_SWIFT_NUMERICS_VERSION
export SWIFT_ROOT

gg_swift_collections_url() {
	echo "https://github.com/apple/swift-collections/archive/refs/tags/${GG_SWIFT_COLLECTIONS_VERSION}.tar.gz"
}

gg_swift_algorithms_url() {
	echo "https://github.com/apple/swift-algorithms/archive/refs/tags/${GG_SWIFT_ALGORITHMS_VERSION}.tar.gz"
}

gg_swift_numerics_url() {
	echo "https://github.com/apple/swift-numerics/archive/refs/tags/${GG_SWIFT_NUMERICS_VERSION}.tar.gz"
}

# The platform build of the toolchain for this machine, and the asset names the downloads use.
# Exported as a function rather than resolved here, because the Dockerfile's build stage and a
# developer's machine may be different distributions and only one of them is `uname`-able at
# the point this file is sourced.
gg_swift_platform() {
	case "$(uname -s)-$(uname -m)" in
	# swift.org names the x86_64 Linux build with a BARE distro slug and suffixes only the
	# aarch64 one — `debian12` and `debian12-aarch64`. There is no `debian12-x86_64` asset;
	# the URL this slug is interpolated into twice 302s to swift.org/404.html. It was written
	# symmetrically, and the asymmetry went unnoticed because every machine that has run this
	# so far was aarch64.
	Linux-x86_64) echo "debian12" ;;
	Linux-aarch64 | Linux-arm64) echo "debian12-aarch64" ;;
	*)
		echo "error: no pinned Swift build for $(uname -s)-$(uname -m)." >&2
		return 1
		;;
	esac
}

# The Swift SDK bundle is host-independent — it holds a wasm sysroot and a wasm standard
# library, and nothing that runs on the machine doing the compiling — so there is one asset.
gg_swift_toolchain_url() {
	local platform
	platform="$(gg_swift_platform)" || return 1
	echo "https://download.swift.org/swift-${GG_SWIFT_VERSION}-release/${platform}/swift-${GG_SWIFT_VERSION}-RELEASE/swift-${GG_SWIFT_VERSION}-RELEASE-${platform}.tar.gz"
}

gg_swift_wasm_sdk_url() {
	echo "https://download.swift.org/swift-${GG_SWIFT_WASM_SDK_VERSION}-release/wasm-sdk/swift-${GG_SWIFT_WASM_SDK_VERSION}-RELEASE/swift-${GG_SWIFT_WASM_SDK_VERSION}-RELEASE_wasm.artifactbundle.tar.gz"
}

gg_wasmtime_adapter_url() {
	echo "https://github.com/bytecodealliance/wasmtime/releases/download/v${GG_WASMTIME_ADAPTER_VERSION}/wasi_snapshot_preview1.reactor.wasm"
}

# Where this arm's toolchain tree is, in the order gg itself looks — see
# `swift_home` in `crates/gg/src/sandbox/language/swift.compile.rs`, which must agree with this.
#
# Three places rather than `PATH`, because what this arm needs is a TREE and not a binary: a
# pruned compiler, the wasm SDK beside it, and the shared libraries the compiler's own linker
# was built against. A bare `swiftc` on `PATH` says nothing about where the other two are.
GG_SWIFT_DEFAULT_HOME="$HOME/.local/share/tcab/gg-swift"
GG_SWIFT_IMAGE_HOME="/opt/gg/toolchains/swift"

gg_swift_home() {
	if [ -n "${TCAB_GG_SWIFT_HOME:-}" ]; then
		echo "$TCAB_GG_SWIFT_HOME"
		return 0
	fi
	if [ -x "$GG_SWIFT_IMAGE_HOME/toolchain/usr/bin/swiftc" ]; then
		echo "$GG_SWIFT_IMAGE_HOME"
		return 0
	fi
	echo "$GG_SWIFT_DEFAULT_HOME"
}

export GG_SWIFT_DEFAULT_HOME GG_SWIFT_IMAGE_HOME
