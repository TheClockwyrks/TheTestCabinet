#!/usr/bin/env bash
# Fast pre-commit gate: spell-check the authored test-case and game-jam specs.
#
# This is the cspell half of the CI specs gate (scripts/ci/specs-lint.sh, which
# runs `npm run lint:specs` after `npm ci`), pulled out so `git commit` catches a
# typo before the pipeline does.
#
# It shells out to the repo's own locked cspell instead of letting pre-commit
# install one through `additional_dependencies`. That isolated install resolves
# cspell's transitive dictionary packages fresh at hook-install time, so it
# drifts from what package-lock.json pins for CI — and a @cspell/dict-en_us that
# knows one word more than the locked one is enough for this hook to wave through
# a commit CI then fails on. Running the locked binary keeps both verdicts
# identical, and deferring to the `spell` npm script keeps the flags in one place.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so npm finds package.json and cspell finds cspell.json
# regardless of the caller's working directory.
cd "$(git rev-parse --show-toplevel)"

if [[ ! -x node_modules/.bin/cspell ]]; then
	echo >&2 "cspell is not installed. Install the npm workspace first:"
	echo >&2 "    npm ci"
	exit 1
fi

# No file arguments: cspell.json's `files` globs already scope the check to
# test-cases/** and game-jams/**, so this checks exactly what CI checks.
if ! npm run --silent spell; then
	echo >&2
	echo "cspell found unknown words. Fix the typo, or — if the word is a real" >&2
	echo "domain or spec term — add it to .cspell/project-words.txt." >&2
	exit 1
fi
