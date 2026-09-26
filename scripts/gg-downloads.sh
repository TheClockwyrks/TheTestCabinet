# shellcheck shell=bash
#
# Resolve the PINNED DOWNLOADS gg's artifact builds need, without reaching the network on a machine
# that has been provisioned. Sourced, never executed.
#
#   gg_wit_bindgen <version>                  # prints the path of a `wit-bindgen` executable
#   gg_wasmtime_adapter <version> <url>       # prints the path of a preview1 reactor adapter
#   gg_swift_libraries_dir                    # prints the root the three vendored Swift packages sit in
#   gg_swift_library <name> <version> <url>   # prints one unpacked Swift source tree
#   gg_spago_cache <registry-version>         # prints the XDG cache root Spago's package store lives in
#
# WHY THESE ARE HERE AND THE COMPILERS ARE NOT. Every other toolchain an arm needs is large,
# per-platform and installed by a script of its own under `scripts/ci/`. These are small things that
# an arm fetched INLINE, from a GitHub release or a registry, in the middle of a build —
# `wit-bindgen` into each package's own `.build/`, three separate copies of one 20 MB executable; the
# 52 KB wasmtime adapter with no cache marker at all, on every single run; the Swift arm's three
# vendored source packages into `packages/gg-sandbox-swift/.build/vendor`; and Spago's package store
# into `~/.cache`. That was survivable while those builds were a developer's deliberate command. It
# is not survivable now that they run inside an ordinary `cargo build`: a build that talks to
# github.com halfway through is a build that fails on an aeroplane, and one that re-downloads 52 KB
# on every invocation is one that fails on a rate limit at the worst possible moment.
#
# THE TWO LATE ARRIVALS ARE HERE FOR A SECOND REASON AS WELL, and it is the one that decided where
# they went. The Swift sources and the Spago store were already cached — but inside the repository,
# under `packages/gg-sandbox-swift/.build/vendor` and `~/.cache/spago-nodejs`. Neither is anywhere an
# installer writes, neither survives `git clean -xdf`, and neither is in any image's build context —
# so every fresh CI checkout re-downloaded three GitHub tarballs and re-cloned two PureScript registries from inside
# `cargo build`. Under `$HOME/.local/share/tcab`, version-stamped, they are warmed by
# `scripts/ci/install-gg-build-tools.sh`, exactly like every other pinned download here.
#
# THE RESOLUTION ORDER, identical for both, and the first three touch no network:
#
#   1. an explicit file override, for a machine that stages its own;
#   2. `/opt/gg/toolchains/…` — the prefix `gg_swift_home`, `gg_wasi_sdk_home` and `gg_dotnet_home`
#      all probe first. NOTHING WRITES IT TODAY, and that is worth saying rather than leaving a
#      reader to discover: `containers/gg-toolchains/Dockerfile` builds the tree a RUN container
#      gets, and neither of these files is on the turn path — the adapter's work is done before gg
#      is even built. The probe is here because the two installers below take
#      `GG_WIT_BINDGEN_INSTALL_DIR` and `GG_ADAPTER_INSTALL_DIR`, so an image that wants to bake
#      them is one `RUN` line, and because a resolution order that differed from every other
#      toolchain's for no reason would be its own kind of trap;
#   3. `$HOME/.local/share/tcab/…`, version-stamped, which is what
#      `scripts/ci/install-wit-bindgen.sh` and `scripts/ci/install-adapter.sh` warm — and those two
#      are in `scripts/ci/install-gg-toolchains.sh`'s one pinned list, so every surface that builds
#      gg gets them for free;
#   4. a download into (3), which is what a cold machine that skipped the installers does. One fetch,
#      once, into the place the installer would have used, so the next build is warm.
#
# VERSION-STAMPED, both of them, so a bumped pin downloads rather than silently reusing the previous
# release's file. That matters more for the adapter than it looks: the adapter and the wasmtime gg
# links are two halves of one ABI, and an adapter from a newer line may lower an interface the host's
# `wasmtime-wasi` does not define.
#
# THE PINS THEMSELVES STAY IN THE ARMS. This file resolves; it does not decide. `wit-bindgen`'s
# version comes from each arm's `*-version.sh` and the adapter's version AND URL are passed in by the
# arm, because `packages/gg-sandbox-cpp/cpp-version.sh` argues at length that the C++ and Swift arms
# pinning the same adapter separately is deliberate — the whole point of a pin is that bumping one
# arm's toolchain cannot silently move another arm's ABI. Two pins, one download.

