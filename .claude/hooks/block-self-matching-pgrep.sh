#!/usr/bin/env bash
# PreToolUse(Bash) hook: block a process-table wait whose pattern matches the
# waiting command itself.
#
# The failure this exists to stop:
#
#   until ! pgrep -f "cargo nextest" >/dev/null; do sleep 15; done
#
# `pgrep -f` matches against each process's full command line. The shell running
# that loop has the string `cargo nextest` in its own command line, so pgrep
# finds the waiter. The condition is true forever, the loop never exits, and the
# agent that backgrounded it waits on a command that cannot finish. It is a
# guaranteed deadlock, not a race — and because the shell keeps running, nothing
# reports an error.
#
# The test is exact rather than heuristic: extract the pattern pgrep would use,
# then ask whether that pattern matches the command text being run. If it does,
# the command matches itself, which is precisely the bug.
#
# What is blocked:
#   - `pgrep -f PAT` / `pkill -f PAT` where PAT matches this command's own text
#   - `ps ... | grep PAT` inside a loop, where PAT matches its own text
#
# What is NOT blocked, because it is correct:
#   - the bracket trick, `pgrep -f "[c]argo nextest"`, which cannot self-match
#   - `pgrep -x cargo-nextest`, which matches process NAMES, not command lines,
#     so a bash loop is never its own match
#   - any pgrep whose pattern simply does not occur in the command

set -uo pipefail

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

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
# Detection
#
# Emits `<tool>\t<pattern>` for the first self-matching wait it finds, or
# nothing. Parsing is done with shlex so that quoting is handled the way the
# shell handles it; anything unparseable is allowed through.
# ---------------------------------------------------------------------------

# shellcheck disable=SC2016
finding="$(printf '%s' "$command" | python3 -c '
import re
import shlex
import sys

cmd = sys.stdin.read()

try:
	tokens = shlex.split(cmd, posix=True)
except ValueError:
	# Unbalanced quotes and the like. Not our business; let it run.
	sys.exit(0)

# pgrep/pkill options that consume the following token, so that the value is
# never mistaken for the pattern.
VALUE_OPTS = {
	"-u", "-U", "-g", "-G", "-P", "-s", "-t", "-n", "-o",
	"--signal", "--parent", "--session", "--terminal", "--euid", "--uid",
}

LOOP_KEYWORDS = {"while", "until", "for"}
in_loop = any(t in LOOP_KEYWORDS for t in tokens)


def pattern_matches_self(pattern):
	"""True when the pattern would match the command line running it."""
	try:
		return re.search(pattern, cmd) is not None
	except re.error:
		# pgrep would reject it too; not a self-match we can prove.
		return False


def scan_procmatcher(start, want_full_flag):
	"""Return the pattern argument of the invocation beginning at `start`."""
	full = False
	index = start + 1
	while index < len(tokens):
		token = tokens[index]
		if token == "--":
			index += 1
			continue
		if token in VALUE_OPTS:
			index += 2
			continue
		if token.startswith("--"):
			index += 1
			continue
		if token.startswith("-") and len(token) > 1:
			# A short flag cluster such as -af. `f` anywhere in it means the
			# match runs against the full command line.
			if re.fullmatch(r"-[a-zA-Z]+", token) and "f" in token[1:]:
				full = True
			index += 1
			continue
		# The first bare token is the pattern.
		if want_full_flag and not full:
			return None
		# shlex splits on quotes but not on shell operators, so a pattern that
		# ends a command arrives with the separator glued on ("cargo nextest;").
		# Strip those, or the self-match test compares the wrong string.
		return re.sub(r"[;&|)]+$", "", token).strip()
	return None


for i, token in enumerate(tokens):
	base = token.rsplit("/", 1)[-1]

	if base in ("pgrep", "pkill"):
		pattern = scan_procmatcher(i, want_full_flag=True)
		if pattern and pattern_matches_self(pattern):
			print("{}\t{}".format(base, pattern))
			sys.exit(0)

	# `ps aux | grep foo` self-matches the same way. Only a loop turns that
	# into a hang rather than one wrong line of output, so only flag loops.
	if base == "grep" and in_loop and "ps" in tokens:
		pattern = scan_procmatcher(i, want_full_flag=False)
		if pattern and pattern_matches_self(pattern):
			print("{}\t{}".format("ps-grep", pattern))
			sys.exit(0)
' 2>/dev/null)"

[[ -z "$finding" ]] && exit 0

tool="${finding%%$'\t'*}"
pattern="${finding#*$'\t'}"

# ---------------------------------------------------------------------------
# Guidance
# ---------------------------------------------------------------------------

remedy="$(cat <<'TEXT'
Wait on the thing itself, not on a description of it:

1. Do not wait at all. Work started with Bash run_in_background re-invokes you
   when it exits and hands you its output file. There is nothing to poll.

2. Block on the task you started: TaskOutput with block: true and a timeout in
   milliseconds (max 600000). This genuinely waits, and it waits on YOUR task
   rather than on whatever else happens to be running.

3. Wait on a pid you own, which cannot match itself:

     mycmd & pid=$!
     while kill -0 "$pid" 2>/dev/null; do sleep 5; done

4. Wait on the artifact instead of the process, which is what you actually care
   about:

     until [ -s build.log ] && grep -q 'Summary' build.log; do sleep 5; done

If you truly must match a process table, make the pattern unable to match
itself with the bracket trick — `pgrep -f "[c]argo nextest"` matches
`cargo nextest` but not the literal text `[c]argo nextest` in your own command
line.

Beware a second trap even once the pattern cannot self-match: several agents
share this machine, so waiting for "any cargo/nextest anywhere" waits for every
other track's build too, and with several running it effectively never clears.
Wait on your own pid or your own task.

Re-issue with the form that fits. Do not retry this command.
TEXT
)"

if [[ "$tool" == "ps-grep" ]]; then
	deny "Blocked: a loop waiting on \`ps ... | grep\` whose pattern matches its own command line.

The pattern \`${pattern}\` occurs in the command you just tried to run, so the grep finds this very shell and the loop condition never changes. The loop cannot exit, and because the shell keeps running, nothing ever reports an error — the agent waiting on it is deadlocked.

$remedy"
fi

deny "Blocked: \`${tool} -f\` whose pattern matches its own command line.

\`${tool} -f\` matches against each process's FULL command line, and the pattern \`${pattern}\` occurs in the command you just tried to run. So it matches the shell running it. The condition is true forever, the loop never exits, and any agent waiting on it is deadlocked on a command that cannot finish. Nothing reports an error, because the shell is still happily running.

$remedy"
