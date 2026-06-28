# Task 3 — azure-prod overlay wiring + URL repointing

**Status:** ⬜ Not started. Depends on task-1 (the `tcab-web` image) and task-2 (the
`internal-ingress` component).

## Goal

Turn the component on for the live `azure-prod` overlay: add it, pin the `tcab-web` image,
set the console's backend/auth env to the https hostnames, and **repoint the backend's
advertised artifact/arena URLs** so console media resolves over the VPN.

## Changes (`deployments/k8s/overlays/azure-prod/`)

1. **`kustomization.yaml` — add the component** to `components:`:
   ```
   components:
     - ../../components/postgres
     - ../../components/observability
     - ../../components/keyvault-csi
     - ../../components/internal-ingress   # NEW
   ```
2. **`kustomization.yaml` — add the `tcab-web` image** to `images:` (concrete owner +
   pinned `:<git-sha>` once built, like the other services):
   ```
   - name: REPLACE_REGISTRY/tcab-web
     newName: ghcr.io/theclockwyrks/tcab-web
     newTag: <git-sha once built>      # :latest until then
   ```
3. **Console env** — set the tcab-web pod's runtime config via a patch (or override the
   component default): `TCAB_WEB_BACKEND_URL=https://api.testcabinet.ai`,
   `TCAB_WEB_AUTH_URL=https://auth.testcabinet.ai`.
4. **Repoint the backend's advertised URLs** — patch the backend Deployment env (current
   values live in `deployments/k8s/base/backend.yaml`):
   - `TCAB_ARTIFACTS_PUBLIC_URL` → `https://artifacts.testcabinet.ai`
   - `TCAB_ARENA_PUBLIC_URL` → `https://arena.testcabinet.ai`
   (`TCAB_BACKEND_AUTH_URL` is the backend's SERVER-SIDE token-verify URL and stays the
   in-cluster `http://tcab-auth:8789` — do NOT repoint it; only the client-facing
   `*_PUBLIC_URL`s and the console's own backend/auth URLs change.)
5. **Hostnames** — if the component left hostnames as a prod default, confirm they match;
   if the component parameterized them, set the five `*.testcabinet.ai` hosts here. Set the
   ClusterIssuer ACME email here too if not in the component.

Mirror the existing overlay conventions — the patches stack alongside
`patch-dispatcher-driver-image.yaml` / `patch-dispatcher-publisher.yaml` /
`patch-dispatcher-subscription.yaml`; add any new patch file to the `patches:` list (and
remember the `images:` transformer can't reach env VALUES, which is why the URL repoint is
a patch, same rationale as `patch-dispatcher-driver-image.yaml`).

## Staging note

Do NOT wire `azure-staging` / `prod` / `staging` yet — staging isn't stood up. When it is,
it adds the same component with `*.staging.testcabinet.ai` (or chosen) hostnames and its
own ClusterIssuer/secret; the component is written to support that via overlay overrides.

## Tests / checks

- `kubectl kustomize deployments/k8s/overlays/azure-prod` builds cleanly and the rendered
  output shows: the tcab-web Deployment on the pinned image, the five Ingresses, the
  backend env carrying the https `*_PUBLIC_URL`s, and the tcab-web pod env carrying the
  api/auth https URLs.
- Diff against live with `kubectl diff` (via `az aks command invoke`) before applying
  (task-6) to confirm the blast radius is only the new/changed resources.

## Out of scope

Installing controllers + DNS + token (task-4), the docs (task-5), the apply + smoke
(task-6).
