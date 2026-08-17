#!/usr/bin/env bash
#
# Build the artifact this package produces, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   python.component.wasm   the baked CPython interpreter component
#
# It is named for the PROGRAM LANGUAGE it serves, not for this package, exactly as the TypeScript
# guest's artifacts are: gg's responses-as-code capability registers a language per guest, and each
# one files its artifacts under `<language-id>.*`.
#
# The signature catalogue — what a model is TOLD this arm offers — is emitted by `signatures.sh`,
# not by this script, and reflecting is a different question answered by a different tool:
# `crates/gg/build.rs` runs it out of `src/gg/**` with a pinned `griffe`, which reads the sources
# statically, where this needs `componentize-py` and emits 25 MB. Two steps, two scripts, two rerun
# sets. `crates/gg/src/sandbox/language/python.substrate.test.rs` is what proves the artifact this
# script writes really runs, and really binds what that catalogue describes, against gg's own linker
# and membrane.
#
# NOBODY HAS TO REMEMBER WHEN TO RUN THIS. `crates/gg-sandbox-artifacts/python` runs it as part of
# building `test-cabinet-gg`, and the rerun set it declares — in
# `crates/gg-sandbox-artifacts/build-support` — is exactly the list of things this build reads:
#
#   * crates/gg/wit/gg-sandbox.wit        (the membrane — a WIT change without a rebuild fails gg's
#                                          instantiation test, which is the intended failure
#                                          direction)
#   * packages/gg-sandbox-python/src/**   (the shim, the SDK, or the curated library set — and if
#                                          what changed is `library.py`'s imports, that is also a
#                                          change to the set gg quotes back to a model on a compile
#                                          failure, which `signatures.sh` reflects off the same tree
#                                          on the same build)
#   * packages/gg-sandbox-python/requirements.txt  (the pinned third-party wheels)
#   * packages/gg-sandbox-python/build.sh (this file — the pinned COMPONENTIZE_VERSION below, and
#                                          the `-p` paths that decide what is importable at all)
#
# Requires `uv` (the devcontainer installs it) with its cache warmed by
# `scripts/ci/install-gg-build-tools.sh`, which pre-fetches the pinned `componentize-py` and the
# pinned wheels so the two `uv` calls below can run `--offline`. The build takes a couple of seconds
# and emits ~24 MB, because the component embeds a whole CPython plus its curated standard library.
#
# IT IS NOT BYTE-REPRODUCIBLE. `componentize-py` pre-initialises CPython and snapshots the running
# interpreter's memory, so two builds of identical sources differ by tens of kilobytes even with
# `PYTHONHASHSEED` and `SOURCE_DATE_EPOCH` pinned (measured). Nothing depends on that: this arm's
# crate rebuilds only when a declared input moved, and there is no committed copy for a rebuild to
# be diffed against. It is worth stating rather than dropping, because it is why this arm could
# never have been covered by a regenerate-and-diff gate the way the JVM jars and the TypeScript
# checker were — comparing two runs' bytes here tells you nothing, and the substrate tests are what
# say whether the result behaves.
#
# Usage:
#   scripts/gg-artifacts.sh                                      # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-python/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-python"

# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$ROOT/$PACKAGE"

COMPONENT="$GG_ARTIFACTS_OUT_DIR/python.component.wasm"

# THIS SCRIPT WRITES INTO ITS OWN SOURCE TREE AND CANNOT BE TALKED OUT OF IT, which is worth knowing
# here because the consequence is handled somewhere else. `componentize-py` imports the shim to take
# its import closure, and the CPython it does that with drops a `__pycache__/` beside every module it
# touches — inside `packages/gg-sandbox-python/src`, which is this arm's own rerun set.
#
# `signatures.sh` beside this file has the same problem and solves it with `PYTHONDONTWRITEBYTECODE`.
# That does not work here: `componentize-py` embeds its own interpreter and configures it itself, and
# MEASURED, with the variable exported from this script, a build still left 19 `.pyc` files under
# `src/`. So the write stays, and `crates/gg-sandbox-artifacts/build-support` enumerates this arm's
# sources a file at a time instead of naming the directory — the same exception, for the same reason,
# that the Rust arm's generated `src/bindings.rs` gets. See `python_sdk_sources` there; it records
# what this cost before it was excluded (two full rebuilds for one edit).

