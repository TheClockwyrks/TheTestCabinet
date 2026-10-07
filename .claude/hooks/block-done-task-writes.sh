#!/usr/bin/env bash
# PreToolUse(Write|Edit|NotebookEdit) hook: make finished issues immutable.
#
# The board holds a finished issue in a `done/` folder beside the open ones
# (tasks/README.md). Those files are history rather than live documents: they
# are kept for context while a set of issues is worked through, they are
# pruned periodically, and nothing may depend on what they say.
#
# That makes editing them pure waste, so an agent that keeps their cross-links
# and details current is spending real effort on files nobody reads. This hook
# denies the write outright rather than trusting each agent to decide.
#
# What is blocked: any Write, Edit or NotebookEdit whose target resolves to a
# path with a `done` segment under the repo's `tasks/` folder.
#
# What is NOT blocked, because none of them is a write to a finished issue:
#   - every open and blocked issue, and anything else under tasks/
#   - a `done/` folder anywhere outside tasks/
#   - finishing an issue, which moves its file into `done/`. That is a rename,
#     not a write, so it never reaches this hook.
#
# Two deliberate limits. Without `jq` the payload cannot be parsed at all, so
# the hook exits silently and allows the write, matching what the sibling hooks
# in this folder do; jq is present in the devcontainer. And symlinks are
# resolved when the check runs, so a link swapped between the check and the
# write would defeat it — that needs Bash, which the deny message rules out.

set -uo pipefail

input="$(cat)"

deny() {
	jq -n --arg reason "$1" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: $reason
		}
	}'
	exit 0
}

remedy="$(cat <<'TEXT'
What to do instead:
- Correcting or extending live information: put it in an open issue, the docs under apps/docs/src/content/docs/, or a new issue. Never in a finished one.
- Marking an issue done: move its file into the `done/` folder beside it, which is a rename rather than a write.
- Reopening work a finished issue describes: file a new issue for it, and leave the finished one where it is.

Do not retry this write, and do not work around it with Bash.
TEXT
)"

# Every path-bearing field the matched tools can carry: Write and Edit use
# file_path, NotebookEdit uses notebook_path. Collect them all and judge each,
# rather than taking the first one that is set — otherwise a payload carrying
# both could hide its real target behind a harmless-looking decoy.
targets_json="$(printf '%s' "$input" | jq -c '
	[.tool_input.file_path, .tool_input.notebook_path] | map(select(. != null))
' 2>/dev/null)" || exit 0

[[ -z "$targets_json" || "$targets_json" == "null" ]] && exit 0

# A path that is present but is not a string cannot be resolved, so it cannot be
# cleared either. Refuse it rather than letting an unreadable target through.
if printf '%s' "$targets_json" | jq -e 'any(.[]; type != "string")' >/dev/null 2>&1; then
	deny "Blocked: this tool call's target path is not a string, so it cannot be checked against the finished-issue rule.

Issues under a \`done/\` folder are immutable and every write to one is refused. Re-issue the call with the file path as a plain string."
fi

readarray -t targets < <(printf '%s' "$targets_json" | jq -r '.[]')

# The project root, so `tasks/` means THIS repo's board and not a `tasks/done/`
# path that happens to exist somewhere else on disk. $CLAUDE_PROJECT_DIR is set
# by the agent; the fallback keeps the hook testable when it is run by hand.
project_dir="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$project_dir" ]]; then
	project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
project_dir="$(realpath -m -- "$project_dir" 2>/dev/null || printf '%s' "$project_dir")"
tasks_dir="$project_dir/tasks"

# A relative target is resolved against the session's working directory. Only an
# absolute one is trusted: a relative `cwd` would make the verdict depend on
# where this hook process happens to be running from.
cwd="$(printf '%s' "$input" | jq -r 'if (.cwd | type) == "string" then .cwd else "" end' 2>/dev/null)"
[[ "$cwd" == /* ]] || cwd="$project_dir"

for target in "${targets[@]}"; do
	[[ -z "$target" ]] && continue

	[[ "$target" != /* ]] && target="$cwd/$target"

	# Normalise away `.`, `..` and symlinks so none of them can be used to reach
	# a completed issue by a path this hook would not recognise. `-m` does not
	# require the file to exist, which matters because Write creates new files.
	target="$(realpath -m -- "$target" 2>/dev/null || printf '%s' "$target")"

	# Must sit under the repo's tasks/ folder...
	[[ "$target" == "$tasks_dir"/* ]] || continue

	# ...and must have a `done` path segment below it. The leading slash and the
	# two patterns make this a whole-segment match that also catches the folder
	# itself, so `tasks/app/done-criteria.md` and `tasks/app/not-done/x.md` are
	# untouched while `tasks/app/done` is not.
	relative="${target#"$tasks_dir"/}"
	[[ "/$relative" == */done/* || "/$relative" == */done ]] || continue

	deny "Blocked: tasks/$relative is a finished issue, and those are immutable.

An issue in a \`done/\` folder is a record of work that is finished. Per .claude/skills/repo-tasks/SKILL.md such a file is history, is left where it is, and holds nothing anything else depends on. Keeping its links or details current is effort spent on a file that is not read.

$remedy"
done

exit 0
