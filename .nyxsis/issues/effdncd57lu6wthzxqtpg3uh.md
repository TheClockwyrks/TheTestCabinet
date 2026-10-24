---
format: nyxsis-issue
version: 3
id: effdncd57lu6wthzxqtpg3uh
zone: REPOS
number: 25
title: Delete feat/the-spec-cabinet once REPOS-2's docs reach nightly
type: generic
priority: 5
state: done
depends_on:
  - lk0nqbngol05n14gw1yeo972
created: 2026-10-24T04:52:44.919738593Z
done: 2026-10-24T04:58:12.633227Z
outcome: |
  Deleted `feat/the-spec-cabinet` (tip `568904f9d`) from the superrepo's remote.
  `git ls-remote origin feat/the-spec-cabinet` now returns nothing.

  The docs commit `c018cd1da` was rebased when it landed, so no remote branch
  contains that hash. It reached `origin/nightly` as `d7fc520f9`, and the two
  commits have byte-identical patches (20 files, +2091 −15). The issue's check was
  run against `d7fc520f9` for that reason. Nightly's
  `apps/docs/src/content/docs/the-spec-cabinet/` differs from the branch tip's
  only by the edits made for the split, such as paths now named in the
  `the-spec-cabinet` repository and environment variables added there. The branch
  holds no page that nightly lacks.

  The GitHub mirror (`TheClockwyrks/TheTestCabinet`) carries only `master`,
  `nightly` and `staging`, so there was nothing to delete there. Nothing was left.
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
