---
title: Roll Production Service Images
---

Promote the latest CI-built **service** images
([backend](/components/backend/overview/),
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
auth, publisher, [web console](/components/web/overview/)) to the production
cluster by re-pinning the prod overlay to a newer git-sha and applying it.

For the full walkthrough and the *why* — including the private-cluster mechanics
and the run-container images' separate cadence — see [Rolling Production Service
Images](/guides/rolling-prod-service-images/). The image pinning model lives in
[Kubernetes](/deployment/kubernetes/#prerequisites).

## Prerequisites

- `gh` authenticated against `TheClockwyrks/TheTestCabinet`.
- `az` logged in to the cluster's subscription. Prod
  (`testcabinet-prod-westus2-aks`, RG `testcabinet-prod-westus2-rg`, namespace
  `tcab-prod`) is a **private** AKS cluster, so drive it with `az aks command
  invoke` (runs `kubectl` from inside the cluster — no VPN, no `kubelogin`).

## Steps

```sh
# 1. The newest successfully-built sha (usually the tip of master).
gh run list --workflow=build-service-images.yml --branch master --limit 10 \
  --json headSha,status,conclusion,displayTitle,createdAt

# 2. Re-pin all THREE files (the images: block + the two env-value image refs).
#    Leave TCAB_CONTAINER_TAG (run-container images) untouched — different cadence.
OLD=<current-sha>; NEW=<full-target-sha>
sed -i "s/$OLD/$NEW/g" \
  deployments/k8s/overlays/azure-prod/kustomization.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-driver-image.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-publisher.yaml
git diff   # expect ONLY image tags + TCAB_DRIVER_IMAGE/TCAB_PUBLISHER_IMAGE to change

# 3. Preview, then apply — run from deployments/k8s so --file . uploads base/ too.
cd deployments/k8s
INV="az aks command invoke -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks --file ."
$INV --command "kubectl diff  -k overlays/azure-prod"   # diff exits 1 when there ARE changes — expected
$INV --command "kubectl apply -k overlays/azure-prod"   # only the 6 image-bearing workloads -> configured

# 4. Confirm the rollout landed on the new sha.
$INV --command "kubectl -n tcab-prod rollout status deploy/tcab-backend --timeout=180s; \
                kubectl -n tcab-prod get deploy,statefulset \
                  -o jsonpath='{range .items[*]}{.metadata.name}{\"\t\"}{.spec.template.spec.containers[*].image}{\"\n\"}{end}'"
```

Then commit the overlay — it's the record of what's deployed:

```sh
git add deployments/k8s/overlays/azure-prod/ && git commit -m "chore(deploy): roll prod service images to <short-sha>"
```

## Next steps

- [Rolling Production Service Images](/guides/rolling-prod-service-images/) — the
  full guide, with previewing, verification, rollback, and the run-container
  caveat.
- [Kubernetes](/deployment/kubernetes/) — the deployment topology and the pinning
  model these commands act on.
</content>
