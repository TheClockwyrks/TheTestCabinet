---
format: nyxsis-issue
version: 3
id: o7hwklyhcecnv0j6u9k4aavr
zone: NYX
number: 8
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: open
created: 2026-10-26T08:32:11.802822694Z
---

The latest run of `the-test-cabinet` on the promotion branch `nightly` failed at
the branch's head.

- Run: 20261026.2 (19288),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=19288>
- Branch: `nightly`
- Commit: `6c195c0f290db7a98daa4bc811ae915cfcfd889c`

## Failed stages

- `Gates` (stage)

## Earlier repairs

The ci issues last closed for `nightly`, most recently closed first: NYX-2. Read
how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `nightly` by
promotion.
