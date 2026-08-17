#!/usr/bin/env bash
# Warm every PACKAGE-MANAGER-DELIVERED tool gg's artifact builds reach for, so that none of them
# reaches a registry from inside an ordinary `cargo build`.
#
# WHAT IS DIFFERENT ABOUT THESE. The eleven per-arm installers beside this one each own a COMPILER:
# a JDK, a Swift toolchain, `purs`, wasi-sdk. They download a release tarball and unpack it, and they
# are what makes a machine able to build gg. This one owns the tools that are published only through
# npm, PyPI, rubygems and crates.io, and whose native idiom is "resolve me at build time" — which is
# precisely the idiom that stops being acceptable when the build in question is `cargo build`.
#
# So this script does not install anything new in kind. It runs each resolution EARLY, from a place
# a person expects a download, into the same version-stamped prefix the build will look in — and the
# build then finds it there and stays offline. Every one of the resolvers below is idempotent and
# says nothing on a warm machine.
#
#   componentize-js   bakes the TypeScript and Ruby guest components. Two arms pin it separately, on
#                     purpose (each guest's engine is that arm's study parameter), so both pins are
#                     read and both are warmed — the same version twice is one install.
#   opal-compiler     the Opal runtime and self-hosted compiler the whole Ruby arm is made of.
#   the opal gem      Opal's STANDARD LIBRARY sources, which npm does not ship. Cached outside the
#                     package, because `.build/` is what a `git clean` takes.
#   spago, and then   the resolver, and then the PACKAGE SET IT RESOLVES. Installing the resolver
#   the package set   without warming its store bought nothing: the store is what the network is
#                     for. `purs` and `esbuild` are NOT here — they have a real installer already
#                     (`install-purescript.sh`), because the run image needs those two binaries.
#   componentize-py   bakes the Python guest, plus that arm's pinned wheels, both into uv's cache so
#                     `build.sh` can pass `--offline`.
#   the Swift arm's   three GitHub release tarballs — `swift-collections`, `swift-algorithms`,
#   vendored sources  `swift-numerics` — compiled into that arm's curated archive.
#   the Rust arm's    `packages/gg-sandbox-rust/Cargo.lock` is a SEPARATE lockfile from the
#   cargo closure    workspace's, so nothing else in this repository warms it, and that arm's build
#                     runs `cargo build --locked --offline` against it.
#   the ECMAScript    `packages/gg-sandbox/guest/Cargo.lock`, a THIRD lockfile, for the same reason:
#   guest's closure   quickjs and `rquickjs` are compiled for `wasm32-wasip1` out of a package that
#                     is deliberately not in the workspace.
#
# THE LAST TWO ARRIVED LATE AND THE REASON IS WORTH THE LINE, because it is the trap this script is
# for. Both were already cached — and both cached INSIDE the repository, in
# `packages/gg-sandbox-swift/.build/vendor` and in `~/.cache/spago-nodejs`. A cache in a gitignored
# directory looks exactly like a warm machine right up until the machine is a fresh CI checkout, at
# which point it is three GitHub fetches and two `git clone`s in the middle of `cargo build`. They
# live under `$HOME/.local/share/tcab` now, which is where `scripts/ci/hydrate-gg-toolchains.sh`
# looks and what the CI image bakes; `scripts/gg-downloads.sh` resolves both.
#
# WHY NOT THE REPOSITORY'S npm WORKSPACE, for the three npm entries. Because a repo-root `npm ci` is
# run by every job here — the web console's build, the docs site's, the linters — and none of them
# has any business downloading a JavaScript-engine componentiser. See `scripts/gg-npm-tools.sh`.
#
# Usage:
#   scripts/ci/install-gg-build-tools.sh
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

export PATH="$HOME/.local/bin:$PATH"
# shellcheck source=scripts/gg-npm-tools.sh
source "$REPO_ROOT/scripts/gg-npm-tools.sh"
# shellcheck source=scripts/gg-downloads.sh
source "$REPO_ROOT/scripts/gg-downloads.sh"

# Three of the resolutions below are `npm install --prefix`, and npm is the ONE prerequisite this
# script assumes rather than installs — like `uv` and `cargo` below, and for the same reason: a
# script that installed a JavaScript runtime would be installing a toolchain, which is what the
# eleven installers beside this one are for. Named here rather than left to `npm: command not
# found` four lines later, because that message says nothing about which of the eleven surfaces is
# missing it. (`containers/gg-ci/Dockerfile` copies node and npm out of the official image for
# exactly this line; the devcontainer and the driver image already had one.)
if ! command -v npm >/dev/null 2>&1; then
	echo "error: no \`npm\` on PATH." >&2
	echo "       Three of gg's build tools — componentize-js, opal-compiler and spago — are" >&2
	echo "       published on npm and nowhere else, and gg's artifact builds resolve them out" >&2
	echo "       of the prefix this script warms. Install Node (any recent LTS) and re-run." >&2
	exit 1
