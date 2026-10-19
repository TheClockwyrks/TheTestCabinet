#!/usr/bin/env bash
# Smoke-checks an already-built `tcab` binary: it must print a version, show its
# help, and list exactly the commands the CLI overview documents
# (apps/docs/src/content/docs/components/cli/overview.md), none of the run-side
# commands the console took over. This is the single definition of "is
# this binary flat-out broken?" — it runs no build, needs no container runtime or
# API keys, and simply executes the binary it is given.
#
# The CI binary jobs (scripts/ci/binary-smoke.sh) run it on the freshly built
# binary, and on a release tag that same smoke-tested binary is what the pipeline
# publishes. So the gate that guards CI is exactly the gate that guards a release.
#
# Usage: smoke-binary.sh <path-to-tcab-binary>
set -euo pipefail

bin="${1:-}"
if [[ -z "$bin" ]]; then
	echo "usage: smoke-binary.sh <path-to-tcab-binary>" >&2
	exit 2
fi
if [[ ! -x "$bin" ]]; then
	echo "not an executable binary: $bin" >&2
	exit 1
fi

# A binary that cannot even print its version is broken at the most basic level
# (a missing dynamic dependency or loader mismatch surfaces right here).
version="$("$bin" --version)"
if [[ -z "$version" ]]; then
	echo "tcab --version produced no output" >&2
	exit 1
fi

# The binary is only sane if its subcommands are wired up, and only the slim CLI if
# the run-side ones are gone. The names are read off the help's command list, one
# per line, and compared whole, so `publish` is not mistaken for
# `publish-reference`. A carriage return is dropped for the Windows build.
help="$("$bin" --help)"
listed="$(awk '/^Commands:/ { inside = 1; next }
	inside && /^[[:space:]]*$/ { exit }
	inside { print $1 }' <<<"$help" | tr -d '\r')"
for subcommand in validate analyze capture-baselines seed prompt ingest \
	publish-reference publish-asset-reference; do
	if ! grep -qxF -- "$subcommand" <<<"$listed"; then
		echo "tcab --help is missing the '$subcommand' subcommand" >&2
		exit 1
	fi
done
for subcommand in run review publish harnesses orchestrators engines \
	test-case-groups; do
	if grep -qxF -- "$subcommand" <<<"$listed"; then
		echo "tcab --help still lists the removed '$subcommand' subcommand" >&2
		exit 1
	fi
done

echo "smoke OK: $version ($bin)"
