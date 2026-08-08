#!/usr/bin/env bash
# Fast pre-commit gate: lint the authored test-case and game-jam specs' Markdown
# style.
#
# This is the markdownlint half of the CI specs gate (scripts/ci/specs-lint.sh,
# which runs `npm run lint:specs` after `npm ci`), pulled out so `git commit`
# catches a style violation before the pipeline does.
#
# Like its cspell sibling (scripts/hooks/specs-spell.sh) it shells out to the
# repo's own locked markdownlint-cli2 rather than a copy pre-commit installs
# through `additional_dependencies`, so the rules this gate enforces are the ones
# package-lock.json pins for CI rather than whatever the transitive `markdownlint`
# range happens to resolve to today.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so npm finds package.json and markdownlint-cli2 finds
# .markdownlint-cli2.yaml regardless of the caller's working directory.
cd "$(git rev-parse --show-toplevel)"

if [[ ! -x node_modules/.bin/markdownlint-cli2 ]]; then
	echo >&2 "markdownlint-cli2 is not installed. Install the npm workspace first:"
	echo >&2 "    npm ci"
	exit 1
fi

# No file arguments: .markdownlint-cli2.yaml's globs already scope the lint to
# test-cases/**/*.md and game-jams/**/*.md, and CLI paths would be *added* to
# those globs rather than replacing them. So this lints exactly what CI lints.
exec npm run --silent lint:md
