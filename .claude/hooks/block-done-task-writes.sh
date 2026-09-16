#!/usr/bin/env bash
# PreToolUse(Write|Edit|NotebookEdit) hook: make completed issues immutable.
#
# A completed issue moves into a `done/` folder beside the open ones in its area
# folder. From that moment it is history, not a live document: CLAUDE.md says
# nothing under tasks/ is authoritative and that a landed issue's durable
# conclusions belong in apps/docs/, and the repo-tasks skill
# (.claude/skills/repo-tasks/SKILL.md) makes completed issues immutable.
#
# That makes editing them pure waste. There are hundreds of them today and there
# will be thousands, so an agent that keeps their cross-links and details
# current is spending real effort on files nobody reads. This hook denies the
# write outright rather than trusting each agent to decide.
#
# What is blocked: any Write, Edit or NotebookEdit whose target resolves to a
# path with a `done` segment under the repo's `tasks/` folder.
#
# What is NOT blocked, because neither is a write to a completed issue:
#   - open and blocked issues, and anything else under tasks/
#   - a `done/` folder anywhere outside tasks/
#   - moving an issue INTO done/, which is how an issue is completed. That is a
#     rename (`git mv`), not a write, so it never reaches this hook.
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
- Correcting or extending live information: put it in the open issue, the docs under apps/docs/src/content/docs/, or a new issue. Never in a completed one.
- Completing an issue: move the file into done/ with `git mv`. A move is not a write and is not blocked.
- Reopening an issue: `git mv` it back out of done/, then edit it where it lands.

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
	deny "Blocked: this tool call's target path is not a string, so it cannot be checked against the completed-issue rule.

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

	deny "Blocked: tasks/$relative is a completed issue, and completed issues are immutable.

An issue in a \`done/\` folder is a record of work that is finished. Per .claude/skills/repo-tasks/SKILL.md those files are historical context only and must never hold information anything else depends on; CLAUDE.md puts a landed issue's durable conclusions in apps/docs/ instead. Keeping their links or details current is effort spent on files that are not read.

$remedy"
done

exit 0
