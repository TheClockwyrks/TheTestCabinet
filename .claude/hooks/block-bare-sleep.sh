#!/usr/bin/env bash
# PreToolUse(Bash) hook: block a bare `sleep` used as a wait, and steer the
# agent to a wait that actually waits.
#
# The failure this exists to stop: an agent starts a long command, then runs
# `sleep 300` with run_in_background set. A backgrounded command returns to the
# agent immediately, so the sleep waits zero seconds. The agent wakes at once,
# finds the work still running, and queues another `sleep 300` a few seconds
# later. The interval never elapses, a shell leaks on every repeat, and each
# repeat costs a turn.
#
# What is blocked:
#   - any backgrounded command whose whole body is sleeps (and trivia)
#   - the same shape written as a self-backgrounding `sleep 300 &`
#   - a foreground bare sleep longer than $MAX_FOREGROUND_SECONDS
#
# What is NOT blocked, because it is the sanctioned pattern:
#   - `sleep` inside a loop or conditional, e.g.
#       until curl -sf localhost:3000; do sleep 5; done
#     A poll loop exits when its condition holds, so backgrounding it yields
#     exactly one notification at the moment the condition becomes true.
#   - a short foreground `sleep` used to settle a race.

set -uo pipefail

# A foreground sleep at or under this many seconds is a race settler, not a
# wait for work to finish. Above it, the agent should be using a real wait.
MAX_FOREGROUND_SECONDS=30

input="$(cat)"

command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
background="$(printf '%s' "$input" | jq -r '
	.tool_input.run_in_background // .tool_input.runInBackground // false
	| if . == true or . == "true" then "true" else "false" end
')"

[[ -z "$command" ]] && exit 0

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

# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

# A trailing unquoted `&` backgrounds the command itself, which reproduces the
# same instant return even when the tool call is nominally in the foreground.
if [[ "$command" =~ \&[[:space:]]*$ ]]; then
	background=true
fi

# Split the command into segments on every shell separator, then require that
# every segment is either a sleep or something inert. A segment that does real
# work — including a loop or conditional keyword, which means a poll loop — is
# proof this is not a bare sleep, and the command is allowed through.
#
# The split is deliberately blunt: it cuts inside quotes too. Over-splitting can
# only manufacture segments that look like real work, and real work is allowed,
# so the bias is toward letting a command run.
readarray -t segments < <(
	printf '%s' "$command" |
		tr ';&|\n' '\n' |
		sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' |
		grep -v '^$'
)

(( ${#segments[@]} == 0 )) && exit 0

total_seconds=0
saw_sleep=false

# Convert one `sleep` argument (300, 5m, 1.5h) into seconds, rounded down.
to_seconds() {
	local arg="$1" value unit
	[[ "$arg" =~ ^([0-9]+(\.[0-9]+)?)([smhd]?)$ ]] || return 1
	value="${BASH_REMATCH[1]}"
	unit="${BASH_REMATCH[3]}"
	case "$unit" in
		m) value="$(awk -v v="$value" 'BEGIN { print v * 60 }')" ;;
		h) value="$(awk -v v="$value" 'BEGIN { print v * 3600 }')" ;;
		d) value="$(awk -v v="$value" 'BEGIN { print v * 86400 }')" ;;
	esac
	awk -v v="$value" 'BEGIN { printf "%d", v }'
}

for segment in "${segments[@]}"; do
	read -r -a words <<<"$segment"

	# Peel off wrappers that do not change what is being run, so that
	# `nohup sleep 300` is still recognised as a sleep.
	while (( ${#words[@]} > 0 )); do
		case "${words[0]}" in
			nohup | setsid | command | exec | time | builtin)
				words=("${words[@]:1}")
				;;
			*)
				break
				;;
		esac
	done

	(( ${#words[@]} == 0 )) && continue

	case "${words[0]}" in
		sleep | /bin/sleep | /usr/bin/sleep)
			saw_sleep=true
			for arg in "${words[@]:1}"; do
				seconds="$(to_seconds "$arg")" || continue
				total_seconds=$(( total_seconds + seconds ))
			done
			;;
		# Inert companions an agent tends to staple onto a sleep. They do no
		# work, so their presence does not make this a real command.
		echo | printf | true | : | date | wait)
			;;
		*)
			# A segment that does real work. Not a bare sleep.
			exit 0
			;;
	esac
done

[[ "$saw_sleep" == true ]] || exit 0

# ---------------------------------------------------------------------------
# Guidance
# ---------------------------------------------------------------------------

remedy="$(cat <<'TEXT'
Wait one of these ways instead, and pick by what you are actually waiting for:

1. Do not wait at all. Work you started with Bash run_in_background re-invokes
   you when it exits and hands you its output file. There is nothing to poll.
   Do other work, or end the turn — the notification will arrive.

2. Wait for a CONDITION: one Bash call, run_in_background: true, whose loop
   exits the moment the condition holds. A sleep inside the loop is correct and
   expected — it is the bare sleep that is wrong:

     until curl -sf http://localhost:3000/health >/dev/null 2>&1; do sleep 5; done

   That returns instantly like any backgrounded call, but the shell keeps
   running and notifies you once, when the condition is actually true.

3. Block on a task you already started: TaskOutput with block: true and a
   timeout in milliseconds (max 600000). This genuinely waits.

4. Repeated events rather than one outcome (each CI step, each error line):
   Monitor, with a filter that matches the failure signals too — a filter that
   only matches success is silent through a crash.

5. Self-pacing a /loop: ScheduleWakeup with delaySeconds. That is the only
   supported way to make the next turn happen later.

Re-issue with the form that fits. Do not retry this command.
TEXT
)"

if [[ "$background" == true ]]; then
	deny "Blocked: a backgrounded bare \`sleep\`.

A backgrounded command returns to you IMMEDIATELY, so this sleep waits zero seconds. You wake at once, find the work still running, and queue another sleep a few seconds later — the interval never elapses, a shell leaks on every repeat, and each repeat costs a turn and context.

$remedy"
fi

if (( total_seconds > MAX_FOREGROUND_SECONDS )); then
	deny "Blocked: a bare \`sleep\` of ${total_seconds}s in the foreground.

This holds the session idle for ${total_seconds}s, learns nothing while it waits, and is likely to hit the Bash timeout before whatever you are waiting on finishes. Sleeping is not a wait — nothing checks the thing you care about.

$remedy"
fi

exit 0
