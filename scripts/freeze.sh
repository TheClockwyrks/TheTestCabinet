#!/usr/bin/env bash
# Freeze one or more directories: record a `.frozen` marker so the commit hook
# and CI reject any later change to their contents.
#
# Freeze a test-case version as soon as you trigger the first run against it —
# that is the moment it stops being editable, and the moment you are least
# likely to be thinking about it.
#
#     scripts/freeze.sh test-cases/end-to-end/easy/carom/v1.0.0
#     scripts/freeze.sh --reason "published to prod" test-cases/.../v1.0.0
#
# Re-running against an already-frozen directory is idempotent for unchanged
# contents, and re-baselines the digest if the contents have legitimately moved
# (a repo-wide path restructure, say) — so it is also the "I meant that change"
# escape hatch, with the digest change visible in review.
#
# See scripts/lib/frozen.sh for the mechanism.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=/dev/null
source scripts/lib/frozen.sh

reason="runs recorded against this version"
today="$(date -u +%Y-%m-%d)"

while [ $# -gt 0 ]; do
	case "$1" in
	--reason)
		reason="${2:?--reason needs a value}"
		shift 2
		;;
	-h | --help)
		sed -n '2,18p' "$0" | cut -c3-
		exit 0
		;;
	-*)
		echo >&2 "unknown flag: $1"
		exit 2
		;;
	*) break ;;
	esac
done

[ $# -gt 0 ] || {
	echo >&2 "usage: scripts/freeze.sh [--reason TEXT] <dir>..."
	exit 2
}

for dir in "$@"; do
	dir="${dir%/}"
	[ -d "$dir" ] || {
		echo >&2 "not a directory: $dir"
		exit 1
	}
	# The digest is computed from the index, so anything not yet staged would be
	# invisible to it and the marker would record the wrong contents.
	if [ -n "$(git status --porcelain -- "$dir" | grep -v "$FROZEN_MARKER\$" || true)" ]; then
		echo >&2 "refusing to freeze $dir: it has uncommitted changes."
		echo >&2 "Commit or stash them first so the digest records settled contents."
		exit 1
	fi

	frozen_write_marker "$dir" "$reason" "$today"
	git add -- "$dir/$FROZEN_MARKER"
	echo "froze $dir"
done
