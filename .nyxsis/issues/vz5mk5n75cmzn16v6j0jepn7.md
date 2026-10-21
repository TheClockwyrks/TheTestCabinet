---
format: nyxsis-issue
version: 3
id: vz5mk5n75cmzn16v6j0jepn7
zone: DEPLOY
number: 4
title: Provision the prod artifacts and repos identities before promotion
type: generic
state: done
created: 2026-10-20T06:15:32.274807007Z
done: 2026-10-21T16:54:57.752338605Z
outcome: |
  Provisioned in testcabinet-prod-westus2-rg: the storage account `tcabprodstore`
  with private containers `run-trees` and `bundles` (shared key off, anonymous
  access off, TLS 1.2, blob and container soft delete and versioning at 14 days,
  the `expire-noncurrent-versions` lifecycle rule, all as staging has), the
  identities `tcab-artifacts-prod` (b566beed-c4c1-4306-b2dc-c3fa32af1b80) and
  `tcab-repos-prod` (48ec3a3e-69b8-466a-8c0c-20f5fd71a393), each holding Storage
  Blob Data Contributor on its container and federated to
  `system:serviceaccount:tcab-prod:tcab-<service>` through the prod cluster's OIDC
  issuer. The two prod patches carry those client ids. Prod's render names no
  `unprovisioned` identity, and `k8s-deploy-sets`, `k8s-manifests` and the shell
  tests pass.

  The GitHub pair needed nothing new in the vault: the overlay sets
  `TCAB_GITHUB_ORG` as a literal, and `TCAB_GITHUB_TOKEN` comes from the existing
  `github-pat` secret of `testcabinet-clockwyrks`, which prod already syncs (it
  backs `tcab-publisher-secrets`).

  `scripts/ci/copy-artifact-trees.sh <staging|prod>` copies the trees on
  `artifacts-tcab-artifacts-0` into `run-trees` in the store's
  `<id>/g/<generation>/…` + `<id>/current` layout. It runs in a pod on the claim's
  node, as the artifacts identity, and skips a run that is already in the
  container. All 110 prod trees are copied, unpublished ones included; a second
  pass copied 0 and skipped 110. The remediation messages of the deploy scripts
  and the deployment overview now name the script.

  Left: run `scripts/ci/copy-artifact-trees.sh prod` once more just before
  `nightly` reaches `master`, to pick up the trees finished since the copy. Then,
  after the first prod deploy, run `kubectl rollout restart
  deploy/tcab-keyvault-sync -n tcab-prod` so `tcab-repos-secrets` is created
  (patch-repos-github.yaml). The prod stage's deploy with `tcab-artifacts` and
  `tcab-repos` ready has not happened yet; it comes with the promotion.

  Also fixed a race that made `submodules.test.sh` fail intermittently: under
  pipefail, `grep -q` could fail the lookup by killing the `printf` writing to it
  with SIGPIPE.
---

The prod overlay binds the artifacts and repos services to workload
identities, and a deploy whose render still names an identity as
`unprovisioned` is refused:
`apps/docs/src/content/docs/deployment/kubernetes/overview.md`, section
"Promoting to prod", and
`apps/docs/src/content/docs/components/artifacts/overview.md`.

## What is wrong

`deployments/k8s/overlays/prod/patch-artifacts-identity.yaml` and
`patch-repos-identity.yaml` carry `unprovisioned` client ids, so the prod
stage fails as soon as `nightly` reaches `master`, and prod keeps the
StatefulSet trees the artifacts service replaced.

## What to do

Create the prod storage account and containers, the two user-assigned
identities with their role assignments and federated credentials, the
`TCAB_GITHUB_ORG` and `TCAB_GITHUB_TOKEN` secrets in `testcabinet-clockwyrks`,
write the client ids into the two patches, and copy the existing claim's
trees, unpublished runs included, into Blob before the first prod deploy.

## Verify

`scripts/ci/deploy-environment.sh --render` for prod names no
`unprovisioned` identity, `k8s-deploy-sets` and `k8s-manifests` pass, and
the prod stage deploys with `tcab-artifacts` and `tcab-repos` ready.
