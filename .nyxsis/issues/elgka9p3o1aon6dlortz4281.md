---
format: nyxsis-issue
version: 3
id: elgka9p3o1aon6dlortz4281
zone: NYX
number: 39
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: done
created: 2026-10-27T21:00:42.255510036Z
modified: 2026-10-27T21:24:01.117908945Z
done: 2026-10-27T21:24:01.117908945Z
outcome: |
  Cause: run 20300 failed `dependency-graph` and, through
  `test_graph.py::test_this_superrepo_passes`, `ci-tests`. `ci/images/tags.yml`
  pinned `ciImageTag` 6c195c0f2 (NYX-8), but the gitlinks of contracts, engines,
  microservice-arena, -artifacts, -dispatcher, -driver, -publisher, test-suites
  and console.testcabinet.ai had already moved to commits that take the kit and
  the images built at 2610dc98c (PRs 5381-5407). The superrepo half of that move,
  PR 5408 (`fix/nightly-ci-images-and-issue-lint`), conflicts with nightly and
  never landed, so the superrepo and its repositories named different images.
  Reproduced locally: the gate reported the same mismatches.

  Done:

  - f9772277b pins `ciImageTag` to 2610dc98c25a077ffd68953117e2e41861347376. The
    image pipeline's run 19907 on nightly built those images. 2610dc98c descends
    from 6c195c0f2, and `ci/images` is unchanged between them.
  - The same commit moves the gitlinks of every repository still on 6c195c0f2 (gg,
    gg.rocks, microservice-repos, ui-common, testcabinet.ai, client-tauri,
    the-spec-cabinet and the 13 tool-* repositories) to that repository's
    `nightly`. Each `nightly` already merged its 2610dc98c render over the old
    gitlink, and the gap is kit and CI files only. microservice-repos had taken
    its render on `master` only, so its PR 5413 (merged, 815f6e1) merges master
    into its nightly and takes master's two pin files.

  Verified: `dependency-graph`, `ci-tests` (430), `rust-test` (1528), clippy, doc,
  doctest, fmt, shell-tests, cspell, markdownlint, format, docs-build,
  docs-typecheck and the other gates pass. 22 of 23 gates pass.

  Left:

  - `workspace-test` fails locally in the same way NYX-8 recorded: 90 engines
    vitest files cannot resolve `/src/<file>` in a worktree under
    `.git/nyxsis/worktrees/`. This is the local environment. The change touches no
    engines code.
  - PR 5408 is superseded by this branch and can be abandoned. NYX-37, the earlier
    report of this failure, is still open and is answered by this repair.
  - The repair is confirmed once nightly's next run passes after promotion.
---

The latest run of `the-test-cabinet` on the promotion branch `nightly` failed at
the branch's head.

- Run: 20261027.6 (20300),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=20300>
- Branch: `nightly`
- Commit: `d197d28f93002844ce812fae900cf58d540d5df1`

## Failed stages

- `Gates` (stage)

## Earlier repairs

The ci issues last closed for `nightly`, most recently closed first: NYX-37,
NYX-8, NYX-2. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `nightly` by
promotion.
