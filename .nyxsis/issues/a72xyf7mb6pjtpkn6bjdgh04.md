---
format: nyxsis-issue
version: 3
id: a72xyf7mb6pjtpkn6bjdgh04
zone: NYX
number: 3
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: open
created: 2026-10-23T05:23:51.943652024Z
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

No ci issue filed for `staging` has been closed yet.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
