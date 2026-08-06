#!/usr/bin/env bash
#
# Refresh the COMMITTED artifacts gg compiles a Ruby program with:
#
#   crates/gg/src/sandbox/checkers/ruby.opal.cjs      Opal, as one CommonJS bundle with a driver
#   crates/gg/src/sandbox/checkers/ruby.compiler.json which Opal it is, and which Ruby it emulates
#
# They are named for the PROGRAM LANGUAGE they serve, not for this package, exactly as the
# TypeScript checker's artifacts are.
#
# Split from `build.sh` for the reason the Python guest's `signatures.sh` is split from its own
# build: this needs only Node and 3 MB of output and is therefore something CI can run and diff,
# where baking the component needs `componentize-js` and emits 18 MB. `scripts/ci/contract-drift.sh`
# runs THIS one.
#
# Requires Node and network access the first time, to fetch the pinned Opal packages.
#
# Usage:
#   packages/gg-sandbox-ruby/compiler.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-ruby"

# The one Opal pin, shared with `build.sh` — the compiler this cuts and the runtime that guest bakes
# have to be the same release. See that file for why.
# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
source "$ROOT/$PACKAGE/opal-version.sh"

BUILD_DIR="$PACKAGE/.build"
mkdir -p "$BUILD_DIR"

echo "Vendoring opal-compiler@$OPAL_COMPILER_VERSION ..."
npm install --silent --no-audit --no-fund --prefix "$BUILD_DIR" \
	"opal-compiler@$OPAL_COMPILER_VERSION"

echo "Cutting the Opal compiler bundle ..."
GG_RUBY_VENDOR="$ROOT/$BUILD_DIR/node_modules" node "$PACKAGE/tools/compiler.mjs"

echo "Remember to commit the refreshed artifacts together with the source change."
