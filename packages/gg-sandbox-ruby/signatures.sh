#!/usr/bin/env bash
#
# Regenerate the COMMITTED signature catalogue for the Ruby guest:
#
#   crates/gg/src/sandbox/guests/ruby.signatures.json
#
# It is the whole of what a model is *told* about this arm's surface — every signature, every
# argument description, every type and every one of a type's members — and it is reflected out of
# the YARD documentation written on `packages/gg-sandbox-ruby/src/gg/`, plus the library set
# `src/library.rb` declares. Nothing about the SDK is authored anywhere else, which is what stops a
# description from drifting from the thing it describes.
#
# Split from `build.sh` for the reason the Python guest's `signatures.sh` is split from its own
# build: this needs only Ruby and YARD, so `scripts/ci/contract-drift.sh` runs it and fails on any
# diff, where baking the component needs `componentize-js` and emits 20 MB.
#
# YARD is pinned and installed with `gem install --user-install`, which needs no root and no
# `bundle`: the three machines that run this — a devcontainer, an Azure agent and a GitHub runner —
# all ship a Ruby, and what has to be the same across them is the reflector, not the interpreter.
#
# Usage:
#   packages/gg-sandbox-ruby/signatures.sh
set -euo pipefail

# The YARD release the catalogue is reflected with. Pinned for the reason every other generator's
# tool is: a reflector that changed what it extracts would land as an unexplained diff in a file a
# model reads.
YARD_VERSION="0.9.37"

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v ruby >/dev/null 2>&1; then
	echo "error: this needs a Ruby on PATH to run YARD with. Install one and try again." >&2
	exit 1
fi

if ! ruby -e 'gem "yard", ARGV[0]' "$YARD_VERSION" >/dev/null 2>&1; then
	echo "Installing yard $YARD_VERSION ..."
	gem install --user-install --no-document yard -v "$YARD_VERSION" >/dev/null
fi

GG_YARD_VERSION="$YARD_VERSION" ruby packages/gg-sandbox-ruby/tools/signatures.rb