# The platform slug `wit-bindgen` publishes its release assets under.
gg_wit_bindgen_asset() {
	case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) echo "x86_64-linux" ;;
	Linux-aarch64 | Linux-arm64) echo "aarch64-linux" ;;
	Darwin-x86_64) echo "x86_64-macos" ;;
	Darwin-arm64) echo "aarch64-macos" ;;
	*)
		echo "error: no pinned wit-bindgen build for $(uname -s)-$(uname -m)." >&2
		return 1
		;;
	esac
}

gg_wit_bindgen() {
	local version="$1" asset dir
	if [ -n "${TCAB_GG_WIT_BINDGEN:-}" ]; then
		echo "$TCAB_GG_WIT_BINDGEN"
		return 0
	fi
	if [ -x "/opt/gg/toolchains/wit-bindgen-$version/wit-bindgen" ]; then
		echo "/opt/gg/toolchains/wit-bindgen-$version/wit-bindgen"
		return 0
	fi

	dir="${GG_WIT_BINDGEN_INSTALL_DIR:-$HOME/.local/share/tcab}/gg-wit-bindgen-$version"
	if [ ! -x "$dir/wit-bindgen" ]; then
		asset="$(gg_wit_bindgen_asset)" || return 1
		echo "==> fetching wit-bindgen $version ($asset) -> $dir" >&2
		rm -rf "$dir"
		mkdir -p "$dir"
		curl -sSfL "https://github.com/bytecodealliance/wit-bindgen/releases/download/v${version}/wit-bindgen-${version}-${asset}.tar.gz" |
			tar -xz -C "$dir" --strip-components=1 >&2
	fi
	if [ ! -x "$dir/wit-bindgen" ]; then
		echo "error: no wit-bindgen executable at $dir after fetching it." >&2
		return 1
	fi
	echo "$dir/wit-bindgen"
}

# The `wasi_snapshot_preview1` REACTOR adapter, which turns a preview1 core module into something
# `wit_component` can encode as a preview 2 component. One file, ~52 KB, and the SAME file for every
# arm that pins the same wasmtime release — which is why it is cached under the version rather than
# under the arm.
gg_wasmtime_adapter() {
	local version="$1" url="$2" dir file
	if [ -n "${TCAB_GG_WASMTIME_ADAPTER:-}" ]; then
		echo "$TCAB_GG_WASMTIME_ADAPTER"
		return 0
	fi
	file="wasi_snapshot_preview1.reactor-$version.wasm"
	if [ -s "/opt/gg/toolchains/adapters/$file" ]; then
		echo "/opt/gg/toolchains/adapters/$file"
		return 0
	fi

	dir="${GG_ADAPTER_INSTALL_DIR:-$HOME/.local/share/tcab/gg-adapters}"
	if [ ! -s "$dir/$file" ]; then
		echo "==> fetching the wasi_snapshot_preview1 reactor adapter $version -> $dir" >&2
		mkdir -p "$dir"
		# Downloaded to a temporary name and moved into place, so an interrupted fetch cannot leave
		# a truncated adapter that every later build would happily link against.
		curl -sSfL "$url" -o "$dir/$file.partial"
		test -s "$dir/$file.partial"
		mv "$dir/$file.partial" "$dir/$file"
	fi
	echo "$dir/$file"
}

