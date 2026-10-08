#!/usr/bin/env bash
# Table test for block-bare-sleep.sh. Run it directly: ./block-bare-sleep.test.sh
#
# Each case feeds the hook a PreToolUse payload and asserts allow vs deny. The
# bias is fail-open: a command that does any real work must be allowed, because
# wrongly blocking real work costs more than missing one bare sleep.
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/block-bare-sleep.sh"
pass=0; fail=0

check() { # expected(deny|allow) background(true|false) command
	local expected="$1" bg="$2" cmd="$3"
	local out verdict
	out="$(jq -n --arg c "$cmd" --argjson b "$bg" \
		'{tool_name:"Bash", tool_input:{command:$c, run_in_background:$b}}' | "$HOOK")"
	if [[ -n "$out" ]] && printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
		verdict=deny
	else
		verdict=allow
	fi
	if [[ "$verdict" == "$expected" ]]; then
		pass=$((pass+1)); printf '  ok   [%s bg=%s] %s\n' "$verdict" "$bg" "$cmd"
	else
		fail=$((fail+1)); printf 'FAIL  expected=%s got=%s [bg=%s] %s\n' "$expected" "$verdict" "$bg" "$cmd"
	fi
}

echo "--- must DENY: backgrounded bare sleep ---"
check deny true 'sleep 300'
check deny true 'sleep 5m'
check deny true 'sleep 30'
check deny true 'sleep 1'
check deny true 'sleep 300; echo done'
check deny true 'sleep 60 && echo ready'
check deny true 'sleep 120 ; date'
check deny true '  sleep   300  '
check deny true 'sleep 0.5'
check deny true '/bin/sleep 300'
check deny true 'sleep 100; sleep 200'

echo "--- must DENY: self-backgrounded trailing & ---"
check deny false 'sleep 300 &'
check deny false 'sleep 5 &'
check deny false 'sleep 600 & '

echo "--- must DENY: long foreground bare sleep ---"
check deny false 'sleep 300'
check deny false 'sleep 31'
check deny false 'sleep 5m'
check deny false 'sleep 1h'
check deny false 'sleep 20; sleep 20'
check deny false 'sleep 300; echo waited'

echo "--- must ALLOW: short foreground sleep ---"
check allow false 'sleep 2'
check allow false 'sleep 0.5'
check allow false 'sleep 30'
check allow false 'sleep 10 && echo ok'

echo "--- must ALLOW: poll loops (the sanctioned pattern) ---"
check allow true 'until curl -sf http://localhost:3000/health >/dev/null; do sleep 5; done'
check allow true 'while ! test -f /tmp/done; do sleep 10; done'
check allow true 'for i in 1 2 3; do sleep 60; done'
check allow true 'until grep -q "Ready in" dev.log; do sleep 0.5; done'
check allow false 'if sleep 300; then echo hi; fi'

echo "--- must ALLOW: sleep alongside real work ---"
check allow true 'sleep 5; cargo nextest run --workspace'
check allow true 'npm run build && sleep 2'
check allow true 'cargo build --release'
check allow true 'sleep 300 | tee log.txt'
check allow false 'python train.py'
check allow false 'sleep 2 && curl -sf localhost:8080'
check allow true 'gh pr checks 123'

echo "--- must ALLOW: not a sleep at all ---"
check allow true 'echo sleep 300'
check allow false 'grep sleep script.sh'
check allow false 'sleeper --wait 300'
check allow false 'my-sleep 300'
check allow false ''

echo "--- must DENY: bypass attempts ---"
check deny true 'sleep 300; echo done'
check deny true 'sleep 300; echo "waiting for the build"'
check deny true 'nohup sleep 300'
check deny false 'nohup sleep 300 &'
check deny true 'sleep 300 > /dev/null'
check deny true 'echo waiting; sleep 300; echo done'
check deny false 'setsid sleep 900'
check deny true 'true && sleep 300'


printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
