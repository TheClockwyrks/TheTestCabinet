# Task 6 — Manifests + Key Vault wiring for the publisher

**Status:** ✅ Code-complete (manifests written), pending operator follow-ups. Verified 2026-06-27. Depends on task-2 (dispatcher config keys) and task-5
(the published image). Read the `azure-prod-deployment` memory first.

## Goal

Wire the publish path into the `azure-prod` deployment: the dispatcher knows the
publisher image + its secrets, the publisher's GitHub/Cloudflare credentials flow
from Key Vault via the CSI driver, and the publisher Job runs under a minimal
ServiceAccount.

## Key Vault

Add two secrets (KV names use dashes — no underscores/dots):

- `github-pat` — value from the repo `.env` `GITHUB_PAT`. Upload with the firewall
  pattern used elsewhere (temporarily allow the egress IP, set, remove) — see
  `scripts/upload-subscription-creds.sh` for the exact idiom, or run from the VPN.
- `cloudflare-pages-api-token` — upload the **value of `CLOUDFLARE_PAGES_API_KEY`**
  from the repo `.env`. Verified 2026-06-27: it is a valid, active scoped API token
  with Pages access (passes `/user/tokens/verify`; lists the account's Pages
  projects, including the target `test-cabinet-runs`). No minting needed — the
  earlier "must mint" note is stale (it was the unrelated `CLOUDFLARE_API_TOKEN`
  that failed verify). Same firewall idiom as `github-pat`.

## SecretProviderClass (`deployments/k8s/components/keyvault-csi/secretproviderclass.yaml`)

Add a new materialized Secret `tcab-publisher-secrets` (a 6th `secretObjects`
entry), and the two `objects` entries:

```
objects:  github-pat, cloudflare-pages-api-token
secretObjects:
  - secretName: tcab-publisher-secrets
    data:
      - { objectName: github-pat,                 key: GH_TOKEN }
      - { objectName: cloudflare-pages-api-token, key: CLOUDFLARE_API_TOKEN }
```

(`gh` reads `GH_TOKEN`; `wrangler` reads `CLOUDFLARE_API_TOKEN`.)

**CSI gotcha:** the driver won't add keys to an *existing* synced Secret on
remount, but `tcab-publisher-secrets` is new so it materializes fine. If you ever
add keys to it later, `kubectl delete secret tcab-publisher-secrets` then restart
`tcab-keyvault-sync`.

## Overlay (`deployments/k8s/overlays/azure-prod/`)

- Add a dispatcher patch (extend `patch-dispatcher-subscription.yaml` or a new
  `patch-dispatcher-publisher.yaml`, then list it in `kustomization.yaml`'s
  `patches`) setting:
  - `TCAB_PUBLISHER_IMAGE=ghcr.io/theclockwyrks/tcab-publisher:latest` (pin a
    `:<git-sha>` once built — the `images:` transformer doesn't reach an env value,
    same reason `patch-dispatcher-driver-image.yaml` exists).
  - `TCAB_DISPATCHER_PUBLISHER_SECRETS=tcab-publisher-secrets`.
  - `TCAB_GITHUB_ORG` / `TCAB_PAGES_PROJECT` — **no override needed**: the
    `PublishConfig` defaults (`TheClockwyrks` / `test-cabinet-runs`) are correct.
    The `test-cabinet-runs` Pages project was confirmed to exist (2026-06-27).
- Add `ghcr.io/REPLACE_OWNER/tcab-publisher` → `ghcr.io/theclockwyrks/tcab-publisher`
  to the `images:` block (so the dispatcher-created Job's image, if also set as a
  container image anywhere, is rewritten; the env value is patched above
  regardless).

## ServiceAccount + RBAC

The publisher Job needs **no** Kubernetes API access (it only talks HTTP to the
backend + artifact service). Give it the namespace `default` SA or a dedicated
`tcab-publisher` SA with no Role — explicitly **not** the `tcab-driver` SA (which
can create/exec pods). The dispatcher already has the RBAC to *create* the Job
(`deployments/k8s/base/rbac.yaml:59`); no new dispatcher RBAC is required.

## Apply + verify

Apply via `az aks command invoke` (the cluster is private — see the memory). After
the image is built + public and the secrets are in KV: trigger a publish and watch
`GET /publish-jobs/{id}/live`; confirm a `tcab-publisher-*` Job runs, the repo +
Pages deploy appear, and the run flips published with links.

## Out of scope

The code (tasks 1–4) and the image build (task-5).
