#!/usr/bin/env bash
# Table test for block-done-task-writes.sh. Run it directly:
#   ./block-done-task-writes.test.sh
#
# Each case feeds the hook a PreToolUse payload and asserts allow vs deny. The
# bias here is the opposite of block-bare-sleep's: a completed issue is
# immutable, so a path that reaches one must be denied even if the spelling is
# unusual. Wrongly allowing a write loses nothing visible at the time, which is
# exactly why it has to be caught here.
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/block-done-task-writes.sh"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0; fail=0

verdict_of() { # payload-json -> prints deny|allow, fails on malformed output
	local payload="$1" out
	out="$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$PROJECT_DIR" "$HOOK")"
	if [[ -z "$out" ]]; then
		printf 'allow'
	elif printf '%s' "$out" |
		jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
		printf 'deny'
	else
		# Anything else on stdout corrupts the hook protocol, so it is its own
		# failure rather than a third verdict.
		printf 'malformed'
	fi
}

check() { # expected(deny|allow) tool path [cwd]
	local expected="$1" tool="$2" path="$3" cwd="${4:-$PROJECT_DIR}"
	local key=file_path payload
	[[ "$tool" == NotebookEdit ]] && key=notebook_path
	payload="$(jq -n --arg t "$tool" --arg k "$key" --arg p "$path" --arg c "$cwd" \
		'{tool_name:$t, cwd:$c, tool_input:{($k):$p}}')"
	report "$expected" "$(verdict_of "$payload")" "$tool" "$path"
}

check_raw() { # expected(deny|allow) label payload-json
	report "$1" "$(verdict_of "$3")" raw "$2"
}

report() { # expected actual tool label
	if [[ "$2" == "$1" ]]; then
		pass=$((pass+1)); printf '  ok   [%s %s] %s\n' "$2" "$3" "$4"
	else
		fail=$((fail+1)); printf 'FAIL  expected=%s got=%s [%s] %s\n' "$1" "$2" "$3" "$4"
	fi
}

echo "--- must DENY: completed issues ---"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/some-issue.md"
check deny Edit  "$PROJECT_DIR/tasks/spec-cabinet/lab/done/some-issue.md"
check deny Write "$PROJECT_DIR/tasks/backend/ui/done/an-issue.md"
check deny Edit  "$PROJECT_DIR/tasks/gg-sdk/state/done/another-issue.md"
check deny Write "$PROJECT_DIR/tasks/backlog/ci/done/new-file-that-does-not-exist.md"
check deny NotebookEdit "$PROJECT_DIR/tasks/spec-cabinet/lab/done/notes.ipynb"

echo "--- must DENY: any depth, and non-Markdown alongside them ---"
check deny Write "$PROJECT_DIR/tasks/done/shallow.md"
check deny Write "$PROJECT_DIR/tasks/a/b/c/d/done/deep.md"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/nested/further.md"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/README"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/issue.md.bak"

echo "--- must DENY: paths that reach done/ by an unusual spelling ---"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/../lab/done/issue.md"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/./issue.md"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet//lab//done//issue.md"
check deny Write "$PROJECT_DIR/./tasks/spec-cabinet/lab/done/issue.md"
check deny Write "$PROJECT_DIR/tasks/backlog/../spec-cabinet/lab/done/issue.md"
check deny Write "tasks/spec-cabinet/lab/done/issue.md"
check deny Write "spec-cabinet/lab/done/issue.md" "$PROJECT_DIR/tasks"
check deny Write "../done/issue.md" "$PROJECT_DIR/tasks/spec-cabinet/lab/blocked"

echo "--- must DENY: the done folder itself, however it is spelled ---"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done/"
check deny Write "$PROJECT_DIR/tasks/spec-cabinet/lab/done//"

echo "--- must DENY: a decoy path must not mask the real target ---"
# Judging only the first path-bearing field would let the second one through.
check_raw deny 'file_path decoy + notebook_path in done/' "$(jq -n --arg d "$PROJECT_DIR" '{
	tool_name:"NotebookEdit", cwd:$d,
	tool_input:{file_path:"/tmp/harmless.md", notebook_path:($d + "/tasks/spec-cabinet/lab/done/x.ipynb")}}')"
check_raw deny 'empty file_path + notebook_path in done/' "$(jq -n --arg d "$PROJECT_DIR" '{
	tool_name:"NotebookEdit", cwd:$d,
	tool_input:{file_path:"", notebook_path:($d + "/tasks/spec-cabinet/lab/done/x.ipynb")}}')"
check_raw deny 'file_path in done/ + harmless notebook_path' "$(jq -n --arg d "$PROJECT_DIR" '{
	tool_name:"Write", cwd:$d,
	tool_input:{file_path:($d + "/tasks/spec-cabinet/lab/done/x.md"), notebook_path:"/tmp/harmless.ipynb"}}')"

