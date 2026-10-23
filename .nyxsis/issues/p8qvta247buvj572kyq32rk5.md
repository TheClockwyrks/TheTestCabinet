---
format: nyxsis-issue
version: 3
id: p8qvta247buvj572kyq32rk5
zone: REPOS
number: 24
title: Stop the kit scaffolding src/lib.rs into binary-only crates on update
type: generic
priority: 3
state: open
created: 2026-10-22T18:46:54.323579014Z
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
