---
title: Rolling Production Service Images
---

## Overview

Production runs the images of the last commit the Azure pipeline deployed from
`master`. Rolling it is merging to `master`: the pipeline gates the merge commit,
builds every image at its sha, and rolls the production cluster to them. The
images are the [backend](/components/backend/overview/), auth,
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
publisher, and [web console](/components/web/overview/) service images, and the
run-container images a run executes inside.

The deploy mechanics are in [Kubernetes](/deployment/kubernetes/overview/#deploying).
For cutting the downloadable binaries and the static sites, see
[Releasing](/development/releasing/).

## Image pinning in production

The pipeline's image jobs build every service image and every run-container
image natively for `linux/amd64` and `linux/arm64` and push each to
`testcabinet.azurecr.io` as the multi-arch `<image>:<sha>`. The `prod` stage's
`publish_backend` job retags the backend image as
`the-test-cabinet-backend:<sha>`, and its `deploy_prod` job then runs
`scripts/ci/deploy-environment.sh prod <sha>`, which pins a temporary copy of
[`deployments/k8s/overlays/prod`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/prod)
with `scripts/ci/pin-images.sh`, setting every image to that sha:

| Reference                                       | Set to                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Each service's `image:`                         | `testcabinet.azurecr.io/<image>:<sha>`; the backend's is `the-test-cabinet-backend` |
| The dispatcher's `TCAB_DRIVER_IMAGE`            | `testcabinet.azurecr.io/tcab-driver:<sha>`                                          |
| The dispatcher's `TCAB_PUBLISHER_IMAGE`         | `testcabinet.azurecr.io/tcab-publisher:<sha>`                                       |
| `TCAB_CONTAINER_REGISTRY`, `TCAB_CONTAINER_TAG` | `testcabinet.azurecr.io`, `<sha>`                                                   |

The overlay names every image at the tag `unpinned`, which nothing pushes, so
applied unpinned it fails to pull, and every service, the driver's run images,
and the audio store baked into the driver always come from one build.
The dispatcher forwards `TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG` into
every driver `Job`, so every run started after the roll executes in that
commit's run images.

## Prerequisites

- The commit has been rehearsed on staging. A merge to `staging` rolls
  `overlays/staging` onto `testcabinet-staging-westus2-aks` (namespace
  `tcab-staging`), through the workspace template's publish and deploy stages;
  see [Deploying](/deployment/kubernetes/overview/#deploying).
- The cluster bootstrap has been applied to the production cluster; see
  [Cluster prerequisites](/deployment/kubernetes/overview/#cluster-prerequisites).
- For verifying or rolling back by hand: the
  [Azure CLI](https://learn.microsoft.com/cli/azure/) signed in as an identity
  holding the [deploy roles](/deployment/kubernetes/overview/#the-deploy-identity)
  on `testcabinet-prod-westus2-aks` (resource group
  `testcabinet-prod-westus2-rg`, namespace `tcab-prod`), plus `kubectl` and
  `jq`. The API server is private, so every command reaches the cluster through
  `az aks command invoke`.

## 1. Merge to master

Merge the change into `master`; for a release this is the `vX.Y.Z` pull request
from `staging`. The pull request runs the gates through the branch's build
validation policy, and the merge commit runs the whole pipeline: the gates and
the image jobs, the GitHub mirror, and the `prod` stage.

## 2. Watch the deploy

The `deploy_prod` job first deletes the legacy `tcab-backend` Deployment if it
still exists (the backend's Deployment is now `the-test-cabinet-backend`), then
applies the rendered set and waits up to 600 seconds, concurrently, on every
`Deployment` and `StatefulSet` rollout. A rollout that does not become ready is
described, its logs are printed to the job log, and it is undone, and the job
fails. Every other workload stays on the new sha.

To preview what a deploy applies without touching the cluster:

```sh
scripts/ci/deploy-environment.sh --render prod <sha>
```

## 3. Verify

Confirm each workload runs the new sha:

```sh
az aks command invoke -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl -n tcab-prod get deploy,statefulset -o wide"
```

Every `tcab-*` workload's image column shows
`testcabinet.azurecr.io/<image>:<sha>`.

## The catalog

The roll also publishes the catalog. Every deploy changes the backend's image
tag, so the backend pod restarts, and its ingest sidecar force-ingests the
`master` tip from the GitHub mirror, which the pipeline pushed before it
deployed. The catalog the backend serves is therefore the one that shipped with
the commit. `scripts/reingest-cluster.sh --env prod` refreshes it between
deploys.

## Rolling back

Run the deploy by hand with the earlier sha. The registry keeps every sha the
pipeline pushed:

```sh
scripts/ci/deploy-environment.sh prod <earlier-sha>
```

It applies, waits, and undoes a failed rollout exactly as the pipeline does. The
next merge to `master` deploys over it, so follow a hand rollback with a revert
on `master` when the bad change should stay out. Reverting on `master` alone is
the other route: the pipeline deploys the revert commit.

A rollback also restarts the backend, so the catalog is re-ingested from the
`master` tip rather than rolled back with the images.
