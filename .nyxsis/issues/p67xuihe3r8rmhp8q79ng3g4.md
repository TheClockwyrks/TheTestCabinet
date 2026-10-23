---
format: nyxsis-issue
version: 3
id: p67xuihe3r8rmhp8q79ng3g4
zone: NYX
number: 4
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: open
created: 2026-10-23T06:30:03.512206342Z
---

The latest run of `the-test-cabinet` on the promotion branch `staging` failed at
the branch's head.

- Run: 20261023.10 (18561),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=18561>
- Branch: `staging`
- Commit: `2343daf3c4f6cca16431485a27b276aeb2508592`

## Failed stages

- `Deploy` (stage)

## Earlier repairs

The ci issues last closed for `staging`, most recently closed first: NYX-3. Read
how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
