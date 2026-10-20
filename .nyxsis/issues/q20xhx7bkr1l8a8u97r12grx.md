---
format: nyxsis-issue
version: 3
id: q20xhx7bkr1l8a8u97r12grx
zone: CICD
number: 4
title: Carry staging's feature work into nightly and promote nightly to staging through the pipelines
type: generic
state: open
created: 2026-10-20T22:47:37.760158351Z
---

Every change to the `staging` and `master` environments reaches the cluster
through the superrepo's pipeline on the branch of that name, which gates the
commit, builds the images and applies the overlay:
`apps/docs/src/content/docs/development/building.md`, section "Continuous
integration", `apps/docs/src/content/docs/deployment/kubernetes/overview.md`
and `apps/docs/src/content/docs/deployment/kubernetes/edge.md`.

## What is wrong

The `staging` branch and `nightly` have diverged, and the staging cluster is
a hybrid of the two:

- `staging` holds the feature pull requests 3497, 3782, 3876, 3887, 3988 and
  4523 (sixty-eight commits: the gg run agents on the summary card and the
  run log, the comparison of existing runs, the infrastructure-disruption
  outcome, the 16Gi backend state volume, and more) that `nightly` never
  received. Several touch `packages/ui` and `crates/core`, which `nightly`
  has since moved to `ui-common` and dissolved into the owning repositories.
- `nightly` holds the edge (Cloudflare Tunnel and Access), the artifacts and
  repos services, the run-pod disruption budget and the repository
  extractions, none of which `staging` has.
- The edge was applied to the staging cluster by hand from `nightly`, and the
  staging pipeline's next run (17127, on the `staging` branch) re-applied the
  old overlay over it: the `tcab-web` Service went back to port 80 while the
  tunnel routes to 8080, the internal-ingress objects and their network
  policies returned although ingress-nginx and cert-manager are uninstalled,
  the SecretProviderClass again names the deleted `cloudflare-dns-token`, and
  the backend lost its edge environment.

## What to do

Merge `staging` into `nightly` so every feature `staging` carries lands where
its code now lives (the `ui-common`, `contracts`, `microservice-repos` and
other repositories take the parts that moved), with every gate green. Then
promote `nightly` to `staging` through a pull request so the staging pipeline
builds the images and applies the current overlay. Extend the pipeline's
retirement step (`scripts/ci/retire-legacy-backend.sh`, run by
`deploy-environment.sh` and `pre-deploy.sh`) so an apply also removes the
internal-ingress Ingress objects, their `-from-ingress` network policies and
the `tcab-auth` workload a namespace deployed from the old overlay still
runs, since `kubectl apply` prunes nothing. Fold the 16Gi backend state
volume into the overlay so the apply accepts the live claim.

## Verify

`make gate` passes on `nightly` and on `staging`, the staging pipeline's run
on the promoted commit deploys green, the live namespace matches
`scripts/ci/deploy-environment.sh --render staging <commit>` under
`kubectl diff` with no retired object left, and the console, API, artifacts
and Grafana answer through the tunnel.
