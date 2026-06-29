---
title: Rolling Production Service Images
---

Promote a new build of the always-on **service** images
([backend](/components/backend/overview/), [auth](/components/backend/overview/),
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
publisher, and the [web console](/components/web/overview/)) to the production
cluster: read the git-sha CI has already built, re-pin the prod overlay to it,
apply, and commit. This is the routine "ship what's on `master` to prod" loop.

This guide covers the **service** images only. The **run-container** images a run
executes inside (`test-cabinet-base` and friends) reach the cluster by a different
mechanism and are pinned separately — see
[Run-container vs service images](#run-container-vs-service-images) below and the
pinning model in [Kubernetes](/deployment/kubernetes/#prerequisites). For cutting
the downloadable binaries and the static sites instead, see
[Releasing](/development/releasing/).

If you just want the commands, the [Roll Production Service
Images](/quickstarts/roll-prod-service-images/) quickstart is the terse version.

## How the images reach prod

CI builds every service image on each push to `master` and pushes it to GHCR
tagged both `:latest` and an immutable `:<git-sha>`, multi-arch
(`linux/amd64` + `linux/arm64`), via the
[`build-service-images.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-service-images.yml)
workflow. Production does **not** track `:latest`; it pins an immutable
`:<git-sha>` in the kustomize overlay so a deploy is reproducible and a rollback
is a one-line revert. Promoting a build therefore means moving that pin to a newer,
already-built sha.

The production overlay is
[`deployments/k8s/overlays/azure-prod`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/azure-prod)
(prod on managed PostgreSQL — applied *instead of* `overlays/prod`). The sha is
pinned in **three** places there, because not every image reference is a container
`image:` field the kustomize `images:` transformer can rewrite:

| File | What it pins | Why it's separate |
| --- | --- | --- |
| `kustomization.yaml` (`images:` block) | All eight service images' `newTag` | Normal `image:` fields — the `images:` transformer rewrites these. |
| `patch-dispatcher-driver-image.yaml` | `TCAB_DRIVER_IMAGE` | An env **value**, not an `image:` field — the transformer can't reach it. |
| `patch-dispatcher-publisher.yaml` | `TCAB_PUBLISHER_IMAGE` | Same: an env value the dispatcher passes to each publish Job. |

All three must move together so every service runs the same sha. (The driver and
publisher images are referenced as env values because the dispatcher spawns the
driver and publisher as *Jobs* at run time, not as long-lived Deployments — see
the [dispatcher](/components/dispatcher/overview/).)

## Prerequisites

- The [GitHub CLI](https://cli.github.com/) (`gh`) authenticated against
  `TheClockwyrks/TheTestCabinet`, to read CI run status.
- The [Azure CLI](https://learn.microsoft.com/cli/azure/) (`az`) authenticated to
  the subscription that owns the cluster (`az login`). The production cluster
  `testcabinet-prod-westus2-aks` (resource group `testcabinet-prod-westus2-rg`,
  namespace `tcab-prod`) is a **private** AKS cluster: its API server has no public
  IP, so `kubectl` can only reach it over the VPN. The portable way to drive it
  from anywhere is `az aks command invoke`, which runs your `kubectl` from a managed
  pod *inside* the cluster through the Azure control plane — no VPN, no `kubelogin`,
  and the in-cluster `kubectl`/`kustomize` are recent enough to render the overlay.
- A clean working tree on `master` (you'll commit the pin change).

## Steps

### 1. Find the sha CI has built

List the most recent runs of the service-image workflow and take the newest
`success`:

```sh
gh run list --workflow=build-service-images.yml --branch master --limit 10 \
  --json headSha,status,conclusion,displayTitle,createdAt
```

The newest successful run's `headSha` is your target — usually the current tip of
`master`. Use the **full 40-character** sha; that is the image tag. A green run
means all eight images were pushed, but if you want to be certain a tag exists
before you point prod at it, ask GHCR directly (the packages are public):

```sh
SHA=<full-sha>
for pkg in tcab-backend tcab-auth-service tcab-dispatcher tcab-driver \
           tcab-artifacts tcab-arena tcab-publisher tcab-web; do
  tok=$(curl -s "https://ghcr.io/token?scope=repository:theclockwyrks/$pkg:pull" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  printf '%s: %s\n' "$pkg" \
    "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" \
       -H 'Accept: application/vnd.oci.image.index.v1+json' \
       "https://ghcr.io/v2/theclockwyrks/$pkg/manifests/$SHA")"
done   # all eight should print 200
```

### 2. Re-pin the prod overlay

Replace the old sha with the new one in all three files
(`deployments/k8s/overlays/azure-prod/`):

```sh
OLD=<current-sha>; NEW=<target-sha>
sed -i "s/$OLD/$NEW/g" \
  deployments/k8s/overlays/azure-prod/kustomization.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-driver-image.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-publisher.yaml
```

Then **read the diff** and confirm the only changes are the eight `newTag`s, the
`TCAB_DRIVER_IMAGE` value, and the `TCAB_PUBLISHER_IMAGE` value — and that
`TCAB_CONTAINER_TAG` is **untouched** (it pins the run-container images, on a
separate cadence; see below). Update the explanatory comment block at the top of
`kustomization.yaml` to name the new sha and what it carries, so the next operator
knows what's deployed.

### 3. Preview against the live cluster

Run from `deployments/k8s` so `--file .` uploads the whole base + overlays +
components tree and the overlay's `../../base` references resolve:

```sh
cd deployments/k8s
az aks command invoke \
  -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl diff -k overlays/azure-prod" \
  --file .
```

A server-side diff that shows **only** the image-tag and env-value lines flipping
from the old sha to the new one (plus the harmless `generation` bumps) is the
green light. Anything else — a secret, an ingress, a resource limit — means your
working tree carries an unrelated change; resolve that before applying.
`kubectl diff` exits non-zero when there *are* differences, so `command invoke`
reporting `exitcode=1` here is expected, not a failure.

### 4. Apply and watch the rollout

```sh
az aks command invoke \
  -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl apply -k overlays/azure-prod" \
  --file .
```

Only the six image-bearing workloads should report `configured`; everything else
`unchanged`. Wait for them to settle and confirm they came up on the new sha:

```sh
az aks command invoke \
  -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "for d in tcab-arena tcab-auth tcab-backend tcab-dispatcher tcab-web; do \
               kubectl -n tcab-prod rollout status deploy/\$d --timeout=180s; done; \
             kubectl -n tcab-prod rollout status statefulset/tcab-artifacts --timeout=180s; \
             kubectl -n tcab-prod get deploy,statefulset \
               -o jsonpath='{range .items[*]}{.metadata.name}{\"\t\"}{.spec.template.spec.containers[*].image}{\"\n\"}{end}'"
```

Every `tcab-*` workload should print the new sha and report
`successfully rolled out`.

### 5. Commit the pin

The overlay is the record of what's deployed, so commit it once the rollout is
healthy:

```sh
git add deployments/k8s/overlays/azure-prod/
git commit -m "chore(deploy): roll prod service images to <short-sha>"
```

## Run-container vs service images

The run-container images (`test-cabinet-base`, `-sprite`, `-sprite-sheet`,
`-adversarial`, `-performance`) are **not** `image:` fields anywhere — the
[driver](/components/driver/overview/) resolves them at run time and the
dispatcher forwards the tag into every driver Job. They are pinned by
`TCAB_CONTAINER_TAG` in `patch-dispatcher-driver-image.yaml`, and they roll on
their **own** cadence: they only rebuild when the
[`build-containers.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-containers.yml)
workflow runs (a service-only change to `master` does not rebuild them), so
`TCAB_CONTAINER_TAG` tracks the latest sha at which `build-containers` actually
published multi-arch — which is usually **behind** the service-image sha. Leave it
alone during a service roll; only advance it to a sha where `build-containers`
published. The general pinning model is in
[Kubernetes → Prerequisites](/deployment/kubernetes/#prerequisites).

## Rolling back

A rollback is the same flow with the previous sha as the target: re-pin the three
files back, `apply`, and revert the commit. Because every service is pinned to one
immutable sha, the previous deploy is fully described by the previous overlay
revision.

## Staging first

There is one production cluster today. When a staging environment exists, promote
there first (`overlays/azure-staging`) and exercise it before rolling prod — the
overlays are deliberately identical apart from namespace, `TCAB_ENV`, and secrets,
so staging rehearses prod faithfully.
</content>
</invoke>
