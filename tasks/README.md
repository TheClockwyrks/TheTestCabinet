# Tasks

This folder is the repository's issues board. Each issue is one Markdown file,
filed under the one area folder it is work on, so an issue against a test case
sits at `test-cases/<issue>.md` and a miscellaneous one at `backlog/<issue>.md`.
A completed issue moves into a `done/` folder inside the area folder it already
sits in, and an issue that needs user input before it can proceed moves into a
`blocked/` folder in the same place. A finished issue under `done/` is
immutable: work it describes that needs reopening is filed as a new issue.

The policies that govern this folder are in the
[`repo-tasks`](../.claude/skills/repo-tasks/SKILL.md) skill. Read it before
adding or editing an issue.
