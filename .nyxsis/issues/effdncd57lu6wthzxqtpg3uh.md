---
format: nyxsis-issue
version: 3
id: effdncd57lu6wthzxqtpg3uh
zone: REPOS
number: 25
title: Delete feat/the-spec-cabinet once REPOS-2's docs reach nightly
type: generic
priority: 5
state: open
depends_on:
  - lk0nqbngol05n14gw1yeo972
created: 2026-10-24T04:52:44.919738593Z
---

The Spec Cabinet's code now lives in the `the-spec-cabinet` repository
(`the-spec-cabinet/history/README.md` records the extraction, with the moved
paths' tree hashes matching the branch's at `568904f9d`). Its documentation
pages (`apps/docs/src/content/docs/the-spec-cabinet/`, the launch quickstart
and the edits around them) landed on REPOS-2's branch in `c018cd1da`. See
`apps/docs/src/content/docs/development/repositories.md`, "The repositories".

## What is missing

- `origin/feat/the-spec-cabinet` (tip `568904f9d`) still exists on the
  superrepo's remote. REPOS-2 left it in place, because its documentation was
  held only by an unmerged branch.

## Verify

`git branch -r --contains c018cd1da` names `origin/nightly`, and then
`git push origin --delete feat/the-spec-cabinet` leaves
`git ls-remote origin feat/the-spec-cabinet` empty.
