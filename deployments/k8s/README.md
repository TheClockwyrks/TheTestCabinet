# Kubernetes deployment manifests

Copy-pasteable manifests for deploying The Test Cabinet to a Kubernetes namespace,
where a run is a **per-run Kubernetes Job**: the **dispatcher** drains the
backend's run queue and creates one **driver** Job per run, and each driver spawns
a **separate sandbox pod via the Kubernetes API**. There is no worker pool and no
headless Service.

Read the docs first — these files are the *assets*; the narrative lives at
[`deployment/kubernetes.md`](../../apps/docs/src/content/docs/deployment/kubernetes.md)
(published at <https://docs.testcabinet.ai/deployment/kubernetes/>). Everything
here uses **placeholder values** (`REPLACE_REGISTRY`, `REPLACE_OWNER`,
`REPLACE_ME`, the `tcab-prod` namespace); adapt them, don't apply them blind.

## Layout (kustomize base + overlays)

The flat manifests live in [`base/`](base/) — the shared **base**
([`base/kustomization.yaml`](base/kustomization.yaml)); apply an **overlay**, never
the base directly. `base/` is a sibling of `overlays/` (not a parent) so an overlay
can reference it as `../../base` without kustomize flagging an overlay→ancestor
cycle.

| File (under `base/`) | What it is |
| --- | --- |
| `kustomization.yaml` | The base: lists every resource below for the overlays to reference. |
| `namespace.yaml` | The per-environment namespace (`tcab-staging` / `tcab-prod`). |
| `rbac.yaml` | The `tcab-driver` SA/Role (pod create/get/list/delete + pods/exec get+create — the driver execs over a WebSocket, a GET to the exec subresource, so `get` is required, not just `create`, for the sandbox) and the `tcab-dispatcher` SA/Role (jobs create/get/list/watch/delete + pods/log, for the queue). |
| `secrets.example.yaml` | Secret templates (R2 creds, the shared service token, harness keys, registry pull secret) — **placeholders only**, not a base resource. |
| `backend.yaml` | Backend StatefulSet (1 replica) + PVC + ClusterIP Service. |
| `auth.yaml` | Auth-service StatefulSet (1 replica) + PVC + ClusterIP Service. |
| `dispatcher.yaml` | Dispatcher Deployment (1 replica) running under `tcab-dispatcher`; claims queued jobs and creates driver Jobs. No Service (binds no socket). |
| `artifacts.yaml` | Artifact-service StatefulSet (1 replica) + PVC + ClusterIP Service + its own SA (no API access). |
| `arena.yaml` | Arena-service Deployment (1 replica, **no PVC** — stateless) + ClusterIP Service (`:8791`) + its own SA (no API access); runs adversarial matches/tournaments off the backend, with real CPU requests/limits. |
| `ingest-cronjob.yaml` | Periodic `POST /ingest` to refresh the catalog. |
| `networkpolicy.yaml` | Optional default-deny-ingress + explicit allows (needs a NetworkPolicy-enforcing CNI). |

Overlays:

| Overlay | Purpose |
| --- | --- |
| `overlays/prod` | Production: the base + the image registry pinned. |
| `overlays/staging` | Staging: the same manifests, renamed to `tcab-staging` with `TCAB_ENV=staging`. |
| `overlays/azure-prod` | Prod on **managed PostgreSQL**: `overlays/prod` + the `postgres` component. Apply instead of `overlays/prod`. |
| `overlays/azure-staging` | Staging on **managed PostgreSQL**: `overlays/staging` + the `postgres` component. Apply instead of `overlays/staging`. |
| `overlays/local` | The k3d development mirror (driven by [`../local/Makefile`](../local/Makefile)). |

Overlays compose in reusable kustomize **components**:

| Component | Purpose |
| --- | --- |
| `components/observability` | Runs the Grafana LGTM stack (`grafana/otel-lgtm`: collector + Tempo/Mimir/Loki + Grafana) in-cluster as `tcab-lgtm` (StatefulSet + ClusterIP Service + PVC for Grafana state) plus a NetworkPolicy admitting the services' OTLP. Included by `overlays/{local,staging,prod,azure-staging,azure-prod}`; each overlay's env patch sets every workload's `OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318`. Drop it (and the endpoint) to send telemetry to Grafana Cloud / an external collector instead. |
| `components/postgres` | Converts the backend + auth service from their SQLite `StatefulSet` shape to stateless `Deployment`s (no PVC) wired to a managed database via Secret. Environment-agnostic — each overlay supplies its own namespace, `TCAB_ENV`, images, and connection-string Secret (Azure Database for PostgreSQL — Flexible Server in the `azure-*` overlays). |
| `components/web` | The in-cluster web console (`tcab-web`) `Deployment` + `ClusterIP` `Service` — the static SPA, with its backend/auth URLs injected at runtime into `/config.js` (each consumer patches the real values). Reused two ways: the `internal-ingress` component pulls it in behind a prod ingress, and `overlays/local` includes it directly and serves it over a `kubectl port-forward`. |

The service container images are built from [`../images/`](../images/)
(`backend.Dockerfile`, `auth.Dockerfile`, `dispatcher.Dockerfile`,
`driver.Dockerfile`, `artifacts.Dockerfile`, `arena.Dockerfile`, `web.Dockerfile`)
and published to
GHCR by the
[`build-service-images.yml`](../../.github/workflows/build-service-images.yml)
workflow as `ghcr.io/<owner>/tcab-backend`, `…/tcab-auth-service`,
`…/tcab-dispatcher`, `…/tcab-driver`, `…/tcab-artifacts`, `…/tcab-arena`, and `…/tcab-web`. The overlays' `images:`
blocks point each at that namespace — pin the immutable `:<git-sha>` tag rather
than `:latest` in a real deployment. The **run-container** images the sandbox runs
inside are separate — see [`containers/`](../../containers/README.md).

## Apply

Render and apply an overlay with kustomize (`kubectl -k`):

```sh
# Inspect what an overlay renders first.
kubectl kustomize deployments/k8s/overlays/prod    # or staging

# Create the real Secrets from your secret manager FIRST (see Secrets below), then:
kubectl apply -k deployments/k8s/overlays/prod      # or staging
```

> **Note:** the dispatcher's `TCAB_DRIVER_IMAGE` is an env *value*, not a container
> `image:` field, so kustomize's `images:` transformer cannot rewrite it; each
> overlay carries a `patch-dispatcher-driver-image.yaml` that sets it to match the
> driver image. Keep the two tags in lockstep.

## Per environment

Staging and prod are the same manifests; only the namespace, `TCAB_ENV`, and
secrets differ — `overlays/staging` rewrites them. Keep them otherwise identical so
staging rehearses prod. The dispatcher's `TCAB_K8S_*` sandbox settings are
documented in
[`deployment/kubernetes.md`](../../apps/docs/src/content/docs/deployment/kubernetes.md)
and the dispatcher's
[`config.rs`](../../crates/dispatcher/src/config.rs).

## Secrets

Never commit a real secret. `secrets.example.yaml` is a template; in a real
deployment create the Secrets from your secret manager (`kubectl create secret`,
External Secrets, Sealed Secrets, …). The key ones:

- **`tcab-backend-secrets`** + **`tcab-dispatcher-secrets`** must carry the **same**
  `TCAB_BACKEND_SERVICE_TOKEN` — the dispatcher authenticates its job claim with it,
  and the backend verifies it. Mismatched values mean the queue never drains.
- **`tcab-driver-secrets`** carries the harness provider API key(s); the dispatcher
  mounts it into each driver Job (via `TCAB_DISPATCHER_DRIVER_SECRETS`), and the run
  engine injects the key into the sandbox pod it creates.

For the **local** (k3d) overlay you do not create these by hand: the
[`../local/Makefile`](../local/Makefile) creates all three Secrets in-cluster from
your **environment** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY`
for the driver, a dev `SERVICE_TOKEN` for the other two), so no key is written to a
tracked file.

The repo-root `.env.backend.example`, `.env.auth.example`, and `.env.dispatcher.example`
remain the authoritative reference for every variable each service reads.
