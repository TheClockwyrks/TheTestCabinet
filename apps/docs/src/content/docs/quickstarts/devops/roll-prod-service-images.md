---
title: Roll Production Service Images
---

## Overview

Roll the production cluster to a new commit by merging it to `master`. The Azure
pipeline gates the commit, builds every image at its sha into
`testcabinet.azurecr.io`, and rolls `tcab-prod` to them: the
[backend](/components/backend/overview/), auth,
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
publisher, and [web console](/components/web/overview/) images, plus the
run-container images through `TCAB_CONTAINER_TAG`.

The full walkthrough is
[Rolling Production Service Images](/guides/devops/rolling-prod-service-images/),
and the deploy itself is described in
[Kubernetes](/deployment/kubernetes/overview/#deploying).

## Prerequisites

- The commit has been rehearsed on `staging`, which the pipeline rolls the same
  way from the `staging` branch.
- For verifying or rolling back by hand: `az` signed in as an identity holding the
  [deploy roles](/deployment/kubernetes/overview/#the-deploy-identity) on
  `testcabinet-prod-westus2-aks`, plus `kubectl` and `jq`. The API server is
  private, so commands reach it through `az aks command invoke`.

## Steps

```sh
# 1. Merge to master (for a release, the vX.Y.Z PR from staging). The pipeline
#    runs gates -> images -> deploy on the merge commit; watch its deploy_prod job.

# 2. Confirm the rollout landed on the new sha.
az aks command invoke -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl -n tcab-prod get deploy,statefulset -o wide"
```

A rollout that does not become ready within 600 seconds is undone by the
pipeline and fails `deploy_prod`, leaving that workload on its previous image.

## Rolling back

Put an earlier commit's images back by running the deploy by hand with its sha:

```sh
az login
scripts/ci/deploy.sh --render prod <earlier-sha>   # preview, no cluster needed
scripts/ci/deploy.sh prod <earlier-sha>
```

Or revert the change on `master` and let the pipeline deploy the revert. A roll
by hand lasts until the next merge to `master` deploys over it.

## Next steps

- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
  is the full guide, covering verification, rollback, and the catalog re-ingest.
- [Kubernetes](/deployment/kubernetes/overview/) describes the deployment
  topology and the cluster bootstrap.
