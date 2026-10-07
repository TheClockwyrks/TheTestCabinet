# Harness settings

`settings.json` is Claude Code's project settings. It leaves commit and pull
request attribution empty, runs sessions without permission prompts and
registers the gate hooks below. `skills/` holds the policies an agent reads
before it writes code, documentation or an issue; the `coding`, `documentation`,
`repo-tasks` and `drain-issues-queue` skills carry this project's own policies
alongside the template's, and are edited here like any other file. The skill named
`nyxsis`, at `.claude/skills/nyxsis/SKILL.md`, <!-- cspell:disable-line -->
states what the repository carries for the fleet that manages it: read it
before configuring the repository for that fleet or changing anything the fleet
reads, such as the declarations folder at the root, the answers file, the
devcontainer's compose file, `forwardPorts` or the pipeline's test results.
The skill named `template-migration`, at
`.claude/skills/template-migration/SKILL.md`, holds a migration guide per
version of the template the repository is rendered from, under `versions/`:
read it before updating the repository against its template, by hand or
through a template update tool, and before resolving the conflicts or taking
the steps an update left.

## Gate hooks

`settings.json` registers four `PreToolUse` gates, each a script under
`hooks/` with a table test beside it (`*.test.sh`, run directly). They hold an
agent to this repository's policies at the moment it acts rather than at review.

| Hook | Refuses |
| --- | --- |
| `block-bare-sleep.sh` | A backgrounded or long bare `sleep` used as a wait, and names the waits that actually wait |
| `block-cargo-test.sh` | `cargo test`, other than for doctests, because the suite runs under `cargo nextest` |
| `block-done-task-writes.sh` | A write to a completed issue under `tasks/**/done/`, which is history rather than a live document |
| `block-self-matching-pgrep.sh` | A `pgrep -f`, `pkill -f` or looped `ps \| grep` whose pattern matches its own command line, which finds the waiting shell and never exits |
