# Task 2 — `internal-ingress` kustomize component

**Status:** ⬜ Not started. Depends on task-1 only for the `tcab-web` image reference
(the Deployment names it). Assumes the ingress-nginx + cert-manager **controllers** are
installed out-of-band (task-4) — this component carries only app-level resources.

## Goal

A reusable kustomize **component** (`deployments/k8s/components/internal-ingress/`,
`kind: Component`, mirroring `components/observability` + `components/keyvault-csi`) that an
overlay opts into to: serve the console in-cluster and expose the console + four services
at the host-per-service `*.testcabinet.ai` names over the internal ingress, with TLS.

Hostnames are environment-specific, so the **values** that differ (the hostnames, the
tcab-web backend/auth env, the ClusterIssuer email/zone) are set/overridden in the overlay
(task-3); the component holds the structure with `tcab-prod` + the prod hostnames as the
default, patched per overlay.

## Contents (`deployments/k8s/components/internal-ingress/`)

1. **`web.yaml` — the console workload.**
   - `Deployment` `tcab-web` (image `REPLACE_REGISTRY/tcab-web`, so the overlay `images:`
     transformer can rewrite it; container port matching task-1's nginx, e.g. 8080). Env
     `TCAB_WEB_BACKEND_URL` / `TCAB_WEB_AUTH_URL` with placeholder/empty defaults — the
     overlay patches the real https URLs (task-3). Standard labels
     (`app.kubernetes.io/name: tcab-web`, `part-of: test-cabinet`), liveness/readiness on
     `/`, unprivileged, no volumes.
   - `Service` `tcab-web` (ClusterIP, port 80 → containerPort). ClusterIP only — the
     ingress is the boundary; never a LoadBalancer here (match the other services' comments).

2. **`ingress.yaml` — five Ingress resources** (or one multi-rule Ingress; prefer one per
   host for clarity), each:
   - `ingressClassName: nginx`, `cert-manager.io/cluster-issuer: letsencrypt-internal`
     annotation (so cert-manager issues the cert automatically).
   - host → backend service: `console.testcabinet.ai`→`tcab-web:80`,
     `api.testcabinet.ai`→`tcab-backend:8787`, `auth.testcabinet.ai`→`tcab-auth:8789`,
     `artifacts.testcabinet.ai`→`tcab-artifacts:8790`, `arena.testcabinet.ai`→`tcab-arena:8791`.
   - `tls:` with a per-host secretName (e.g. `tls-console`, `tls-api`, …) cert-manager fills.
   - Sensible nginx annotations: large `proxy-body-size` for artifact uploads/downloads
     (the artifact service streams tars), and `proxy-read-timeout` high enough for the
     backend's NDJSON live streams (run + publish `/…/live`) — these are long-lived
     responses; a short proxy timeout would cut them. Document the chosen values.
   - The hostnames belong in the OVERLAY (a kustomize patch or a small per-overlay
     `ingress` overlay), or as the component default with the overlay patching host strings.
     Pick the lighter approach; keep prod hostnames working by default.

3. **`clusterissuer.yaml` — cert-manager `ClusterIssuer` `letsencrypt-internal`** (ACME,
   `https://acme-v02.api.letsencrypt.org/directory`), **DNS-01 solver via Cloudflare**:
   `cloudflare` solver referencing a Secret key holding the **Zone:DNS:Edit** API token
   (the `cloudflare-dns-token` from task-4). DNS-01 is required because the hosts are
   internal-only (no inbound for HTTP-01). Set the ACME account email (overlay-overridable).
   - NOTE: `ClusterIssuer` + cert-manager CRDs are cluster-scoped and require the
     cert-manager controller (task-4) to exist before this applies cleanly. If the
     `kustomize build` should stay green without CRDs present, keep the ClusterIssuer in
     this component but be aware `kubectl apply` of it needs cert-manager installed first.

4. **`networkpolicy.yaml` — admit the ingress controller.** The base
   `tcab-default-deny-ingress` blocks inbound; mirror `tcab-allow-services-from-runners`
   (`base/networkpolicy.yaml`) to add a rule admitting the **ingress-nginx namespace** to
   `tcab-backend`/`tcab-auth`/`tcab-artifacts`/`tcab-arena`/`tcab-web` on their ports, via:
   ```
   - from:
       - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ingress-nginx } }
   ```
   (confirm the ingress-nginx namespace label; `kubernetes.io/metadata.name` is auto-set).
   Add a policy targeting `tcab-web` too (nothing admits it today). Keep arena/artifacts'
   existing policies intact and additive.

5. **`kustomization.yaml`** (`kind: Component`) listing the above resources, mirroring
   `components/observability/kustomization.yaml`.

## Tests / checks

- `kubectl kustomize` of an overlay that includes the component builds cleanly (CRDs for
  Ingress are built-in; the cert-manager `ClusterIssuer`/`Certificate` are custom kinds —
  if kustomize complains, that's expected without the CRDs and is fine for a build check;
  the apply ordering is handled in task-4/6).
- Rendered output: five Ingresses with the right host→service:port, TLS secrets, the
  ClusterIssuer with the Cloudflare DNS-01 solver, the tcab-web Deployment/Service, and the
  NetworkPolicy admitting the ingress namespace.

## Out of scope

Installing the controllers + DNS + the Cloudflare token (task-4); the overlay opt-in + the
real hostnames/URLs (task-3). This task is the component structure.
