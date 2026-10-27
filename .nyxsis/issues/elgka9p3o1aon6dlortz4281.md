---
format: nyxsis-issue
version: 3
id: elgka9p3o1aon6dlortz4281
zone: NYX
number: 39
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: open
created: 2026-10-27T21:00:42.255510036Z
modified: 2026-10-27T21:00:42.255510036Z
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
