---
format: nyxsis-issue
version: 3
id: v7g831wei81xfao35yrhlk4q
zone: NYX
number: 6
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: open
created: 2026-10-23T07:00:26.414334642Z
---

The latest run of `the-test-cabinet` on the promotion branch `staging` failed at
the branch's head.

- Run: 20261023.12 (18599),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=18599>
- Branch: `staging`
- Commit: `2343daf3c4f6cca16431485a27b276aeb2508592`

## Failed stages

- `Deploy` (stage)

## Earlier repairs

The ci issues last closed for `staging`, most recently closed first: NYX-5,
NYX-4, NYX-3. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
