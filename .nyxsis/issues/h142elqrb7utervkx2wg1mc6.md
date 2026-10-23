---
format: nyxsis-issue
version: 3
id: h142elqrb7utervkx2wg1mc6
zone: NYX
number: 7
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: blocked
reason: Promote nightly (which carries NYX-3's fix 5a53793e4, 16 commits ahead) into staging; run 18599 at 2343daf3c is the same failure NYX-4/5/6 diagnosed and no code change remains.
created: 2026-10-23T07:22:20.420664051Z
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

The ci issues last closed for `staging`, most recently closed first: NYX-6,
NYX-5, NYX-4, NYX-3. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
