# shellcheck shell=bash
# Shared helpers for the frozen-directory gate.
#
# A directory is "frozen" by placing a `.frozen` marker file in it. The marker
# records a digest of the directory's tracked contents at the moment it was
# frozen; `frozen_verify` recomputes that digest and fails if anything under the
# directory has been added, removed, edited, renamed, or had its mode changed.
#
# The point is test-case versions: once runs have been recorded against
# `test-cases/<type>/<difficulty>/<slug>/vX.Y.Z/`, that directory is history.
# Editing it silently invalidates every run already scored against it — the runs
# stay in the metrics, but they were produced from a prompt and spec that no
# longer exist. The fix for a case that needs changing is a new version
# directory, never an edit in place.
#
# Sourced (not executed) by scripts/hooks/frozen-paths.sh (the commit gate),
# scripts/ci/frozen-check.sh (the CI backstop), and scripts/freeze.sh (which
# writes the markers).
#
# The digest is deliberately computed from the git index rather than the
# worktree, so the commit hook sees exactly what is about to be committed and CI
# sees exactly what was. It covers content, path, and file mode; the marker file
# itself is excluded (it cannot contain its own digest).

FROZEN_MARKER=".frozen"
readonly FROZEN_MARKER

# Every tracked frozen directory, one per line, sorted.
frozen_dirs() {
	git ls-files -- "*/$FROZEN_MARKER" "$FROZEN_MARKER" |
		sed "s:\(^\|/\)$FROZEN_MARKER\$::" |
		sed 's:^$:.:' |
		sort
}

# Digest of a directory's tracked contents as currently staged, excluding the
# marker. `git ls-files -s` emits "<mode> <blob> <stage>\t<path>" in sorted
# order, so the digest is stable across machines and checkouts.
frozen_digest() {
	local dir="$1"
	git ls-files -s -- "$dir" |
		awk -v skip="$dir/$FROZEN_MARKER" '
			{ path = $0; sub(/^[^\t]*\t/, "", path); if (path != skip) print }
		' |
		sha256sum |
		cut -d' ' -f1
}

# The digest recorded in a directory's marker, or empty if the marker is
# malformed (which callers must treat as an error, not as "unfrozen").
frozen_recorded() {
	sed -n 's/^digest = "\(.*\)"$/\1/p' "$1/$FROZEN_MARKER"
}

# Write (or rewrite) a directory's marker so it records the directory's current
# staged contents. `reason` is free text stored in the marker for the next
# reader.
frozen_write_marker() {
	local dir="$1" reason="$2" today="$3"
	# Compute the digest with any existing marker already excluded, so
	# re-freezing an already-frozen directory is idempotent.
	local digest
	digest="$(frozen_digest "$dir")"
	cat >"$dir/$FROZEN_MARKER" <<EOF
# FROZEN — this directory must not change.
#
# Runs have been recorded against this test-case version. Editing anything here
# would silently invalidate them: the runs stay in the metrics, but the prompt
# and specs they were produced from would no longer exist. To change the case,
# add a new version directory instead of editing this one.
#
# \`digest\` is the SHA-256 of this directory's \`git ls-files -s\` listing with
# this marker excluded. The commit hook (scripts/hooks/frozen-paths.sh) and CI
# (scripts/ci/frozen-check.sh) both recompute it and fail on any difference.
#
# Deliberately unfreezing means deleting this file in its own reviewable commit.
digest = "$digest"
frozen_at = "$today"
reason = "$reason"
EOF
}

# Verify every frozen directory. Prints a report for each violation and returns
# non-zero if there were any. `context` is either "commit" (the pre-commit gate,
# which can name the offending staged files) or "ci" (the backstop).
frozen_verify() {
	local context="${1:-ci}"
	local dir recorded actual violations=0 malformed=0

	while IFS= read -r dir; do
		[ -n "$dir" ] || continue

		recorded="$(frozen_recorded "$dir")"
		if [ -z "$recorded" ]; then
			echo >&2 "frozen: $dir/$FROZEN_MARKER has no 'digest = \"...\"' line."
			echo >&2 "        Rewrite it with: scripts/freeze.sh $dir"
			malformed=$((malformed + 1))
			continue
		fi

		actual="$(frozen_digest "$dir")"
		[ "$actual" = "$recorded" ] && continue

		violations=$((violations + 1))
		echo >&2
		echo >&2 "FROZEN directory changed: $dir"

		if [ "$context" = "commit" ]; then
			# The marker itself is excluded from the digest, so it is never the
			# thing that broke the check — listing it would only mislead.
			local staged
			staged="$(git diff --cached --name-only -- "$dir" | grep -v "/$FROZEN_MARKER\$" || true)"
			if [ -n "$staged" ]; then
				echo >&2 "  Staged changes under it:"
				while IFS= read -r file; do
					echo >&2 "    $file"
				done <<<"$staged"
			fi
		else
			echo >&2 "  Inspect with: git diff -- $dir"
		fi
	done < <(frozen_dirs)

	if [ "$violations" -gt 0 ]; then
		echo >&2
		echo >&2 "Runs have been recorded against these versions, so their contents are"
		echo >&2 "history: changing them invalidates results already scored against them."
		echo >&2
		echo >&2 "If you meant to revise the case, create a new version directory and put"
		echo >&2 "the changes there. If you genuinely intend to unfreeze, delete the"
		echo >&2 "$FROZEN_MARKER marker in its own commit so the decision is reviewable."
		echo >&2
	fi

	[ "$((violations + malformed))" -eq 0 ]
}