# The root the Swift arm's three vendored source packages are unpacked under.
#
# Resolved as a ROOT rather than per package, and that is not tidiness: `packages/gg-sandbox-swift/
# build.sh` passes `-file-prefix-map <root>=/gg/vendor` so that nothing the compiler records names
# the machine it was built on, and a map has one left-hand side. The three trees are therefore
# siblings by construction, and the paths baked into the archive are `/gg/vendor/<name>-<version>/…`
# on every machine.
#
# The `/opt` probe is a whole-set probe for the same reason: an image that bakes these bakes all
# three, because a root holding two of them and downloading the third into somewhere it cannot write
# is not a state worth being able to reach. Nothing writes `/opt` today — see the note on the same
# probe above.
gg_swift_libraries_dir() {
	if [ -n "${TCAB_GG_SWIFT_LIBRARIES:-}" ]; then
		echo "$TCAB_GG_SWIFT_LIBRARIES"
		return 0
	fi
	if [ -d "/opt/gg/toolchains/swift-libraries" ]; then
		echo "/opt/gg/toolchains/swift-libraries"
		return 0
	fi
	echo "${GG_SWIFT_LIBRARIES_INSTALL_DIR:-$HOME/.local/share/tcab/gg-swift-libraries}"
}

# One of the Swift arm's vendored source packages — `swift-collections`, `swift-algorithms`,
# `swift-numerics` — unpacked and stamped with the release tag it was fetched from.
#
# SOURCE rather than a binary, because there is no SwiftPM in the run image and the archive this
# feeds is compiled for a wasm target: what is cached is the GitHub tag tarball, and `build.sh`
# compiles it with the pinned `swiftc` into `swift.libraries.tar.gz`. The stamp records the URL
# rather than the version alone, so a pin bump AND a change of where a pin is fetched from both
# invalidate it — the directory is already version-stamped, and the second stamp costs one line.
gg_swift_library() {
	local name="$1" version="$2" url="$3" dir stamp
	dir="$(gg_swift_libraries_dir)/$name-$version"
	stamp="$dir/.stamp"
	if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$url" ]; then
		echo "==> fetching $name $version -> $dir" >&2
		rm -rf "${dir:?}"
		mkdir -p "$dir"
		curl -sSfL "$url" | tar -xz -C "$dir" --strip-components=1 >&2
		# Written last, so an interrupted fetch leaves an unstamped tree the next call replaces
		# rather than a stamped half of one it trusts.
		echo "$url" >"$stamp"
	fi
	echo "$dir"
}

# The cache root Spago keeps its package store, registry index and package sets in.
#
# Spago reads `$XDG_CACHE_HOME` and falls back to `~/.cache`, which is where it landed before this
# existed: 48 MB under a directory no installer writes and no image context includes — so the
# PureScript arm cloned two registries from inside `cargo build` on every fresh checkout. Pointing
# `XDG_CACHE_HOME` at a directory under `$HOME/.local/share/tcab` puts it where the other eleven
# toolchains live and makes it travel the way they do.
#
# STAMPED BY THE REGISTRY PACKAGE SET, which is the one pin that decides what is IN the store — and
# is itself read out of `spago.yaml`, where Spago reads it, by `purescript-version.sh`. A bumped set
# resolves into a new directory rather than reusing a store full of the previous set's tarballs.
#
# Note what this is NOT: `packages/gg-sandbox-purescript/.spago`, the per-checkout tree `spago
# install` links the resolved set into, stays where Spago puts it. That one is cheap to rebuild from
# a warm store; this is the part that costs a network.
gg_spago_cache() {
	local registry="$1"
	if [ -n "${TCAB_GG_SPAGO_CACHE:-}" ]; then
		echo "$TCAB_GG_SPAGO_CACHE"
		return 0
	fi
	if [ -d "/opt/gg/toolchains/spago-$registry" ]; then
		echo "/opt/gg/toolchains/spago-$registry"
		return 0
	fi
	echo "${GG_SPAGO_CACHE_INSTALL_DIR:-$HOME/.local/share/tcab}/gg-spago-$registry"
}
