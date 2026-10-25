---
description: Required reading when moving a workspace rendered before template v0.39.0 off its tasks/ issues board and onto the issues server.
name: tasks-migration
---

<!-- cspell:words nyxsis -->

# Moving off the tasks board

## Overview

A workspace rendered before `v0.39.0` kept its issues as Markdown files under
`tasks/`, sorted into epic folders with `done/` and `blocked/` folders beside
them. From `v0.39.0` on, its issues are the issues server's (`nyxsis-issues`),
one file each under `.nyxsis/issues/`, filed and changed through the server's
tools as the `repo-tasks` skill states. This skill is the move from the one to
the other, taken once per workspace.

## Steps

Take the steps in this order, each on a checkout whose every change is
committed.

1. Move the workspace's template pin to `v0.39.0` or later and run the template
   update, as the `template-migration` skill states. The merge drops the
   `issues_format` answer from `.copier-answers.yml` and the `[issues]` table
   from the project declaration.
2. File every issue still open under `tasks/`, any file outside a `done/`
   folder other than a `README.md`, through the issues server's `file` tool,
   carrying its title and its body. File one under a `blocked/` folder the same
   way and block it with the `block` tool, carrying the reason it states.
3. Delete `tasks/` whole, since git history keeps every issue it held. The
   commit that deletes it names the path of each issue the previous step filed,
   and carries the issue files the server wrote.
4. Remove `^tasks/.*\.md$` from the markdownlint and cspell hooks' `files`
   patterns in `.pre-commit-config.yaml`, and from any gate that names the
   folder.
5. Remove the `tasks/` rows from the layout tables of `README.md` and
   `CLAUDE.md`, and point their issue-filing lines at the `repo-tasks` skill.
6. Run the gates, then commit.
7. Read the project's Issues page and check that it opens on Map, with no Board
   mode.
