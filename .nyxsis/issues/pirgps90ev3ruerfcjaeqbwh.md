---
format: nyxsis-issue
version: 3
id: pirgps90ev3ruerfcjaeqbwh
zone: NYX
number: 37
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: open
created: 2026-10-27T19:49:31.754573867Z
modified: 2026-10-27T19:49:31.754573867Z
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
