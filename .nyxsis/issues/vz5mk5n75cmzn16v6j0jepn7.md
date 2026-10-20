---
format: nyxsis-issue
version: 3
id: vz5mk5n75cmzn16v6j0jepn7
zone: DEPLOY
number: 4
title: Provision the prod artifacts and repos identities before promotion
type: generic
state: open
created: 2026-10-20T06:15:32.274807007Z
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
