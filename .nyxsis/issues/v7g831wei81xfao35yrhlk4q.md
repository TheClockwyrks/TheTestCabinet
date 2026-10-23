---
format: nyxsis-issue
version: 3
id: v7g831wei81xfao35yrhlk4q
zone: NYX
number: 6
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: done
created: 2026-10-23T07:00:26.414334642Z
done: 2026-10-23T07:17:22.516906861Z
outcome: |
  ## Cause

  This is run 18599 (20261023.12) again, the run NYX-4 and NYX-5 already
  diagnosed. It deployed commit `2343daf3c`, and `origin/staging` hasn't moved
  since. I reproduced the failure from the run's log (log 175, `Apply the overlay
  and wait for the rollout`). The ingest sidecar's suites clone was rewritten to
  Azure Repos and failed with `fatal: Authentication failed for
  'https://dev.azure.com/genyume/the-test-cabinet/_git/test-suites/'`. The backend
  stayed 503 on `/readyz`, and `the-test-cabinet-backend` exceeded its progress
  deadline. Staging's `patch-backend-ingest.yaml` still has the `insteadOf`
  rewrite at line 92 on `origin/staging`.

  ## Done

  - Confirmed that NYX-3's fix, 5a53793e4, is in `nightly` (the main checkout's
    branch) and in this head. It is not in `origin/staging`, which is 11 commits
    behind. No overlay under `deployments/k8s` has an `insteadOf` rewrite or the
    test-suites credential any more.
  - No new code change was needed. Gates `k8s-manifests`, `k8s-deploy-sets` and
    `shell-tests` pass at this head.

  ## Left

  - Promote `nightly` into `staging`. Until that happens, another issue filed
    against run 18599 will be a duplicate of this one. DEPLOY-5 waits on that
    promotion.
  - Still open from NYX-3, and not filed: an ingest without the suites answers 500
    instead of ingesting without them (backend behaviour). The vault secret
    `test-suites-read-token` is unused and an operator can delete it.
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
