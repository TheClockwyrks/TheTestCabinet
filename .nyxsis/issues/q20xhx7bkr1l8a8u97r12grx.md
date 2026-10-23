---
format: nyxsis-issue
version: 3
id: q20xhx7bkr1l8a8u97r12grx
zone: CICD
number: 4
title: Carry staging's feature work into nightly and promote nightly to staging through the pipelines
type: generic
state: done
created: 2026-10-20T22:47:37.760158351Z
done: 2026-10-22T03:35:43.438503801Z
outcome: |
  Landed in PR 4998 into nightly (24a546b59) with REPOS-22: staging's commits are
  merged into nightly with each moved feature re-applied in its owning repository,
  contracts v0.2.4 (PR 4906), engines v1.1.3 then v1.1.4 (PRs 4921, 4927, 4929 and
  the REPOS-22 release), microservice-dispatcher (PR 4920), microservice-driver
  (PR 4931) and ui-common (PR 4928), all at their masters, with the kit's TAGS
  naming contracts v0.2.4, engines v1.1.4, tool-model-core v0.1.2 and
  tool-audio-core v0.1.2. The retirement script also deletes the old Ingress
  objects, their network policies and the auth workload, and the 16Gi backend
  claim is in the staging overlay; live staging was read only (the claim is 16Gi,
  a server dry-run of the render is accepted, the retired objects are present).
  Eight staging features were superseded by nightly's documented design and not
  carried: the artifacts capacity route, write check, dispatch hold and storage
  notice; the publish presence gate; snapshot refresh batching; tree reclaim after
  publish, confirmation and the run media route; the publish-failing hold; run
  files in the bucket, manifest and backend store with state hold and reclaim;
  session record export and reclaim; and scripts/reingest-cluster.sh (tcab ingest
  --env). Staging's migrations 000058..000064 stay registered. Superrepo gates 28
  of 28 on the branch and on nightly after the merge, and a clean clone's npm ci
  resolves. Not done: the promotion pull request of nightly into staging is not
  opened, because the superrepo pipeline's jobs name every submodule and the
  scoped job token caps a pipeline at 20 repositories (CICD-1); the staging
  rollout and the live checks of the extracted services follow that promotion.
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
