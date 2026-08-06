#!/usr/bin/env bash
#
# Refresh the COMMITTED signature catalogue this package reflects out of its SDK:
#
#   crates/gg/src/sandbox/guests/python.signatures.json
#
# It is the whole of what a model is *told* about the Python surface — every object, signature,
# argument, type and type member the prompt renders and `view.open_docs_view` answers with, plus the
# set of libraries a program may import — and every word of it is reflected out of the code it
# describes: a docstring for the SDK, and `src/library.py`'s own module-scope imports for the library
# set. Nothing about this arm is authored in a table, a template or a prompt.
#
# Run it after changing anything under `src/gg/`: a signature, a docstring, an `Args:` entry, a type,
# a member, an API object's description, or the catalogue's own tables — and after changing
# `src/library.py`'s imports or the headings they are grouped under, which is what a model is shown
# as the libraries it has. (That second one also needs `build.sh`, because the imports decide what is
# baked; this decides what the prompt says about it.) `scripts/ci/contract-drift.sh`
# runs it too and fails on any diff, so a catalogue left stale is a red build rather than a system
# prompt describing a sandbox nobody has.
#
# It is deliberately SEPARATE from `build.sh`. Emitting the catalogue reads the sources statically
# and needs only `griffe`; baking the component needs `componentize-py`, a network and ~25 MB of
# output, and is not something CI should ever do. That split is what lets the drift gate cover the
# catalogue without carrying a componentizing toolchain — exactly as the TypeScript guest's
# `signatures` script is separate from its `build.sh`.
#
# Usage:
#   packages/gg-sandbox-python/signatures.sh            # write the catalogue
#   packages/gg-sandbox-python/signatures.sh --check    # verify the committed copy is current
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-python"
DEST_DIR="crates/gg/src/sandbox/guests"

# The documentation tool the catalogue is reflected with, pinned. `griffe` is Python's own answer to
# reading a package's API: it parses the sources statically — no import, which matters because every
# SDK module imports `wit_world`, and that only exists inside the baked component — and hands back
# each function's parameters, annotations, defaults, and the parsed sections of its Google-style
# docstring.
#
# Pinned rather than floating for the reason `build.sh` pins `componentize-py`: what this emits is a
# committed artifact, so a silent toolchain bump would land as an unexplained diff in a file two CI
# systems compare byte for byte.
GRIFFE_VERSION="2.1.0"

# Run through `uv`, which is this repo's Python toolchain — the devcontainer installs it
# (.devcontainer/tools/uv.sh), `build.sh` requires it, and `scripts/ci/install-uv.sh` puts it on a CI
# agent. It is not a preference: the devcontainer's base image has no usable `pip` and no
# `ensurepip`, and a CI agent's system Python refuses an install outright (PEP 668), so a private
# environment created by anything else does not exist on all three machines.
#
# `--no-project` because this package is not a Python project — it has no `pyproject.toml` and is
# never installed — and `--with` puts the pinned griffe in the ephemeral environment `uv` builds for
# the run. The environment is cached under uv's own cache, so a second run costs no download.
exec uv run --quiet --no-project --with "griffe==$GRIFFE_VERSION" \
	python "$PACKAGE/tools/signatures.py" --out-dir "$DEST_DIR" "$@"
