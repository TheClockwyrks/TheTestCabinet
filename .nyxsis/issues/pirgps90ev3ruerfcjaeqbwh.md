---
format: nyxsis-issue
version: 3
id: pirgps90ev3ruerfcjaeqbwh
zone: NYX
number: 37
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: done
created: 2026-10-27T19:49:31.754573867Z
modified: 2026-10-27T20:39:45.468874551Z
done: 2026-10-27T20:39:45.468874551Z
outcome: |
  Run 20263 failed the same way NYX-8 did, for the same cause:

  - **`cargo nextest`:** the 11 `bus::tests` of the backend panicked under
    `TCAB_REQUIRE_POSTGRES=1`. `ci/images/tags.yml` still pinned `32214df70`,
    whose rust image predates 52dbbc862's PostgreSQL install.
  - **`dependency-graph` and the `ci-tests` test that repeats it:** they failed
    because microservice-arena, -artifacts, -dispatcher and -repos already ran
    newer images than the superrepo's pin.

  The repair that NYX-8 waited on the operator for had since been made. Every
  repository took the images built at `2610dc98c` through PRs 5380-5407, all
  completed. Only the superrepo's PR 5408 (`fix/nightly-ci-images-and-issue-lint`)
  was left active, with no auto-complete. This branch carries its two commits as
  one commit, because the pin alone cannot pass `dependency-graph`. That commit
  moves `ciImageTag` to `2610dc98c` and every gitlink to the commit its repository
  takes those images at. NYX-9's line wrapping, the PR's other change, is already
  on nightly as f209634be, so it was dropped.

  Verified:

  - The image pipeline's run on `2610dc98c` succeeded, and that commit contains
    52dbbc862.
  - With PostgreSQL 18, the bus tests pass 11 of 11.
  - 22 of the 23 superrepo gates pass, including `ci-tests` (436),
    `dependency-graph`, `ci-image-pins` and `rust-test` (1528).
  - `submodule-remotes` passes for a push to nightly: each of the 28 pins is on
    its remote's nightly or master.

  Left:

  - `workspace-test` fails in the engines web packages, but only from a worktree
    under `.git`. The same suites pass in the main checkout and in CI, and fail
    the same way at the old engines pin. CICD-5 is filed for it.
  - PR 5408 is superseded by this landing and can be abandoned.
  - NYX-8, still blocked on the operator, is resolved by the same pin move and
    can be closed.
---

The latest run of `the-test-cabinet` on the promotion branch `nightly` failed at
the branch's head.

- Run: 20261027.4 (20263),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=20263>
- Branch: `nightly`
- Commit: `a8d4c5a7d00b0944f2fe2dd9dda8242946fb542c`

## Failed stages

- `Gates` (stage)

## Earlier repairs

The ci issues last closed for `nightly`, most recently closed first: NYX-8,
NYX-2. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `nightly` by
promotion.
