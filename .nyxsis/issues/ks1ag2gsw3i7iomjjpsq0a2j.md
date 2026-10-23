---
format: nyxsis-issue
version: 3
id: ks1ag2gsw3i7iomjjpsq0a2j
zone: NYX
number: 2
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: done
created: 2026-10-22T14:00:43.214064645Z
done: 2026-10-23T03:55:05.7684973Z
outcome: |
  Nightly run 18554 (3ddbc5d97) succeeded in every job: Rust 19.2 min, the seed
  job 12.8 min, Web 20.7 min, submodule pins, changed paths and the GitHub mirror.
  Three causes were removed: the project setting "Protect access to repositories
  in YAML pipelines" is off, matching the vantaloc project, so the job token reads
  every repository and the 20-repository token cap no longer applies; CICD-1
  rebuilt and pinned the CI images and dropped the token-scoping lists; CICD-2
  keyed the cargo-target caches on the committed Cargo.lock and kept the Rust job
  from restoring the seed job's oversized archive, so the agent no longer runs out
  of disk.
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
