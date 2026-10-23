---
format: nyxsis-issue
version: 3
id: p67xuihe3r8rmhp8q79ng3g4
zone: NYX
number: 4
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: done
created: 2026-10-23T06:30:03.512206342Z
done: 2026-10-23T06:39:57.058942511Z
outcome: |
  ## Cause

  This is the failure NYX-3 already repaired. It still shows on `staging` because
  that fix hasn't been promoted there yet. Run 18561 (20261023.10) is the run
  NYX-3 diagnosed. The later manual re-run 18599 (20261023.12, 05:56) deployed the
  same commit `2343daf3c`. It failed at `Apply the overlay and wait for the
  rollout`: the ingest sidecar logged `fatal: Authentication failed for
  'https://dev.azure.com/genyume/the-test-cabinet/_git/test-suites/'`, then `test
  suites update failed; ingesting without them`, and the backend stayed 503 on
  `/readyz`. The cause is the Azure Repos `insteadOf` rewrite that staging's
  `patch-backend-ingest.yaml` still has (line 92 at `origin/staging`).

  ## Done

  - Confirmed that 5a53793e4 (NYX-3's fix) is on `nightly` and not in
    `origin/staging`. The overlay at this head has no rewrite and no credential,
    so the sidecar fetches the public `TheClockwyrks/test-suites` mirror without a
    token. NYX-3 verified that anonymous clone from the staging pod.
  - No new code change was needed. Gates `k8s-manifests`, `k8s-deploy-sets` and
    `shell-tests` pass at this head.

  ## Left

  - Promote `nightly` into `staging`. Its deploy is the first real check of the
    fix on the cluster.
  - From NYX-3, still open: an ingest without the suites answers 500 instead of
    ingesting without them (backend behaviour). The vault secret
    `test-suites-read-token` is unused and an operator can delete it.
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
