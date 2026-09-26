#!/usr/bin/env bash
# Gate: the SEEDED spec text must not name this project or say how a run is judged.
#
# The spec counterpart of seeded-contract-check.sh. That gate covers the packages a
# run vendors; this one covers what a model is guaranteed to read — every
# `test-cases/**/vX.Y.Z/` and `game-jams/**/vX.Y.Z/` version's `prompt.hbs` and
# everything under its `specs/`, plus the shared prompt preambles
# `crates/core/src/prompt.rs` prepends — and holds them to the rule in
# `guides/authoring/writing-case-specifications.md` § "Keeping evaluation out of
# the seeded set". Frozen versions cannot be edited, so their hits are reported on
# one line rather than failed. The list, the exemption for `tcab-blend`, and how to
# fix a failure are all in the header of scripts/ci/spec-vocabulary-check.mjs.
#
# Node only, no `npm ci`: the checker is dependency-free and finishes in well under
# a second, which is what lets it sit on the commit hook as well as in the pipeline.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "check the vocabulary of every seeded spec and prompt"
node scripts/ci/spec-vocabulary-check.mjs "$@"
