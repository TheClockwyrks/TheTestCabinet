---
title: Roll Production Service Images
---

## Overview

Promote CI-built service images to the production cluster by re-pinning the prod
overlay to a newer git sha and applying it. The images covered are the
[backend](/components/backend/overview/), auth,
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
publisher, and the [web console](/components/web/overview/).

The run-container images are pinned separately by `TCAB_CONTAINER_TAG` and roll
on their own cadence. The full walkthrough is
[Rolling Production Service Images](/guides/devops/rolling-prod-service-images/),
and the pinning model is in
[Kubernetes](/deployment/kubernetes/overview/#prerequisites).

## Prerequisites

- `gh` authenticated against `TheClockwyrks/TheTestCabinet`.
- `az` logged in to the cluster's subscription. Prod
  (`testcabinet-prod-westus2-aks`, resource group
  `testcabinet-prod-westus2-rg`, namespace `tcab-prod`) is a private AKS cluster,
  so drive it with `az aks command invoke`, which runs `kubectl` from inside the
  cluster.

## Steps

```sh
# 1. Find the newest successfully-built sha (usually the tip of master).
gh run list --workflow=build-service-images.yml --branch master --limit 10 \
  --json headSha,status,conclusion,displayTitle,createdAt

# 2. Re-pin all THREE files: the images: block and the two env-value image refs.
#    Leave TCAB_CONTAINER_TAG alone.
OLD=<current-sha>; NEW=<full-target-sha>
sed -i "s/$OLD/$NEW/g" \
  deployments/k8s/overlays/azure-prod/kustomization.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-driver-image.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-publisher.yaml
git diff   # expect only image tags + TCAB_DRIVER_IMAGE/TCAB_PUBLISHER_IMAGE to change

# 3. Preview, then apply, from deployments/k8s so --file . uploads base/ too.
cd deployments/k8s
RG=testcabinet-prod-westus2-rg; AKS=testcabinet-prod-westus2-aks
INV="az aks command invoke -g $RG -n $AKS --file ."
$INV --command "kubectl diff  -k overlays/azure-prod"   # diff exits 1 when there ARE changes
$INV --command "kubectl apply -k overlays/azure-prod"   # the image-bearing workloads -> configured

# 4. Confirm the rollout landed on the new sha.
$INV --command "kubectl -n tcab-prod rollout status deploy/tcab-backend --timeout=180s; \
                kubectl -n tcab-prod get deploy,statefulset \
                  -o jsonpath='{range .items[*]}{.metadata.name}{\"\t\"}{.spec.template.spec.containers[*].image}{\"\n\"}{end}'"
```

Then commit the overlay, which is the record of what is deployed:

```sh
git add deployments/k8s/overlays/azure-prod/
git commit -m "chore(deploy): roll prod service images to <short-sha>"
```

## Next steps

- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
  is the full guide, covering verification, rollback, and the run-container
  pinning.
- [Kubernetes](/deployment/kubernetes/overview/) describes the deployment
  topology these commands act on.
