---
title: Rolling Production Service Images
---

## Overview

Promote a new build of the always-on service images to the production cluster:
read the git sha CI has already built, re-pin the production overlay to it,
apply, and commit. The eight service images are the
[backend](/components/backend/overview/), auth,
[dispatcher](/components/dispatcher/overview/),
[driver](/components/driver/overview/),
[artifacts](/components/artifacts/overview/), [arena](/components/arena/overview/),
publisher, and [web console](/components/web/overview/).

This guide covers the service images. The run-container images a run executes
inside reach the cluster by a different mechanism and are pinned separately. See
[Run-container and service images](#run-container-and-service-images) and the
pinning model in
[Kubernetes](/deployment/kubernetes/overview/#prerequisites). For cutting the
downloadable binaries and the static sites, see
[Releasing](/development/releasing/).

## Image pinning in production

CI builds every service image on each push to `master` and pushes it to GHCR
tagged both `:latest` and an immutable `:<git-sha>`, multi-arch (`linux/amd64`
and `linux/arm64`), through the
[`build-service-images.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-service-images.yml)
workflow. Production pins an immutable `:<git-sha>` in the kustomize overlay, so
a deploy is reproducible and a rollback is a one-line revert. Promoting a build
means moving that pin to a newer, already-built sha.

The production overlay is
[`deployments/k8s/overlays/azure-prod`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/azure-prod),
applied instead of `overlays/prod`. The sha is pinned in three places there,
because not every image reference is a container `image:` field the kustomize
`images:` transformer can rewrite:

| File                                   | What it pins                       | Why it's separate                                                 |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `kustomization.yaml` (`images:` block) | All eight service images' `newTag` | Normal `image:` fields, which the `images:` transformer rewrites. |
| `patch-dispatcher-driver-image.yaml`   | `TCAB_DRIVER_IMAGE`                | An env value, not an `image:` field.                              |
| `patch-dispatcher-publisher.yaml`      | `TCAB_PUBLISHER_IMAGE`             | An env value the dispatcher passes to each publish Job.           |

All three must move together so every service runs the same sha. The driver and
publisher images are referenced as env values because the dispatcher spawns them
as Jobs at run time rather than as long-lived Deployments; see the
[dispatcher](/components/dispatcher/overview/).

## Prerequisites

- The [GitHub CLI](https://cli.github.com/) (`gh`) authenticated against
  `TheClockwyrks/TheTestCabinet`, to read CI run status.
- The [Azure CLI](https://learn.microsoft.com/cli/azure/) (`az`) authenticated to
  the subscription that owns the cluster (`az login`). The production cluster
  `testcabinet-prod-westus2-aks` (resource group `testcabinet-prod-westus2-rg`,
  namespace `tcab-prod`) is a private AKS cluster: its API server has no
  public IP, so `kubectl` reaches it over the VPN. The portable way to drive it
  from anywhere is `az aks command invoke`, which runs your `kubectl` from a
  managed pod inside the cluster through the Azure control plane. The in-cluster
  `kubectl` and `kustomize` are recent enough to render the overlay.
- A clean working tree on `master`, since you commit the pin change.

## 1. Find the sha CI has built

List the most recent runs of the service-image workflow and take the newest
`success`:

```sh
gh run list --workflow=build-service-images.yml --branch master --limit 10 \
  --json headSha,status,conclusion,displayTitle,createdAt
```

The newest successful run's `headSha` is your target, usually the current tip of
`master`. Use the full 40-character sha, which is the image tag. A green run
means all eight images were pushed. To confirm a tag exists before pointing
production at it, ask GHCR directly. The packages are public:

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

## 2. Re-pin the production overlay

Replace the old sha with the new one in all three files:

```sh
OLD=<current-sha>; NEW=<target-sha>
sed -i "s/$OLD/$NEW/g" \
  deployments/k8s/overlays/azure-prod/kustomization.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-driver-image.yaml \
  deployments/k8s/overlays/azure-prod/patch-dispatcher-publisher.yaml
```

Then read the diff and confirm the only changes are the eight `newTag`s, the
`TCAB_DRIVER_IMAGE` value, and the `TCAB_PUBLISHER_IMAGE` value, and that
`TCAB_CONTAINER_TAG` is untouched: it pins the run-container images, which move
with a rehearsed release rather than with a service roll, as described below.
Update the comment block at the top of `kustomization.yaml` to name the new sha
and what it carries.

## 3. Preview against the live cluster

Run from `deployments/k8s` so `--file .` uploads the whole base, overlays, and
components tree and the overlay's `../../base` references resolve:

```sh
cd deployments/k8s
az aks command invoke \
  -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl diff -k overlays/azure-prod" \
  --file .
```

A server-side diff showing only the image-tag and env-value lines flipping from
the old sha to the new one, plus the `generation` bumps, is the green light.
Any other change, such as a secret, an ingress, or a resource limit, means the
working tree carries an unrelated change; resolve that before applying.
`kubectl diff` exits non-zero when there are differences, so `command invoke`
reporting `exitcode=1` here is expected.

## 4. Apply and watch the rollout

```sh
az aks command invoke \
  -g testcabinet-prod-westus2-rg -n testcabinet-prod-westus2-aks \
  --command "kubectl apply -k overlays/azure-prod" \
  --file .
```

The six image-bearing workloads report `configured`; everything else `unchanged`.
Wait for them to settle and confirm they came up on the new sha:

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

## 5. Commit the pin

The overlay is the record of what is deployed, so commit it once the rollout is
healthy:

```sh
git add deployments/k8s/overlays/azure-prod/
git commit -m "chore(deploy): roll prod service images to <short-sha>"
```

## Run-container and service images

The run-container images the driver resolves for each sandbox pod are pinned by
`TCAB_CONTAINER_TAG` in `patch-dispatcher-driver-image.yaml`. They are env values
the [driver](/components/driver/overview/) reads at run time and the dispatcher
forwards into every driver Job.

They roll on their own cadence by choice rather than by availability.
[`build-containers.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-containers.yml)
runs unfiltered on every push to `master`, so multi-arch run images exist at every
sha the service images do and `TCAB_CONTAINER_TAG` can always be advanced to the
sha the services are being rolled to. The pin historically trailed a long way
behind, because the workflow was once path-filtered and most shas carried no run
images; a production overlay still sitting on such a sha is safe to move forward.

Keep it a separate decision from the service roll all the same. The tag changes
the image every future run executes inside, so it belongs to a release rehearsed
on staging rather than to a service hotfix. The general pinning model is in
[Kubernetes](/deployment/kubernetes/overview/#prerequisites).

## Rolling back

A rollback is the same flow with the previous sha as the target: re-pin the three
files back, apply, and revert the commit. Because every service is pinned to one
immutable sha, the previous deploy is fully described by the previous overlay
revision.

## Staging rehearsal

Promote to staging and exercise it before rolling production. Staging applies
`overlays/azure-staging` against cluster `testcabinet-staging-westus2-aks`
(resource group `testcabinet-staging-westus2-rg`, namespace `tcab-staging`) and
pins the same three files. The two overlays are identical apart from namespace,
`TCAB_ENV`, the resources they point at, and the image tags, so staging rehearses
production faithfully.
