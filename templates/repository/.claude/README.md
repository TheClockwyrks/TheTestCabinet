# Harness settings

`settings.json` is Claude Code's project settings. It leaves commit and pull
request attribution empty, runs sessions without permission prompts and
registers the gate hooks below. `skills/` holds the `coding` skill, the policy
an agent reads before it writes code here; the documentation, the issue board
and their skills are the superrepo's.

## Gate hooks

`settings.json` registers three `PreToolUse` gates, each a script under
`hooks/` with a table test beside it (`*.test.sh`, run directly and by the
`shell-tests` gate). They hold an agent to this repository's policies at the
moment it acts rather than at review.

| Hook | Refuses |
| --- | --- |
| `block-bare-sleep.sh` | A backgrounded or long bare `sleep` used as a wait, and names the waits that actually wait |
| `block-cargo-test.sh` | `cargo test`, other than for doctests, because the suite runs under `cargo nextest` |
| `block-self-matching-pgrep.sh` | A `pgrep -f`, `pkill -f` or looped `ps \| grep` whose pattern matches its own command line, which finds the waiting shell and never exits |