echo "--- must DENY: a target that cannot be read as a path ---"
check_raw deny 'file_path is an array' "$(jq -n --arg d "$PROJECT_DIR" '{
	tool_name:"Write", cwd:$d, tool_input:{file_path:[($d + "/tasks/spec-cabinet/lab/done/x.md")]}}')"
check_raw deny 'file_path is an object' "$(jq -n '{
	tool_name:"Write", cwd:"/workspaces", tool_input:{file_path:{a:"b"}}}')"
check_raw deny 'file_path is a number' "$(jq -n '{
	tool_name:"Write", cwd:"/workspaces", tool_input:{file_path:12}}')"

echo "--- a relative cwd is discarded for the project root, not trusted ---"
# Otherwise the verdict would depend on where this hook process happens to run.
check_raw deny 'relative cwd, path reaches done/ from the root' "$(jq -n '{
	tool_name:"Write", cwd:"some/relative/dir", tool_input:{file_path:"tasks/spec-cabinet/lab/done/x.md"}}')"
check_raw deny 'null cwd, path reaches done/ from the root' "$(jq -n '{
	tool_name:"Write", cwd:null, tool_input:{file_path:"tasks/spec-cabinet/lab/done/x.md"}}')"
check_raw deny 'numeric cwd, path reaches done/ from the root' "$(jq -n '{
	tool_name:"Write", cwd:7, tool_input:{file_path:"tasks/spec-cabinet/lab/done/x.md"}}')"
# The same relative path judged from the root lands outside tasks/ entirely, so
# the relative cwd it was written against buys it nothing.
check allow Write "lab/done/issue.md" "tasks/spec-cabinet"

echo "--- must ALLOW: open and blocked issues ---"
check allow Write "$PROJECT_DIR/tasks/spec-cabinet/lab/an-open-issue.md"
check allow Edit  "$PROJECT_DIR/tasks/spec-cabinet/lab/an-open-issue.md"
check allow Write "$PROJECT_DIR/tasks/spec-cabinet/lab/blocked/a-blocked-issue.md"
check allow Write "$PROJECT_DIR/tasks/README.md"
check allow Write "tasks/backlog/ci/an-open-issue.md"
check_raw allow 'both fields, neither in done/' "$(jq -n --arg d "$PROJECT_DIR" '{
	tool_name:"Write", cwd:$d,
	tool_input:{file_path:($d + "/tasks/spec-cabinet/lab/open.md"), notebook_path:"/tmp/x.ipynb"}}')"

echo "--- must ALLOW: 'done' that is not a whole path segment ---"
check allow Write "$PROJECT_DIR/tasks/backlog/done-criteria.md"
check allow Write "$PROJECT_DIR/tasks/backlog/not-done/an-issue.md"
check allow Write "$PROJECT_DIR/tasks/backlog/done-soon/an-issue.md"
check allow Write "$PROJECT_DIR/tasks/backlog/ci/predone/an-issue.md"
check allow Write "$PROJECT_DIR/tasks/backlog/ci/done.md"
check allow Write "$PROJECT_DIR/tasks/backlog/ci/undone/an-issue.md"

echo "--- must ALLOW: done/ outside the repo's tasks/ board ---"
check allow Write "$PROJECT_DIR/apps/docs/src/content/docs/components/done/page.md"
check allow Write "$PROJECT_DIR/test-suites/example/tasks/done/issue.md"
check allow Write "$PROJECT_DIR/tasks-archive/spec-cabinet/done/issue.md"
check allow Write "/tmp/tasks/spec-cabinet/done/issue.md" "/tmp"
check allow Write "$PROJECT_DIR/../elsewhere/tasks/spec-cabinet/done/issue.md"
# Case matters: the board is on a case-sensitive filesystem, so DONE/ is a
# different directory and not a completed issue.
check allow Write "$PROJECT_DIR/tasks/spec-cabinet/lab/DONE/issue.md"

echo "--- must ALLOW: nothing to judge ---"
check allow Write ""
check allow Edit  ""
check_raw allow 'no tool_input' '{"tool_name":"Write","cwd":"/workspaces/the-test-cabinet"}'
check_raw allow 'empty object' '{}'
check_raw allow 'tool_input is null' '{"tool_name":"Write","tool_input":null}'

echo "--- must not crash or emit stray stdout on junk input ---"
# Any verdict other than allow/deny means the hook printed something that would
# corrupt the protocol. These are all unparseable, so allow is the only answer.
check_raw allow 'empty stdin' ''
check_raw allow 'not JSON' 'this is not json'
check_raw allow 'truncated JSON' '{"tool_input":{"file_path":'
check_raw allow 'JSON scalar' '42'
check_raw allow 'JSON array' '[1,2,3]'
check_raw allow 'JSON null' 'null'
check_raw allow 'tool_input is a string' '{"tool_input":"nope"}'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