fi

# --- componentize-js, from both arms that pin it ---------------------------------------------
#
# The TypeScript arm spells its pin in `build.sh` and the Ruby arm in `opal-version.sh`; they are
# the same release today and deliberately free to diverge. Read out of the files rather than
# restated here, so a bump on either side is warmed without a second edit.
log "componentize-js (bakes the typescript and ruby guest components)"
TS_COMPONENTIZE="$(sed -n 's/^COMPONENTIZE_VERSION="\(.*\)"$/\1/p' \
	"$REPO_ROOT/packages/gg-sandbox/build.sh")"
RUBY_COMPONENTIZE="$(
	# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
	source "$REPO_ROOT/packages/gg-sandbox-ruby/opal-version.sh"
	echo "$COMPONENTIZE_VERSION"
)"
if [ -z "$TS_COMPONENTIZE" ] || [ -z "$RUBY_COMPONENTIZE" ]; then
	echo "error: could not read a componentize-js pin out of the typescript or ruby arm." >&2
	exit 1
fi
for version in "$TS_COMPONENTIZE" "$RUBY_COMPONENTIZE"; do
	gg_npm_tool @bytecodealliance/componentize-js "$version" >/dev/null
done
echo "componentize-js $TS_COMPONENTIZE (typescript), $RUBY_COMPONENTIZE (ruby)"

# --- the Ruby arm: the compiler package and the gem its standard library comes from ------------
log "opal (gg's ruby arm is compiled by it and bakes its runtime)"
# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
source "$REPO_ROOT/packages/gg-sandbox-ruby/opal-version.sh"
gg_npm_tool opal-compiler "$OPAL_COMPILER_VERSION" >/dev/null
echo "opal-compiler $OPAL_COMPILER_VERSION"

# The gem carries the Ruby SOURCES of the standard library, which the npm packages do not ship. The
# existence of the unpacked `stdlib/` is the marker — `build.sh` uses exactly the same check, so a
# machine warmed here and a machine that warmed itself are in the same state.
GEM_DIR="${GG_OPAL_GEM_DIR:-$HOME/.local/share/tcab/gg-opal-$OPAL_VERSION}"
if [ -d "$GEM_DIR/stdlib" ]; then
	echo "opal gem $OPAL_VERSION already unpacked at $GEM_DIR"
else
	echo "Fetching the opal $OPAL_VERSION gem -> $GEM_DIR"
	mkdir -p "$GEM_DIR"
	curl -sSfL "https://rubygems.org/downloads/opal-$OPAL_VERSION.gem" -o "$GEM_DIR/opal.gem"
	tar -xf "$GEM_DIR/opal.gem" -C "$GEM_DIR" data.tar.gz
	tar -xzf "$GEM_DIR/data.tar.gz" -C "$GEM_DIR"
	test -d "$GEM_DIR/stdlib"
fi

# --- Spago, and the package set it resolves ----------------------------------------------------
log "spago and gg's purescript package set"
# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
source "$REPO_ROOT/packages/gg-sandbox-purescript/purescript-version.sh"
SPAGO_DIR="$(gg_npm_tool spago "$SPAGO_VERSION")"
echo "spago $SPAGO_VERSION"

# The store, which is the half that costs a network. `spago install` clones the registry index and
# the registry, downloads the package set and then every package tarball it names — into
# `$XDG_CACHE_HOME`, pointed here at the same version-stamped prefix `packages/gg-sandbox-
# purescript/build.sh` points it at. Warming the resolver and not the store was the whole gap: the
# arm's build guarded its `spago install` behind a stamp in the package's own `.build/`, which on a
# fresh checkout is absent, so the resolve ran anyway and reached github.com from inside `cargo
# build`.
#
# Run in a THROWAWAY COPY of the two declaration files rather than in the guest package, and this is
# the difference between warming and appearing to. Spago resolves against the package's own
# `.spago/` before it goes anywhere near the store, so `spago install` in a checkout that already
# has one does nothing at all — which is exactly the state a developer's machine is in, and it is
# how a warm that warmed nothing would go unnoticed until CI. A `mktemp -d` has no `.spago`, ever,
# so the resolve is always the real one, and the checkout is left untouched: no `.spago/` and no
# `output/` appear in the working tree because a toolchain installer ran.
#
# `spago.yaml` and `spago.lock` are the whole input — the package set and the versions it resolved
# to. Both are in the image contexts for this reason (see the notes in `.dockerignore` and
# `.devcontainer/ubuntu.dockerfile.dockerignore`); warming without the lockfile would cache a
# resolution the arm's build then discards.
SPAGO_CACHE="$(gg_spago_cache "$REGISTRY_VERSION")"
log "the purescript package set (registry $REGISTRY_VERSION) -> $SPAGO_CACHE"
mkdir -p "$SPAGO_CACHE"
# Removed on the line after it is used rather than in a `trap … EXIT`, because the Python section
# below installs a trap of its own and a second `trap … EXIT` REPLACES the first rather than adding
# to it — which would leak this directory on every run.
SPAGO_WARM="$(mktemp -d)"
cp "$REPO_ROOT/packages/gg-sandbox-purescript/spago.yaml" \
	"$REPO_ROOT/packages/gg-sandbox-purescript/spago.lock" "$SPAGO_WARM/"
