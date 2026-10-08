#!/usr/bin/env bash
# PreToolUse(Bash) hook: block `cargo test` and steer to `cargo nextest`.
#
# The coding skill (.claude/skills/coding/SKILL.md) requires the Rust suite to
# be run with `cargo nextest run --workspace`, never `cargo test`. This hook
# denies any Bash command that invokes `cargo test` so the agent is forced to
# use nextest.
#
# The one sanctioned exception is doctests: nextest does not run them, so
# `cargo test --workspace --doc` (any `cargo test ... --doc`) is allowed
# through. `cargo nextest ...` is never matched (the `test` in "nextest" is not
# a word boundary).

input="$(cat)"

# Extract the command string from the tool input JSON.
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

deny() {
	# Emit a PreToolUse deny decision with guidance for the agent.
	jq -n --arg reason "$1" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: $reason
		}
	}'
	exit 0
}

# Match `cargo test` as a subcommand, allowing an optional `+toolchain` token
# (e.g. `cargo +nightly test`). The `test` in `cargo nextest` is NOT matched
# because it is not preceded by a word boundary.
if [[ "$command" =~ (^|[^[:alnum:]_])cargo[[:space:]]+(\+[^[:space:]]+[[:space:]]+)?test([[:space:]]|$) ]]; then
	# Allow the doctest exception: nextest cannot run doctests.
	if [[ "$command" =~ (^|[[:space:]])--doc([[:space:]]|=|$) ]]; then
		exit 0
	fi
	deny "This repo requires \`cargo nextest\`, not \`cargo test\` (see .claude/skills/coding/SKILL.md). Run the suite with: cargo nextest run --workspace. The only exception is doctests, which nextest cannot run — for those use: cargo test --workspace --doc."
fi

exit 0
