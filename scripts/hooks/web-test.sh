#!/usr/bin/env bash
# Pre-commit gate: run the front-end unit tests (vitest) across every npm
# workspace that has any.
#
# WHY THIS IS A COMMIT GATE AND NOT ONLY A CI ONE. The rule of thumb elsewhere in
# this config is that the slow gates stay in CI — and this one is not slow. The
# whole npm suite is a few thousand assertions that finish in well under a minute
# on a warm checkout, which is cheaper than clippy, already a commit gate.
#
# It is here because the tests existing was not enough: `/runs` shipped broken —
# it threw on first paint against a backend that predated a catalog field — while
# every test in the repo passed, and nothing local would have said otherwise even
# once a test covered it, because nothing local ran them. A suite that only runs
# after the push is a suite whose verdict arrives after the mistake. See the route
# smoke test (`packages/ui/src/app/pages/routeSmoke.test.tsx`), which is what now
# stands behind this gate.
#
# It runs the same command CI does (scripts/ci/web-test.sh), minus the `npm ci`
# and the package build — a working tree already has both, and re-doing them on
# every commit is what would make this slow. If the runtime packages have never
# been built in this checkout, the message below says so.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so npm resolves the workspaces regardless of the
# caller's working directory.
cd "$(git rev-parse --show-toplevel)"

if [[ ! -d node_modules ]]; then
	echo >&2 "The npm workspace is not installed. Install it first:"
	echo >&2 "    npm ci"
	exit 1
fi

# The workspace runtime packages publish their entry points from a built `dist/`,
# so a test that imports one fails to even collect without them. CI builds them
# every run because it starts from a clean checkout; here they are built once and
# then left alone, so only report the problem rather than paying for the build on
# every commit.
if [[ ! -d packages/run-record/dist ]]; then
	echo >&2 "The workspace runtime packages have not been built. Build them first:"
	echo >&2 "    npm run build:packages"
	exit 1
fi

if ! npm run --silent test --workspaces --if-present; then
	echo >&2
	echo "Front-end tests failed. Run them directly to iterate:" >&2
	echo "    npm run test -w @test-cabinet/ui" >&2
	exit 1
fi
