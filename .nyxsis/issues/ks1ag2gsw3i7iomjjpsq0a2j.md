---
format: nyxsis-issue
version: 3
id: ks1ag2gsw3i7iomjjpsq0a2j
zone: NYX
number: 2
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: open
created: 2026-10-22T14:00:43.214064645Z
---

The latest run of `the-test-cabinet` on the promotion branch `nightly` failed at
the branch's head.

- Run: 20261022.11 (18213),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=18213>
- Branch: `nightly`
- Commit: `e93de898e723dd116242a92955b1def049ed454a`

## Failed stages

- `Gates` (stage)

## Earlier repairs

No ci issue filed for `nightly` has been closed yet.

Repair the failure on the main checkout's branch; the fix reaches `nightly` by
promotion.
