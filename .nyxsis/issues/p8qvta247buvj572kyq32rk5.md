---
format: nyxsis-issue
version: 3
id: p8qvta247buvj572kyq32rk5
zone: REPOS
number: 24
title: Stop the kit scaffolding src/lib.rs into binary-only crates on update
type: generic
priority: 3
state: done
created: 2026-10-22T18:46:54.323579014Z
done: 2026-10-23T07:17:42.347852165Z
outcome: |
  `copier.yml` now leaves `crates/*/src/lib.rs` and `crates/*/src/main.rs` out of
  the render whenever `_copier_operation` is `update`. Copier sets that for the
  whole update, including the renders of the recorded commit and the current one
  that it merges between. So the scaffold is written only into a repository being
  created, and an update writes no crate source. `_skip_if_exists` still guards a
  first render over an existing tree. The `render.py` docstring and the "The kit"
  section of `development/repositories.md` now say this.

  `scripts/repos/test_render.py::test_an_update_writes_no_crate_source` renders
  `tool-music`, gives its crate only a binary, changes the kit's crate scaffold
  and README, and updates. It asserts that no `lib.rs` appears and that only
  `.copier-answers.yml` and `README.md` change. Without the fix the test fails.

  Verified: `render.py --update tool-music` on the clean submodule changed only
  `.copier-answers.yml` and wrote no `lib.rs` (that change was reverted
  afterwards). `ci-tests` (370 passed) and `shell-tests` pass, as do the other
  pre-commit hooks except cspell.

  Left: the cspell gate can't run in a Nyxsis worktree, because the worktree's
  path is under `.git/` and cspell's `**/.git/**` ignore excludes every file. The
  commit skipped that one hook, and the changed doc page was spell-checked from a
  copy outside `.git/` and came back clean.
---

The repository kit renders a Rust repository from `templates/repository/` and
`render.py --update` carries the repository's own files over a new render:
`apps/docs/src/content/docs/development/repositories.md`, section "The kit".
A crate's layout is the crate's own.

## What is wrong

Every `render.py --update` of `tool-music`, `tool-sfx-sample` and
`tool-sfx-synth` writes a `crates/<crate>/src/lib.rs` into a crate that has
only a binary, because the template scaffolds the file under
`_skip_if_exists` and the crate never had one. Each update then needs the
file deleted by hand before the commit.

## What to do

Render the scaffold only into a repository being created, so an update of
an existing repository writes no crate source.

## Verify

`render.py --update` on a clean checkout of `tool-music` leaves the working
tree unchanged apart from the files the update is for, and `ci-tests` and
`shell-tests` pass in the superrepo.
