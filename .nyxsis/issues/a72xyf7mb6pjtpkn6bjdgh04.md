---
format: nyxsis-issue
version: 3
id: a72xyf7mb6pjtpkn6bjdgh04
zone: NYX
number: 3
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: done
created: 2026-10-23T05:23:51.943652024Z
done: 2026-10-23T06:24:29.519499859Z
outcome: |
  ## Cause

  Run 18561 failed at `Deploy`. Its settle step found
  `tcab-keyvault-sync-test-suites` stuck in ContainerCreating: the staging vault
  held no `test-suites-read-token`. Someone uploaded a token afterwards. With it,
  the ingest sidecar's fetch of the suites, which was rewritten to go to Azure
  Repos, failed with `Authentication failed`. The `test-suites` checkout stayed
  empty, so every `POST /ingest` answered 500 (`host I/O: No such file or
  directory`) and the backend stayed 503 on `/readyz`. Both failures came from the
  sidecar fetching the suites through a credential it does not need:
  `TheClockwyrks/test-suites`, the GitHub mirror `.gitmodules` resolves to, is
  public.

  ## Done (5a53793e4)

  - Both `patch-backend-ingest.yaml` overlays fetch the suites anonymously from
    the public mirror, as they already did the superproject and cold-storage.
    Removed: the Azure Repos `insteadOf` rewrite, the credential helper, and the
    token volume and mount.
  - Removed `components/keyvault-csi/test-suites-credential.yaml` (its
    SecretProviderClass and mounter), its staging vault patch and
    `deployments/k8s/secrets/upload-test-suites-credential.sh`. Updated the
    comments that pointed at them.
  - `scripts/ci/retire-legacy-backend.sh` now deletes
    `deployment/tcab-keyvault-sync-test-suites`,
    `secretproviderclass/tcab-keyvault-test-suites` and
    `secret/tcab-test-suites-credential` before each apply. An apply never prunes
    them, and the settle step waits on every Deployment in the namespace.
  - Tests: the sidecar test now checks that no rewrite and no credential helper
    are installed. The retirement and pre-deploy tests cover the new deletions.
  - Docs: the deployment overview's Secrets list, control-plane ingest and
    retirement sections.
  - Verified from inside the staging backend pod: an anonymous clone of the mirror
    returns the pinned commit `13963e05`.

  Gates: `shell-tests`, `k8s-manifests`, `k8s-deploy-sets`, `markdownlint`,
  `format`, `docs-build`, `docs-typecheck`, `ci-tests`, `python-lint` and
  `no-nul-bytes` pass. `cspell` cannot run in this worktree: it ignores
  `**/.git/**`, and the worktree lives under `.git/nyxsis/`, so it checks no files
  and prints its usage. The changed Markdown passed cspell when copied outside
  that path. The commit skipped only that hook.

  ## Left

  - The fix reaches staging by promotion. Not yet verified there: a deploy of it.
  - An ingest whose checkout lacks the suites answers 500 instead of ingesting
    without them, as `control-plane.md` describes. This is a backend behaviour,
    outside this repair.
  - The vault secret `test-suites-read-token` is now unused in both vaults and can
    be deleted by an operator.
  - Prod's overlay is changed the same way. Prod's copies of the retired objects
    are deleted on its next deploy.
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
