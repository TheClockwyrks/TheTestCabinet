---
title: Rolling Production Service Images
---

## Overview

Production runs the deploy set of the last commit the Azure pipeline deployed
from `master`: every image pinned to the commit the superrepo's submodule
pointer for its repository names. Rolling a service is bumping that pointer
and merging to `master`: the pipeline gates the merge commit and rolls the
production cluster onto its set. The images are the
[backend](/components/backend/overview/),
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [repos](/components/repos/overview/),
[arena](/components/arena/overview/), publisher, and
[console](/components/web/overview/) service images, and the run-container
images a run executes inside, which `microservice-driver`'s pipeline builds
beside the driver's. The edge's `cloudflared` image is third-party, pinned in
its component, and not part of a roll.

The deploy mechanics are in [Kubernetes](/deployment/kubernetes/overview/#deploying).
For cutting the downloadable binaries and the static sites, see
[Releasing](/development/releasing/).

## Image pinning in production

Each `microservice-*` repository's pipeline builds its image natively for
`linux/amd64` and `linux/arm64` on every gated push and pushes it to
`testcabinet.azurecr.io` as the multi-arch `<image>:<commit>`; see
[The microservice images](/development/releasing/#the-microservice-images).
The `prod` stage's `deploy_prod` job runs
`scripts/ci/deploy-environment.sh prod <sha>`, which pins a temporary copy of
[`deployments/k8s/overlays/prod`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/prod)
with `scripts/ci/pin-images.sh`, setting each image to the commit the
superrepo's submodule pointer for its repository names:

| Reference                                       | Set to                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Each service's `image:`                         | `testcabinet.azurecr.io/<image>:<commit>` of that service's repository |
| The dispatcher's `TCAB_DRIVER_IMAGE`            | `testcabinet.azurecr.io/microservice-driver:<driver commit>`           |
| The dispatcher's `TCAB_PUBLISHER_IMAGE`         | `testcabinet.azurecr.io/tcab-publisher:<publisher commit>`             |
| `TCAB_CONTAINER_REGISTRY`, `TCAB_CONTAINER_TAG` | `testcabinet.azurecr.io`, `<driver commit>`                            |

The overlay names every image at the tag `unpinned`, which nothing pushes, so
applied unpinned it fails to pull, and the driver, its run images and the audio
store baked into the driver always come from one `microservice-driver` commit.
The dispatcher forwards `TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG` into
every driver `Job`, so every run started after the roll executes in that
commit's run images.

## Prerequisites

- The repository's commit is on its `master` or on its branch of the
  superrepo branch's name, so its pipeline has pushed `<image>:<commit>`; the
  `submodule_pins` job holds every pointer to one of those. See
  [Mirrors and pins](/development/building/#mirrors-and-pins).
- The pointer bump has been rehearsed on staging. A merge to `staging` rolls
  `overlays/staging` onto `testcabinet-staging-westus2-aks` (namespace
  `tcab-staging`), through the workspace template's `deploy` stage; see
  [Deploying](/deployment/kubernetes/overview/#deploying).
- The cluster bootstrap has been applied to the production cluster; see
  [Cluster prerequisites](/deployment/kubernetes/overview/#cluster-prerequisites).
- For verifying or rolling back by hand: the
  [Azure CLI](https://learn.microsoft.com/cli/azure/) signed in as an identity
  holding the [deploy roles](/deployment/kubernetes/overview/#the-deploy-identity)
  on `testcabinet-prod-westus2-aks` (resource group
  `testcabinet-prod-westus2-rg`, namespace `tcab-prod`), plus `kubectl` and
  `jq`. The API server is private, so every command reaches the cluster through
  `az aks command invoke`.

## 1. Bump the pointer and merge to master

Move the repository's submodule pointer in the superrepo to the commit to roll
and merge the change into `master`; for a release this is the `vX.Y.Z` pull
request from `staging`. The pull request runs the gates through the branch's
build validation policy, and the merge commit runs the whole pipeline: the
gates, the GitHub mirror, and the `prod` stage.

## 2. Watch the deploy

The `deploy_prod` job applies the rendered set and waits up to 600 seconds,
concurrently, on every `Deployment` and `StatefulSet` rollout. A rollout that
does not become ready is described, its logs are printed to the job log, and it
is undone, and the job fails. Every other workload stays on its new pin.

To preview what a deploy applies without touching the cluster:

```sh
scripts/ci/deploy-environment.sh --render prod <sha>
```

## 3. Verify

Confirm each workload runs its pinned commit:

```sh
az aks command invoke -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl -n tcab-prod get deploy,statefulset -o wide"
```

Every `tcab-*` workload's image column shows
`testcabinet.azurecr.io/<image>:<commit>`, the commit its repository's pointer
names.

## The catalog

A roll that moves the backend's pin restarts the backend pod, and its ingest
sidecar force-ingests the `test-suites` repository's `master` tip. `tcab ingest
--env prod`, with the Access service token, refreshes the catalog after any
other roll and between deploys.

## Rolling back

Run the deploy by hand with the earlier superrepo commit, whose pointers name
the images to put back. The registry keeps the images both environments run,
the set just deployed and each repository's newest; an older image is put back
by reverting the change in its own repository, whose pipeline pushes the
revert's image, and pointing `master` at it.

```sh
scripts/ci/deploy-environment.sh prod <earlier-sha>
```

It applies, waits, and undoes a failed rollout exactly as the pipeline does. The
next merge to `master` deploys over it, so follow a hand rollback with a revert
of the pointer bump on `master` when the bad change should stay out. Reverting
on `master` alone is the other route: the pipeline deploys the revert commit.

A rollback that moves the backend's pin also restarts the backend, so the
catalog is re-ingested from the `test-suites` `master` tip rather than rolled
back with the images.
