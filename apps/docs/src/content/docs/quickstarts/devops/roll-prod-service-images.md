---
title: Roll Production Service Images
---

## Overview

Roll a service by bumping its repository's submodule pointer in the superrepo
and merging to `master`. The Azure pipeline gates the commit and rolls
`tcab-prod` onto the deploy set its pointers name, each image pushed by its
repository's pipeline to `testcabinet.azurecr.io` as `<image>:<commit>`: the
[backend](/components/backend/overview/),
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [repos](/components/repos/overview/),
[arena](/components/arena/overview/), publisher, and
[console](/components/web/overview/) images, plus the run-container images
through `TCAB_CONTAINER_TAG`.

The full walkthrough is
[Rolling Production Service Images](/guides/devops/rolling-prod-service-images/),
and the deploy itself is described in
[Kubernetes](/deployment/kubernetes/overview/#deploying).

## Prerequisites

- The commit has been rehearsed on `staging`, which the pipeline rolls from the
  `staging` branch through the workspace template's own deploy.
- For verifying or rolling back by hand: `az` signed in as an identity holding the
  [deploy roles](/deployment/kubernetes/overview/#the-deploy-identity) on
  `testcabinet-prod-westus2-aks`, plus `kubectl` and `jq`. The API server is
  private, so commands reach it through `az aks command invoke`.

## Steps

```sh
# 1. Bump the pointer and merge to master (for a release, the vX.Y.Z PR from
#    staging). The pipeline runs the gates, then the prod stage, on the merge
#    commit; watch the prod stage's deploy_prod job.

# 2. Confirm the rollout landed on the pinned commits.
az aks command invoke -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl -n tcab-prod get deploy,statefulset -o wide"
```

A rollout that does not become ready within 600 seconds is undone by the
pipeline and fails `deploy_prod`, leaving that workload on its previous image.

## Rolling back

Put an earlier deploy set back by running the deploy by hand with the
superrepo commit whose pointers name it:

```sh
az login
scripts/ci/deploy-environment.sh --render prod <earlier-sha>   # preview only
scripts/ci/deploy-environment.sh prod <earlier-sha>
```

Or revert the pointer bump on `master` and let the pipeline deploy the revert.
A roll by hand lasts until the next merge to `master` deploys over it.

## Next steps

- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
  is the full guide, covering verification, rollback, and the catalog re-ingest.
- [Kubernetes](/deployment/kubernetes/overview/) describes the deployment
  topology and the cluster bootstrap.
