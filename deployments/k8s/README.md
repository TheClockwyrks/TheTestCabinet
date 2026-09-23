# Kubernetes deployment manifests

Copy-pasteable manifests for deploying The Test Cabinet to a Kubernetes namespace,
where a run is a **per-run Kubernetes Job**: the **dispatcher** drains the
backend's run queue and creates one **driver** Job per run, and each driver spawns
a **separate sandbox pod via the Kubernetes API**. There is no worker pool and no
headless Service.

Read the docs first — these files are the _assets_; the narrative lives at
[`deployment/kubernetes/overview.md`](../../apps/docs/src/content/docs/deployment/kubernetes/overview.md)
(published at <https://docs.testcabinet.ai/deployment/kubernetes/overview/>). Everything
here uses **placeholder values** (`REPLACE_REGISTRY`, `REPLACE_OWNER`,
`REPLACE_ME`, the `tcab-prod` namespace); adapt them, don't apply them blind.

## Layout (kustomize base + overlays)

The flat manifests live in [`base/`](base/) — the shared **base**
([`base/kustomization.yaml`](base/kustomization.yaml)); apply an **overlay**, never
the base directly. Every object in the base and its components is namespaced; the
cluster-scoped objects live under [`cluster/`](cluster/) (see
[Cluster prerequisites](#cluster-prerequisites)). `base/` is a sibling of
`overlays/` (not a parent) so an overlay can reference it as `../../base` without
kustomize flagging an overlay→ancestor cycle.

| File (under `base/`)   | What it is                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kustomization.yaml`   | The base: lists every resource below for the overlays to reference.                                                                                                                                                                                                                                         |
| `rbac.yaml`            | The `tcab-driver` SA/Role (pod create/get/list/delete + pods/exec get+create — the driver execs over a WebSocket, a GET to the exec subresource, so `get` is required, not just `create`, for the sandbox) and the `tcab-dispatcher` SA/Role (jobs create/get/list/watch/delete + pods/log, for the queue). |
| `secrets.example.yaml` | Secret templates (R2 creds, the shared service token, harness keys, registry pull secret) — **placeholders only**, not a base resource.                                                                                                                                                                     |
| `backend.yaml`         | Backend StatefulSet (1 replica) + PVC + ClusterIP Service.                                                                                                                                                                                                                                                  |
| `auth.yaml`            | Auth-service StatefulSet (1 replica) + PVC + ClusterIP Service.                                                                                                                                                                                                                                             |
| `dispatcher.yaml`      | Dispatcher Deployment (1 replica) running under `tcab-dispatcher`; claims queued jobs and creates driver Jobs. No Service (binds no socket).                                                                                                                                                                |
| `artifacts.yaml`       | Artifact-service StatefulSet (1 replica) + PVC + ClusterIP Service + its own SA (no API access).                                                                                                                                                                                                            |
| `arena.yaml`           | Arena-service Deployment (1 replica, **no PVC** — stateless) + ClusterIP Service (`:8791`) + its own SA (no API access); runs adversarial matches/tournaments off the backend, with real CPU requests/limits.                                                                                               |
| `ingest-cronjob.yaml`  | Periodic `POST /ingest` to refresh the catalog.                                                                                                                                                                                                                                                             |
| `networkpolicy.yaml`   | Optional default-deny-ingress + explicit allows (needs a NetworkPolicy-enforcing CNI).                                                                                                                                                                                                                      |

Overlays:

| Overlay                  | Purpose                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `overlays/prod`          | Production: the base + `cluster/namespace` + `cluster/observability`, with placeholder image pins. Applied by hand.                                                            |
| `overlays/staging`       | Staging: the same manifests, renamed to `tcab-staging` with `TCAB_ENV=staging`. Applied by hand.                                                                               |
| `overlays/azure-prod`    | The production deployment on **managed PostgreSQL**, Key Vault and the internal ingress. Deployed by the Azure pipeline from `master`; namespaced objects only, no image tags. |
| `overlays/azure-staging` | The staging deployment, identical to `azure-prod` apart from its targets. Deployed by the Azure pipeline from `staging`; namespaced objects only, no image tags.               |
| `overlays/local`         | The k3d development mirror (driven by [`../local/Makefile`](../local/Makefile)), including `cluster/namespace` and `cluster/observability`.                                    |

The cluster-scoped objects:

| Kustomization              | Purpose                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cluster/namespace`        | The environment's `Namespace`, named by the including kustomization.                                                   |
| `cluster/observability`    | The `tcab-lgtm-node-metrics` `ClusterRole` + `ClusterRoleBinding` the LGTM stack's kubelet scrape needs.               |
| `cluster/internal-ingress` | The cert-manager `ClusterIssuer` `letsencrypt-internal` the internal ingress's certificates are issued by.             |
| `cluster/azure-staging`    | The three above for `tcab-staging`: the bootstrap a cluster administrator applies before the pipeline deploys staging. |
| `cluster/azure-prod`       | The same for `tcab-prod`.                                                                                              |

Overlays compose in reusable kustomize **components**:

| Component                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/observability` | Runs the Grafana LGTM stack (`grafana/otel-lgtm`: collector + Tempo/Mimir/Loki + Grafana) in-cluster as `tcab-lgtm` (StatefulSet + ClusterIP Service + PVC for Grafana state) plus a NetworkPolicy admitting the services' OTLP. Included by `overlays/{local,staging,prod,azure-staging,azure-prod}`; each overlay's env patch sets every workload's `OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318`. Grafana is `ClusterIP`-only — reach it via `kubectl port-forward svc/tcab-lgtm 3000:3000`, or, in `azure-prod`, at `grafana.tcab.testcabinet.ai` over the internal (VPN-only) ingress (the `internal-ingress` component's route + the overlay's `patch-grafana-auth.yaml`, which disables the image's anonymous-admin default and sets creds from the `tcab-grafana-admin` Secret). Drop it (and the endpoint) to send telemetry to Grafana Cloud / an external collector instead. |
| `components/postgres`      | Converts the backend + auth service from their SQLite `StatefulSet` shape to stateless `Deployment`s (no PVC) wired to a managed database via Secret. Environment-agnostic — each overlay supplies its own namespace, `TCAB_ENV`, images, and connection-string Secret (Azure Database for PostgreSQL — Flexible Server in the `azure-*` overlays).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `components/web`           | The in-cluster web console (`tcab-web`) `Deployment` + `ClusterIP` `Service` — the static SPA, with its backend/auth URLs injected at runtime into `/config.js` (each consumer patches the real values). Pulled in by the `internal-ingress` component behind a prod ingress. `overlays/local` deliberately does NOT include it — locally the console runs from source (`npm run -w apps/web dev`) against a `kubectl port-forward`ed backend, so a UI edit needs no image rebuild.                                                                                                                                                                                                                                                                                                                                                                                                           |

The service container images are built from [`../images/`](../images/) — every Rust
service is a `--target` of the shared `services.Dockerfile` (`backend`, `auth`,
`dispatcher`, `driver`, `artifacts`, `arena`, `publisher`), and the console has its
own `web.Dockerfile`. The Azure pipeline builds them, and the **run-container**
images the sandbox runs inside ([`containers/`](../../containers/README.md)), on
every push to `master` and `staging`, and pushes each to
`testcabinet.azurecr.io/<image>:<sha>` (`tcab-backend`, `tcab-auth-service`,
`tcab-dispatcher`, `tcab-driver`, `tcab-artifacts`, `tcab-arena`,
`tcab-publisher`, `tcab-web`, and the `test-cabinet-*` run images). The `azure-*`
overlays carry no image names or tags: the pipeline's
[`scripts/ci/deploy.sh`](../../scripts/ci/deploy.sh) sets every one of them to the
commit being deployed. The generic `prod` and `staging` overlays pin placeholder
registries in their `images:` blocks; pin an immutable `:<git-sha>` tag rather
than `:latest` there.

## Cluster prerequisites

The pipeline's deploy identity holds the custom "Test Cabinet AKS Command
Invoke" role ([`../azure/aks-command-invoke.role.json`](../azure/aks-command-invoke.role.json))
on each cluster and "Azure Kubernetes Service RBAC Admin" on its application
namespace only, so it cannot create a cluster-scoped object. A
cluster administrator bootstraps each environment by hand, once before the
pipeline's first deploy and again whenever anything under `cluster/` changes:

1. Helm-install ingress-nginx (internal LB) and cert-manager with its CRDs, with
   `clusterResourceNamespace` set to the environment's namespace, as
   [Internal ingress](../../apps/docs/src/content/docs/deployment/kubernetes/internal-ingress.md#prerequisites)
   describes.
2. Create the environment's secrets in its Key Vault (every object the
   `keyvault-csi` `SecretProviderClass` lists).
3. Apply the cluster-scoped objects:

   ```sh
   kubectl apply -k deployments/k8s/cluster/azure-staging   # or azure-prod
   ```

4. Create the custom role once
   (`az role definition create --role-definition @deployments/azure/aks-command-invoke.role.json`)
   and grant the deploy identity both roles: the custom role on the cluster,
   RBAC Admin on `<cluster resource id>/namespaces/tcab-<env>`.

The full procedure is in
[`deployment/kubernetes/overview.md`](../../apps/docs/src/content/docs/deployment/kubernetes/overview.md#cluster-prerequisites).
[`scripts/ci/k8s-manifests.sh`](../../scripts/ci/k8s-manifests.sh) gates every
commit on the split: the `azure-*` overlays render namespaced objects only, and
`cluster/azure-*` holds cluster-scoped objects only.

## Apply

The `azure-staging` and `azure-prod` overlays are deployed by the Azure pipeline:
a push to `staging` or `master` runs `scripts/ci/deploy.sh`, which renders the
overlay at the commit's images and applies it and waits for every rollout inside
the private cluster through `az aks command invoke`. Preview what it
applies with:

```sh
scripts/ci/deploy.sh --render prod <sha>   # or staging
```

Render and apply any other overlay with kustomize (`kubectl -k`):

```sh
# Inspect what an overlay renders first.
kubectl kustomize deployments/k8s/overlays/prod    # or staging

# Create the real Secrets from your secret manager FIRST (see Secrets below), then:
kubectl apply -k deployments/k8s/overlays/prod      # or staging
```

> **Note:** in the generic `prod` and `staging` overlays the dispatcher's
> `TCAB_DRIVER_IMAGE` is an env _value_, not a container `image:` field, so
> kustomize's `images:` transformer cannot rewrite it; those overlays carry a
> `patch-dispatcher-driver-image.yaml` that sets it to match the driver image.
> Keep the two tags in lockstep.

## Per environment

Staging and prod are the same manifests; only the namespace, `TCAB_ENV`, and
secrets differ — `overlays/staging` and `overlays/azure-staging` rewrite them.
Keep them otherwise identical so staging rehearses prod. The dispatcher's
`TCAB_K8S_*` sandbox settings are documented in
[`deployment/kubernetes/run-plane.md`](../../apps/docs/src/content/docs/deployment/kubernetes/run-plane.md)
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