# The `componentize-py` release this artifact is built with, and with it the CPython version a
# program runs on (0.25.0 embeds CPython 3.14). Pinned rather than floating for the reason the
# TypeScript guest pins `componentize-js`: a floating one would silently change the language version
# a study's Python arm was run in, half way through a sweep.
COMPONENTIZE_VERSION="0.25.0"

# Everything this script generates besides the artifact: the vendored wheels and the generated WIT
# bindings. Inside the package so a developer can read them, and `.gitignore`d so they cannot be
# mistaken for source.
BUILD_DIR="$PACKAGE/.build"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 1. Vendor the pinned third-party wheels into a private tree. `--target` rather than a virtualenv
#    because all `componentize-py` wants is a directory to put on its Python path, and because a
#    tree this script created and can delete is one no other build can have polluted.
#
#    `--offline`, because this runs inside an ordinary `cargo build`: everything it needs was
#    downloaded into uv's cache by `scripts/ci/install-gg-build-tools.sh`, and a resolution that
#    could reach PyPI is one that will, on the day the cache is cold and somebody is on a train.
echo "Vendoring the pinned wheels ..."
uv pip install --quiet --offline --target "$BUILD_DIR/vendor" -r "$PACKAGE/requirements.txt"

# 2. Generate the Python bindings for the ONE copy of the WIT — the one that lives in the Rust crate
#    that embeds the result, so there is no second copy in this package to drift from it.
#
#    `componentize-py` generates these again internally when it bakes, so this step is not an input
#    to step 3: it exists so that `src/shim.py` can be read, type-checked and navigated against the
#    real `wit_world` package rather than against an import that resolves nowhere.
echo "Generating the WIT bindings ..."
uvx --quiet --offline --from "componentize-py==$COMPONENTIZE_VERSION" componentize-py \
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
uvx --quiet --offline --from "componentize-py==$COMPONENTIZE_VERSION" componentize-py \
	--wit-path "$ROOT/crates/gg/wit" \
	--world sandbox \
	componentize shim \
	-p "$ROOT/$PACKAGE/src" \
	-p "$ROOT/$BUILD_DIR/vendor" \
	-o "$COMPONENT"

# WHAT USED TO BE STEP 4: `python.component.manifest.json`, written beside the component by
# `scripts/gg-artifact-manifest.mjs` — the SHA-256 of every file under `src/`, of `requirements.txt`,
# of this script, and of `crates/gg/wit`'s declarations, so that a test could recompute them from the
# checkout and fail when somebody had edited the SDK without re-running it. That question — *is the
# committed component older than the sources beside it?* — no longer has a subject. The component is
# not committed: `crates/gg-sandbox-artifacts/python` runs this script into its own cargo `OUT_DIR`
# on every build whose declared inputs moved, and `crates/gg` embeds what lands there.
#
# THIS ARM HAD THE STRONGEST CASE FOR THE MANIFEST AND IT IS THE SAME CASE FOR DELETING IT. The
# reason given here was that a manifest was the only thing that could cover this arm at all, because
# the build is not byte-reproducible and so nothing in CI could re-cut it and diff it. Read the other
# way round, that is a statement that the committed bytes were UNVERIFIABLE: the manifest could say
# what the build was told, never what it produced. Cutting the component on the build that embeds it
# needs no verification, because there is no gap to verify across.
#
# EVERY FILE THAT MANIFEST NAMED IS NOW IN THIS ARM'S RERUN SET, in `gg-artifact-build`'s table, and
# `requirements.txt` is there for the reason it was recorded here: step 1 vendors exactly what it
# pins and step 3 bakes the import closure of what the shim reached, so a wheel bumped without a
# rebuild is a library the catalogue names at one version and the guest carries at another. `build.sh`
# is there because the recipe is an input — the flags above decide what the artifact is.
#
# The `--ignore`d paths went with it and needed no replacement: `src/**/__pycache__` was excluded
# because CPython writes it beside the sources it imports and hashing a `.gitignore`d file would have
# failed the gate on a fresh checkout. A rerun set names DIRECTORIES a person edits, and cargo
# re-running this script because a `.pyc` was rewritten is a wasted build, not a failure — the same
# trade the Rust arm's `src/bindings.rs` exception makes, and cheap here where it was fatal there.

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
