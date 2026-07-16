#!/usr/bin/env bash
# Smoke-checks an already-built `tcab` binary: it must print a version, show its
# help, and still expose its subcommands. This is the single definition of "is
# this binary flat-out broken?" — it runs no build, needs no container runtime or
# API keys, and simply executes the binary it is given.
#
# It is shared on purpose: the CI binary job (scripts/ci/binary-smoke.sh) runs it
# on the freshly built host binary, and the release pipeline runs the very same
# check on each platform's shipped artifact. So the gate that guards CI is exactly
# the gate that guards a release.
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

# The binary is only sane if its subcommands are wired up. Check a few of the
# less generic ones so a parser that silently lost its commands is caught.
help="$("$bin" --help)"
for subcommand in run validate harnesses publish orchestrators; do
	if ! grep -q -- "$subcommand" <<<"$help"; then
		echo "tcab --help is missing the '$subcommand' subcommand" >&2
		exit 1
	fi
done

echo "smoke OK: $version ($bin)"
