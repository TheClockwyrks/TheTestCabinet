#!/usr/bin/env bash
# Table test for block-self-matching-pgrep.sh. Run it directly:
#   ./block-self-matching-pgrep.test.sh
#
# Each case feeds the hook a PreToolUse payload and asserts allow vs deny. The
# bias is fail-open: the deny only fires when the pattern demonstrably matches
# the command's own text, because wrongly blocking a real wait costs more than
# missing one self-match.
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/block-self-matching-pgrep.sh"
pass=0; fail=0

check() { # expected(deny|allow) command
	local expected="$1" cmd="$2"
	local out verdict
	out="$(jq -n --arg c "$cmd" \
		'{tool_name:"Bash", tool_input:{command:$c, run_in_background:true}}' | "$HOOK")"
	if [[ -n "$out" ]] && printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
		verdict=deny
	else
		verdict=allow
	fi
	if [[ "$verdict" == "$expected" ]]; then
		pass=$((pass+1)); printf '  ok   [%s] %s\n' "$verdict" "$cmd"
	else
		fail=$((fail+1)); printf 'FAIL  expected=%s got=%s  %s\n' "$expected" "$verdict" "$cmd"
	fi
}

echo "--- must DENY: pgrep -f matching its own command line ---"
# These are the exact shapes found deadlocked in the wild.
check deny 'until ! pgrep -f "cargo nextest" >/dev/null 2>&1; do sleep 10; done; echo "nextest finished"'
check deny 'until ! pgrep -f "nextest run -p pluto-node-api" >/dev/null 2>&1; do sleep 15; done; echo done'
check deny 'while pgrep -f "auriga-core -p auriga-api" >/dev/null 2>&1; do sleep 30; done; echo DONE'
check deny 'until ! pgrep -f "cargo doc" >/dev/null 2>&1; do sleep 15; done'
check deny 'until ! pgrep -f "nextest run -P slowdiag" >/dev/null 2>&1; do sleep 15; done'
check deny 'pgrep -f "cargo build"'
check deny 'pgrep -af "cargo build"'
check deny 'pgrep -fa "cargo build"'
check deny 'pkill -f "cargo build"'
check deny 'pgrep -f -- "cargo build"'
check deny '/usr/bin/pgrep -f "cargo build"'
check deny "until ! pgrep -f 'npm run build' >/dev/null; do sleep 5; done"

echo "--- must ALLOW: the bracket trick cannot self-match ---"
check allow 'until ! pgrep -f "[c]argo doc" >/dev/null 2>&1; do sleep 15; done'
check allow 'until ! pgrep -f "[c]argo nextest" >/dev/null 2>&1; do sleep 10; done'
check allow 'pgrep -f "[n]extest run -p wire-casing"'

echo "--- must ALLOW: -x matches process names, so a bash loop never self-matches ---"
check allow 'until ! pgrep -x cargo-nextest >/dev/null 2>&1; do sleep 10; done; echo done'
check allow 'pgrep -x rustc'
check allow 'pkill -x sleep'

echo "--- must DENY: an unquoted pattern self-matches just as surely ---"
# `pgrep -f X` writes X into its own command line, so it matches itself whatever
# X is. Quoting changes nothing; only a pattern that cannot match its own source
# text is safe.
check deny 'until ! pgrep -f postgres >/dev/null; do sleep 5; done'
check deny 'pgrep -f "some-daemon --serve"'

echo "--- must ALLOW: a pattern built at runtime is not literal in the command ---"
# shellcheck disable=SC2016
check allow 'pgrep -f "$WAIT_PATTERN"'

echo "--- must ALLOW: an anchored pattern cannot match the command line ---"
check allow 'pgrep -f "^/usr/sbin/nginx$"'

echo "--- must ALLOW: value-taking options are not mistaken for the pattern ---"
# If -u's value were read as the pattern, "foobar" occurs in the command and
# this would deny. Allowing it proves the option value was skipped correctly.
check allow 'pgrep -f -u foobar "[p]ostgres"'

echo "--- must DENY: ps | grep self-match inside a loop ---"
check deny 'until ! ps aux | grep -q "cargo nextest"; do sleep 10; done'
check deny 'while ps aux | grep "cargo build" >/dev/null; do sleep 5; done'

echo "--- must ALLOW: ps | grep outside a loop is one wrong line, not a hang ---"
check allow 'ps aux | grep "cargo nextest"'
check allow "ps -eo pid,args | grep -E '[p]grep|[p]kill'"

echo "--- must ALLOW: ordinary commands ---"
check allow 'cargo nextest run --workspace'
check allow 'git status --porcelain'
check allow 'echo "pgrep is mentioned but not run"'
check allow 'until curl -sf http://localhost:3000/health >/dev/null 2>&1; do sleep 5; done'
# shellcheck disable=SC2016
check allow 'mycmd & pid=$!; while kill -0 "$pid" 2>/dev/null; do sleep 5; done'

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
