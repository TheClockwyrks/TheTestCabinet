---
format: nyxsis-issue
version: 3
id: hvd0bgb29td3kqgkv1xv2u8m
zone: NYX
number: 5
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: done
created: 2026-10-23T06:45:55.987966945Z
done: 2026-10-23T06:56:57.742982307Z
outcome: |
  ## Cause

  Run 18599 (20261023.12) is the same run NYX-4 diagnosed, and it deployed the
  same commit, `2343daf3c`. `origin/staging` hasn't moved since. I reproduced the
  failure from the run's log (log 175, `Apply the overlay and wait for the
  rollout`). The ingest sidecar's suites clone was rewritten to Azure Repos and
  failed with `fatal: Authentication failed for
  'https://dev.azure.com/genyume/the-test-cabinet/_git/test-suites/'`. It then
  logged `test suites update failed; ingesting without them`. The backend stayed
  503 on `/readyz`, and `the-test-cabinet-backend` exceeded its progress deadline.
  Staging's `patch-backend-ingest.yaml` still has the `insteadOf` rewrite at
  line 92.

  ## Done

  - Confirmed that NYX-3's fix, 5a53793e4, is on `nightly` (the main checkout's
    branch) and at this head. It is not on `origin/staging` or `origin/master`. No
    overlay under `deployments/k8s` has an `insteadOf` rewrite, the test-suites
    credential or the test-suites SecretProviderClass any more.
  - No new code change was needed. Gates `k8s-manifests`, `k8s-deploy-sets` and
    `shell-tests` pass at this head.

  ## Left

  - Promote `nightly` into `staging`. Its deploy is the first real check of the
    fix on the cluster. DEPLOY-5 (promote staging to master) waits on that.
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

The ci issues last closed for `staging`, most recently closed first: NYX-4,
NYX-3. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