(
	cd "$SPAGO_WARM"
	XDG_CACHE_HOME="$SPAGO_CACHE" PATH="$SPAGO_DIR/node_modules/.bin:$PATH" spago install
)
rm -rf "$SPAGO_WARM"

# --- the Swift arm's three vendored source packages --------------------------------------------
#
# Sources rather than binaries, and they are here rather than in `install-swift.sh` because they are
# not part of the toolchain: they are the curated library set a Swift program may `import`, compiled
# for the wasm target by that arm's `build.sh`. `gg_swift_library` is the resolver the build calls,
# so warming is calling it — there is no second copy of where they go or what they are stamped by.
log "the swift arm's curated library sources"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$REPO_ROOT/packages/gg-sandbox-swift/swift-version.sh"
gg_swift_library swift-collections "$GG_SWIFT_COLLECTIONS_VERSION" "$(gg_swift_collections_url)" >/dev/null
gg_swift_library swift-algorithms "$GG_SWIFT_ALGORITHMS_VERSION" "$(gg_swift_algorithms_url)" >/dev/null
gg_swift_library swift-numerics "$GG_SWIFT_NUMERICS_VERSION" "$(gg_swift_numerics_url)" >/dev/null
echo "swift-collections $GG_SWIFT_COLLECTIONS_VERSION, swift-algorithms $GG_SWIFT_ALGORITHMS_VERSION, swift-numerics $GG_SWIFT_NUMERICS_VERSION in $(gg_swift_libraries_dir)"

# --- componentize-py and the Python arm's wheels ----------------------------------------------
#
# Both into uv's own cache rather than into a prefix of ours, because that is the cache
# `uv pip install --offline` and `uvx --offline` read. `uv tool install` would put a binary on PATH
# this build never uses; `uvx --from … --help` resolves and caches exactly what the build resolves.
log "componentize-py and the python arm's wheels (into uv's cache, for --offline)"
if ! command -v uv >/dev/null 2>&1; then
	echo "error: no \`uv\` on PATH. Run scripts/ci/install-uv.sh first — it is earlier in" >&2
	echo "       scripts/ci/install-gg-toolchains.sh's list for exactly this reason." >&2
	exit 1
fi
PY_COMPONENTIZE="$(sed -n 's/^COMPONENTIZE_VERSION="\(.*\)"$/\1/p' \
	"$REPO_ROOT/packages/gg-sandbox-python/build.sh")"
if [ -z "$PY_COMPONENTIZE" ]; then
	echo "error: could not read COMPONENTIZE_VERSION out of packages/gg-sandbox-python/build.sh." >&2
	exit 1
fi
uvx --quiet --from "componentize-py==$PY_COMPONENTIZE" componentize-py --help >/dev/null
# A throwaway target: what is being warmed is uv's download cache, not this directory.
PY_WHEELS="$(mktemp -d)"
trap 'rm -rf "$PY_WHEELS"' EXIT
uv pip install --quiet --target "$PY_WHEELS" \
	-r "$REPO_ROOT/packages/gg-sandbox-python/requirements.txt"
echo "componentize-py $PY_COMPONENTIZE and the pinned wheels are in uv's cache"

# --- the Rust arm's own lockfile ---------------------------------------------------------------
#
# `cargo fetch --locked` populates `CARGO_HOME` with exactly what that lockfile names, which is what
# lets that arm's `build.sh` run `cargo build --locked --offline`. The workspace's own `cargo fetch`
# does not cover it: this is a separate package with a separate lockfile and a curated dependency set
# of its own.
log "the rust arm's curated crate set (a separate Cargo.lock from the workspace's)"
if command -v cargo >/dev/null 2>&1; then
	cargo fetch --locked --manifest-path "$REPO_ROOT/packages/gg-sandbox-rust/Cargo.toml"
	# The ECMAScript guest, which is a THIRD lockfile for the same reason: quickjs and `rquickjs`
	# are compiled for `wasm32-wasip1` out of a package that is deliberately not in the workspace,
	# and `packages/gg-sandbox/guest.sh` builds it `--locked --offline` inside an ordinary
	# `cargo build`.
	cargo fetch --locked --manifest-path "$REPO_ROOT/packages/gg-sandbox/guest/Cargo.toml"
else
	echo "warning: no \`cargo\` on PATH, so the rust arm's crate set and the ECMAScript guest's" >&2
	echo "         were not fetched. Both build \`--locked --offline\` and will fail until this" >&2
	echo "         is run on a machine that has one." >&2
fi

log "gg's package-manager-delivered build tools are warm"
