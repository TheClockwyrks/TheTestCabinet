#!/usr/bin/env bash
#
# Refresh the COMMITTED artifact this package produces:
#
#   crates/gg/src/sandbox/guests/python.component.wasm   the baked CPython interpreter component
#
# It is named for the PROGRAM LANGUAGE it serves, not for this package, exactly as the TypeScript
# guest's artifacts are: gg's responses-as-code capability registers a language per guest, and each
# one commits its artifacts under `crates/gg/src/sandbox/guests/<language-id>.*`.
#
# The signature catalogue is the package's OTHER committed artifact and is emitted by
# `signatures.sh`, not by this script. The split is deliberate and is what lets CI cover the
# catalogue: reflecting it reads the sources and needs only a pinned `griffe`, where this needs
# `componentize-py`, a network and 25 MB of output — and, being unreproducible (see below), would
# fail a drift check every time it ran. `crates/gg/src/sandbox/language/python.substrate.test.rs` is
# what proves the artifact this script writes really runs, and really binds what that catalogue
# describes, against gg's own linker and membrane.
#
# The artifact is checked in, exactly as the TypeScript guest's is, so no build or CI step ever
# needs `componentize-py`: the Rust host reads it with `include_bytes!`. That is also why this
# script is never wired into a build — it is run by hand, deliberately, and its output is committed
# alongside the source change that motivated it.
#
# Run it after changing anything the component is made of:
#
#   * crates/gg/wit/gg-sandbox.wit        (the membrane — a WIT change without a rebuild fails gg's
#                                          instantiation test, which is the intended failure
#                                          direction)
#   * packages/gg-sandbox-python/src/**   (the shim, the SDK, or the curated library set — and if
#                                          what changed is `library.py`'s imports, run
#                                          `signatures.sh` too: those imports are also what the
#                                          system prompt tells a model it may import)
#   * packages/gg-sandbox-python/requirements.txt  (the pinned third-party wheels)
#   * the pinned COMPONENTIZE_VERSION below
#
# Requires `uv` (the devcontainer installs it) and network access the first time, to fetch the
# pinned `componentize-py` and the wheels. The build takes a couple of seconds and emits ~24 MB,
# because the component embeds a whole CPython plus its curated standard library.
#
# IT IS NOT BYTE-REPRODUCIBLE. `componentize-py` pre-initialises CPython and snapshots the running
# interpreter's memory, so two builds of identical sources differ by tens of kilobytes even with
# `PYTHONHASHSEED` and `SOURCE_DATE_EPOCH` pinned (measured). So do NOT run this to check whether the
# committed artifact is current: it will always say no. Run it when something above actually
# changed, and let the substrate tests say whether the result behaves.
#
# Usage:
#   packages/gg-sandbox-python/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-python"
DEST_DIR="crates/gg/src/sandbox/guests"
COMPONENT="$DEST_DIR/python.component.wasm"

# The `componentize-py` release the committed artifact is built with, and with it the CPython
# version a program runs on (0.25.0 embeds CPython 3.14). Pinned rather than floating for the reason
# the TypeScript guest pins `componentize-js`: the component is a binary in the repository, so a
# silent toolchain bump would land as an unexplained multi-megabyte diff — and here it would also
# silently change the language version a study's Python arm was run in.
COMPONENTIZE_VERSION="0.25.0"

# Everything this script generates, none of it committed: the vendored wheels and the generated WIT
# bindings. Inside the package so a developer can read them, and `.gitignore`d so they cannot be
# mistaken for source.
BUILD_DIR="$PACKAGE/.build"

mkdir -p "$DEST_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 1. Vendor the pinned third-party wheels into a private tree. `--target` rather than a virtualenv
#    because all `componentize-py` wants is a directory to put on its Python path, and because a
#    tree this script created and can delete is one no other build can have polluted.
echo "Vendoring the pinned wheels ..."
uv pip install --quiet --target "$BUILD_DIR/vendor" -r "$PACKAGE/requirements.txt"

# 2. Generate the Python bindings for the ONE copy of the WIT — the one that lives in the Rust crate
#    that embeds the result, so there is no second copy in this package to drift from it.
#
#    `componentize-py` generates these again internally when it bakes, so this step is not an input
#    to step 3: it exists so that `src/shim.py` can be read, type-checked and navigated against the
#    real `wit_world` package rather than against an import that resolves nowhere.
echo "Generating the WIT bindings ..."
uvx --quiet --from "componentize-py==$COMPONENTIZE_VERSION" componentize-py \
	--wit-path "$ROOT/crates/gg/wit" \
	--world sandbox \
	bindings "$BUILD_DIR/bindings"

# 3. Bake the component.
#
#    Deliberately WITHOUT `--stub-wasi`. That flag replaces every WASI import with a trapping stub,
#    and it is what made an earlier study price this arm at six to ten weeks: with it,
#    `datetime.now()`, `SystemRandom()`, `uuid4()`, `tempfile` and `threading` all TRAP —
#    unshimmably, because they are C-implemented immutable types — and a trap takes the store down
#    with no catchable error and nothing to tell the model. gg's host linker defines the whole WASI
#    p2 surface for every guest, so the guest is built against it and all five are ordinary calls
#    again. `ambient_wasi_retires_every_trap_the_stubbed_build_had` is the measurement that says so.
#
#    `-p src` puts the shim and its curated library set on the path; `-p vendor` puts the wheels
#    there. Both matter more than they look: `componentize-py` bakes only the modules the entry
#    module's import closure actually reached, so what is importable at run time is decided here.
echo "Building the component with componentize-py@$COMPONENTIZE_VERSION ..."
uvx --quiet --from "componentize-py==$COMPONENTIZE_VERSION" componentize-py \
	--wit-path "$ROOT/crates/gg/wit" \
	--world sandbox \
	componentize shim \
	-p "$ROOT/$PACKAGE/src" \
	-p "$ROOT/$BUILD_DIR/vendor" \
	-o "$ROOT/$COMPONENT"

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
echo "Remember to commit the refreshed artifact together with the source change."
