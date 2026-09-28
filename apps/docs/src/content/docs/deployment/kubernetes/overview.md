---
title: Overview
---

These pages build a staging and a production environment for the backend, the
auth service, the dispatcher, the artifact service, and the arena on a Kubernetes
cluster. Read the [Deployment overview](/deployment/overview/) first for the
shape of the system: a console enqueues a run at the backend, the dispatcher
claims it and creates a per-run `Job` running the driver, and that driver creates
one ephemeral sandbox pod for the run.

The design is provider-agnostic. The backend, auth, and artifact services are
each a single-replica `StatefulSet` with a volume, the dispatcher is a stateless
one-replica `Deployment` with RBAC to manage `Job`s, and a run is a short-lived
`Job` whose driver creates one sandbox pod. Any conformant cluster, managed or
self-hosted, works the same way.

The manifests are a kustomize base under `deployments/k8s/base/`, reusable
components under `deployments/k8s/components/`, one overlay per environment under
`deployments/k8s/overlays/`, and the cluster-scoped objects under
`deployments/k8s/cluster/`. They carry placeholder values and are starting points
to adapt.

## Topology

```
          OpenVPN client (operator machine)  ──▶  resolves *.tcab.testcabinet.ai
                 │                                via private DNS → internal LB IP
                 ▼
   ingress-nginx (internal LB, private VNet IP, VPN-only)   TLS: cert-manager (LE)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  console.* → tcab-web         api.* → tcab-backend:8787                  │
   │  auth.* → tcab-auth:8789      artifacts.* → tcab-artifacts:8790          │
   │  arena.* → tcab-arena:8791    grafana.* → tcab-lgtm:3000 (auth-locked)   │
   └──────────────────────────────────────┬───────────────────────────────────┘
                                          │ (NetworkPolicy admits ingress-nginx ns)
   Kubernetes namespace: tcab-prod
   ┌──────────────────────────────────────▼─────────────────────────────────────┐
   │                                                                            │
   │   tcab-web (Deployment, 1)              tcab-dispatcher (Deployment, 1)    │
   │   ┌────────────────────┐  ClusterIP     ┌──────────────────────┐  no Svc   │
   │   │ static console SPA │                │ claims a queued run, │           │
   │   │ (runtime cfg → API)│                │ creates ONE Job/run  │           │
   │   └────────────────────┘                └──────────┬───────────┘           │
   │                                                    │ creates Job (K8s API) │
   │   tcab-backend (StatefulSet, 1)                    ▼                       │
   │   ┌────────────────────┐  ClusterIP     ┌──────────────────────┐           │
   │   │ tcab-backend       │◀── enqueue ────│ tcab-driver Job      │ one per   │
   │   │ + PVC (state)      │── claim ──────▶│ (per-run, then GC'd) │  run      │
   │   │ + run queue        │                │ creates / exec /     │           │
   │   │ + headless browser │                │ deletes ▼ (K8s API)  │           │
   │   └─────────┬──────────┘                │  ┌────────────────┐  │           │
   │   tcab-auth (StatefulSet, 1)            │  │  sandbox pod   │  │ untrusted │
   │   ┌────────────────────┐  ClusterIP     │  │  (ephemeral)   │  │           │
   │   │ tcab-auth + PVC    │◀───────────────│  └────────────────┘  │           │
   │   └────────────────────┘                └──────────────────────┘           │
   │   tcab-artifacts (StatefulSet, 1)        tcab-arena (Deployment, 1)        │
   │   ┌────────────────────┐  ClusterIP      ┌────────────────────┐  ClusterIP │
   │   │ tcab-artifacts     │◀── upload ──────│ tcab-arena (wasm)  │            │
   │   │ + PVC (artifacts)  │                 └────────────────────┘            │
   │   └─────────┬──────────┘                                                   │
   └─────────────┼──────────────────────────────────────────────────────────────┘
                 │ outbound only (backend)
                 ▼
        Cloudflare R2 (snapshot) + Pages deploy hook  ──▶  public gallery
```

One environment is one namespace, `tcab-staging` or `tcab-prod`, so the two are
isolated and tearing one down is `kubectl delete namespace`. Build staging first,
confirm the flow, then repeat for prod with prod's own secrets and a
`TCAB_ENV=prod` tag.

The backend's only outbound traffic is the snapshot upload to Cloudflare R2 and
the deploy-hook call that rebuilds the
[public gallery](/components/site/overview/). Because the sandbox pod's disk is
ephemeral, the driver uploads the produced run tree to the artifact service
before reporting terminal status, and the console reads those artifacts from
there.

## Prerequisites

- A Kubernetes cluster and `kubectl` configured to reach it. The run model needs
  no privileged pods, no Docker socket, and no special node pool.
- A container registry the cluster can pull the service images and the
  run-container images from. The Azure pipeline builds every one of them for
  `linux/amd64` and `linux/arm64` on each push to `master` and `staging` and
  pushes them to `testcabinet.azurecr.io` tagged by the commit sha. Each
  cluster's kubelet identity holds `AcrPull` on that registry, so the `staging`
  and `prod` overlays need no pull secret. A deployment pulling from a private registry
  without such a grant creates an `imagePullSecret` and names it in
  `TCAB_K8S_IMAGE_PULL_SECRETS`.
- A `StorageClass` for the backend, auth, and artifact `PersistentVolumeClaim`s.
  `ReadWriteOnce` is sufficient; none of the volumes is shared.
- The publisher's credentials, if the deployment will publish runs: a GitHub
  token and a Cloudflare API token, plus the backend's R2 credentials and site
  deploy-hook URL.

### Pinning images

Every image a deployment runs is pinned to one commit sha. The service images
are Kubernetes `image:` fields. The driver and publisher images are the
dispatcher's `TCAB_DRIVER_IMAGE` and `TCAB_PUBLISHER_IMAGE`, and the
run-container images are resolved by the driver at run time from
`TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG`, which the dispatcher forwards
into every driver `Job`.

The `staging` and `prod` overlays name every Test Cabinet image at
`testcabinet.azurecr.io/<image>:unpinned`, a tag nothing pushes, so an overlay
applied as it stands fails to pull rather than running whatever a moving tag
last named. The backend's repository there is `the-test-cabinet-backend`, the
image the pipeline's publish retags from `tcab-backend`. Before anything applies
an overlay, `scripts/ci/pin-images.sh <overlay> <sha>` rewrites every tag to the
commit being deployed and adds the dispatcher's `TCAB_DRIVER_IMAGE`,
`TCAB_PUBLISHER_IMAGE`, `TCAB_CONTAINER_REGISTRY=testcabinet.azurecr.io` and
`TCAB_CONTAINER_TAG=<sha>` (see [Deploying](#deploying)), so the service images,
the driver, and the run images it stages
[audio packs](/components/core/execution/#staged-audio) into always come from
the same build. It fails when an `unpinned` image survives the pin. The run
images need no registry setting, because the driver's default registry is
`testcabinet.azurecr.io`.

## Cluster prerequisites

The deploy identity may write only the environment's namespace, so the objects
outside it are a one-time cluster bootstrap that a cluster administrator applies
by hand. `deployments/k8s/cluster/azure-staging` and
`deployments/k8s/cluster/azure-prod` hold them: the
environment's `Namespace`, the observability stack's `ClusterRole` and
`ClusterRoleBinding` `tcab-lgtm-node-metrics`, and the cert-manager
`ClusterIssuer` `letsencrypt-internal`. Before the pipeline's first deploy to an
environment:

1. Install ingress-nginx and cert-manager with its CRDs through Helm, with
   cert-manager's `clusterResourceNamespace` set to the environment's namespace.
   [Internal ingress](/deployment/kubernetes/internal-ingress/#prerequisites)
   has the values, the private DNS zone, and the order.
2. Create the environment's secrets in its Key Vault: every secret the
   `components/keyvault-csi` `SecretProviderClass` lists, including the
   Cloudflare DNS-01 token and the Grafana admin credentials.
3. Apply the cluster-scoped objects:

   ```sh
   kubectl apply -k deployments/k8s/cluster/azure-prod   # or cluster/azure-staging
   ```

   The API servers are private, so run this over the VPN, or inside the cluster
   through `az aks command invoke` from `deployments/k8s`:

   ```sh
   cd deployments/k8s
   az aks command invoke -g testcabinet-prod-westus2-rg \
     -n testcabinet-prod-westus2-aks --file . \
     --command "kubectl apply -k cluster/azure-prod"
   ```

4. Grant the pipeline's deploy identity its two roles, scoped as described in
   [The deploy identity](#the-deploy-identity). The custom role is defined once
   for both clusters:

   ```sh
   az role definition create \
     --role-definition @deployments/azure/aks-command-invoke.role.json
   AKS_ID=$(az aks show -g testcabinet-prod-westus2-rg \
     -n testcabinet-prod-westus2-aks --query id -o tsv)
   az role assignment create --assignee <deploy-principal-id> \
     --role "Test Cabinet AKS Command Invoke" --scope "$AKS_ID"
   az role assignment create --assignee <deploy-principal-id> \
     --role "Azure Kubernetes Service RBAC Admin" --scope "$AKS_ID/namespaces/tcab-prod"
   ```

Re-apply step 3 whenever anything under `deployments/k8s/cluster/` changes. The
pipeline refuses to deploy an overlay that renders a cluster-scoped object, so a
change that needs one lands in `deployments/k8s/cluster/` and is applied here.

## Deploying

The [Azure pipeline](/development/building/#continuous-integration) deploys the
`staging` and `prod` overlays, once the gates have passed and the commit's
images are in the registry. A push to `staging` rolls `tcab-staging` on
`testcabinet-staging-westus2-aks`, and a push to `master` rolls `tcab-prod` on
`testcabinet-prod-westus2-aks`. The pipeline environments `tcab-staging` and
`tcab-prod` have no approval check. The two take different routes.

**Staging** is the workspace template's own deploy stage, which rolls one
overlay onto one published commit, and the project's `before` and `after` steps
around it (`.azure/project/deploy-steps.yml`):

1. before: `scripts/ci/pre-deploy.sh staging <sha>` pins the overlay with
   `pin-images.sh`, records the commit the backend runs now as
   `TCAB_PREVIOUS_COMMIT`, sets a 600-second rollout timeout, and retires the
   legacy `tcab-backend` Deployment (see below);
2. the template's `scripts/ci/deploy.sh <sha>` renders the overlay with the
   backend's image set to `the-test-cabinet-backend:<sha>`, applies it inside the
   cluster, and waits on `deployment/the-test-cabinet-backend`, undoing it if it
   does not become ready;
3. it then runs the project's `scripts/ci/post-deploy.sh <sha>`, which runs
   `scripts/ci/settle-workloads.sh`: one wait, concurrently, on every other
   `Deployment` and `StatefulSet` in the namespace, each bounded by the rollout
   timeout, undoing each that does not become ready, describing its pods and
   printing recent events, and failing if any did;
4. after, on failure only: `scripts/ci/settle-workloads.sh --after-failure <sha>`
   settles and diagnoses whatever the failed apply rolled, and prints the
   backend's recovery command,
   `scripts/ci/deploy-environment.sh staging <previous sha>`, or "fix forward"
   when there is no previous commit.

**Prod** is the project's `prod` stage on `master`. It publishes the same
backend retag through the template's `.azure/publish-image.yml`, then runs
`scripts/ci/deploy-environment.sh prod <sha>`, which:

1. copies `deployments/k8s` to a temporary directory and pins the `prod` overlay
   there with `pin-images.sh`;
2. renders it with `kubectl kustomize` on the agent into one manifest file, and
   refuses the file if it holds anything outside the environment's namespace;
3. retires the legacy `tcab-backend` Deployment;
4. runs `kubectl apply -f` on the file inside the cluster through
   `az aks command invoke`, which uploads the file with the command;
5. waits up to 600 seconds, concurrently, on every `Deployment` and
   `StatefulSet` rollout, the backend's included. A rollout that does not become
   ready is described, its logs are printed, and it is undone, and the deploy
   fails.

The clusters' API servers are private, which is why every `kubectl` command runs
inside the cluster. `az aks command invoke` runs it under the caller's Microsoft
Entra identity, so the cluster's Azure RBAC decides what it may do.
`scripts/ci/deploy-environment.sh --render <staging|prod> <sha>` prints the
manifest file without touching a cluster or the checkout, and the
`k8s-deploy-sets` gate checks the same bytes for both overlays on every commit
that touches `deployments/k8s/` or the deploy scripts.

The backend's Deployment is `the-test-cabinet-backend`, the name the template's
deploy waits on; it was `tcab-backend`. Its Service, ServiceAccount, Secret and
PersistentVolumeClaim keep their `tcab-backend` names, so every other workload
reaches it unchanged. The old Deployment holds the `ReadWriteOnce` claim
`tcab-backend-state`, so every deploy first deletes it if it still exists
(`scripts/ci/retire-legacy-backend.sh`, a no-op once it is gone). The first
deploy of each environment after the rename therefore has a brief backend outage
while the claim re-attaches, and no earlier backend revision to undo to.

Every deploy changes the backend's image tag, so every deploy restarts
the backend pod, and its ingest sidecar force-ingests the branch tip it shipped
with (see [Ingesting definitions](/deployment/kubernetes/control-plane/#ingesting-definitions)).

Run by hand, signed in to Azure with the same roles,
`scripts/ci/deploy-environment.sh <staging|prod> <sha>` rolls an environment to
any sha whose images the registry holds. That is how an earlier commit is put
back; reverting the change on the branch and letting the pipeline deploy the
revert is the other route. The backend image is `the-test-cabinet-backend:<sha>`,
which the pipeline has pushed only since the move onto the project template. A
sha from before it has no such image, so its backend cannot be pulled
(`ImagePullBackOff`) and the deploy undoes the rollout; put such a commit back
by reverting on the branch instead.

### The deploy identity

The deploy runs under the `tcab-deploy` Azure Resource Manager service
connection, a workload-identity-federated identity with no stored secret. It
holds two roles on each cluster and nothing else:

| Plane   | Role                                     | Scope                                         |
| ------- | ---------------------------------------- | --------------------------------------------- |
| Control | Test Cabinet AKS Command Invoke (custom) | the cluster resource                          |
| Data    | Azure Kubernetes Service RBAC Admin      | `<cluster resource id>/namespaces/tcab-<env>` |

The custom role is defined in `deployments/azure/aks-command-invoke.role.json`
with three actions, `Microsoft.ContainerService/managedClusters/read`,
`managedClusters/runCommand/action`, and `managedClusters/commandResults/read`,
and is assignable to the two clusters only. It lets the identity run a command
inside the cluster and read its result, and nothing else on the cluster
resource. No built-in role grants `runCommand` alone: the ones that carry it are
Azure Kubernetes Service Cluster Admin Role, which also lists the cluster's admin
credentials, and the Contributor roles.

RBAC Admin at namespace scope decides what those commands may do: create,
change, and delete every namespaced object in the application namespace, and
nothing outside it. The pipeline therefore applies namespaced objects only:
the overlays render nothing cluster-scoped, `deploy-environment.sh` checks each
render before applying it, and the `k8s-manifests` and `k8s-deploy-sets` gates
hold every commit to the same check. A compromised pipeline can at worst rewrite
its own environment's namespace.

## Applying an overlay by hand

An overlay outside the pipeline is applied by hand. Create the environment's
secrets first, from your secret manager, then apply an overlay. Apply the
overlay, never the individual base files. The `staging` and `prod` overlays name
their images at `unpinned`, so render them pinned rather than applying them as
they stand:

```sh
scripts/ci/deploy-environment.sh --render prod <sha>   # preview, no cluster needed
scripts/ci/deploy-environment.sh prod <sha>            # pin, apply, and wait
```

The base lists the RBAC, backend, auth, dispatcher, artifacts, arena, ingest
`CronJob`, and `NetworkPolicy` resources, all namespaced. An overlay sets the
namespace and `TCAB_ENV`, patches in the environment's secret references, and
layers on the components it needs. The `local` overlay also includes
`deployments/k8s/cluster/namespace` and `deployments/k8s/cluster/observability`,
so one apply creates its `Namespace` and node-metrics grant; the remote
overlays render only namespaced objects, and their cluster-scoped objects are
the bootstrap above.

| Component                      | What it adds                                                             |
| ------------------------------ | ------------------------------------------------------------------------ |
| `components/postgres`          | Backend and auth as stateless `Deployment`s on managed PostgreSQL        |
| `components/postgres-azure-ad` | Passwordless Microsoft Entra database auth for those two `Deployment`s   |
| `components/observability`     | The in-cluster Grafana LGTM stack                                        |
| `components/keyvault-csi`      | Materializes the environment's Kubernetes `Secret`s from Azure Key Vault |
| `components/web`               | The in-cluster `tcab-web` console workload                               |
| `components/internal-ingress`  | The console plus the service hostnames over a VPN-only ingress           |

The base alone runs the SQLite shape, as the `local` overlay does. The `staging`
and `prod` overlays run the same base with the PostgreSQL, Key Vault,
observability, and internal-ingress components layered on.

## NetworkPolicy

The namespace `NetworkPolicy` set applies default-deny ingress plus a small list
of allowed flows. It takes effect on a `NetworkPolicy`-enforcing CNI such as
Calico or Cilium. Pods carry selectable labels: driver `Job` pods are labelled
`app.kubernetes.io/managed-by: tcab-dispatcher`, and sandbox pods
`app.kubernetes.io/managed-by: tcab-driver`.

The allowed flows are:

- dispatcher and driver pods to the backend and auth service, for claiming runs
  and reporting status;
- the backend to the auth service, for verifying every bearer token;
- driver pods to the artifact service, for uploading the produced run tree;
- the backend to the artifact service, for pruning a deleted run's tree and
  sweeping the trees no run row references;
- sandbox pods to their driver pod, for streaming live preview frames;
- the artifact service to the backend, for verifying a driver's upload token;
- the arena to the backend, for fetching controller inputs and persisting
  tournaments;
- the console to the arena, for running matches and tournaments.

The `components/internal-ingress` component adds three further exceptions,
selecting the controller by its namespace's `kubernetes.io/metadata.name:
ingress-nginx` label: ingress-nginx to the backend, auth, artifacts, and arena on
their service ports, ingress-nginx to `tcab-web` on `8080`, and ingress-nginx to
`tcab-lgtm` on `3000`. These are additive; the base policies stay intact.

Sandbox pods need no inbound access beyond the driver's `exec` and preview
connections, which Kubernetes routes over the API server and the pod network.
Their egress is the model APIs and package registries a run needs.

## Memory ceilings

Memory is sized by two opposite rules, chosen by what a kill costs.

The pods a run needs, the driver and its sandbox, carry a memory **request and no
limit**. A memory limit is a cgroup ceiling the kernel enforces by `SIGKILL`, and a
run pod that reaches it is dead that instant, however much memory the node still
has free, destroying a run that may have been spending money on API calls for
hours. The request is the node's reservation, and it must cover the real peak of
the heaviest case, because a run pod that outgrows it on a full node is still the
first thing evicted; it is sized in
[Run plane](/deployment/kubernetes/run-plane/#sizing-sandbox-pods). The publisher
`Job` keeps a limit, because a failed publish loses no spend and is retried.

Every always-on service carries a memory limit **equal to its request**. For a
service a kill is a restart, not lost spend, and a bounded service can never be
what crowds a run pod off its node: the sum of the services' limits on a node is
knowable, so a run pod that grows past its request is contending only with
headroom the scheduler left, never with another tenant's unbounded growth.

| Container                       | Ceiling  | Why                                                                                                                              |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `backend`                       | `2Gi`    | around 2.4x the anonymous memory plus slab a snapshot refresh reaches, which materializes every run record at once               |
| `lgtm`                          | `4Gi`    | a collector, three TSDBs and Grafana under bursty load, since validating a test case drives far more telemetry than a quiet week |
| `artifacts`                     | `1536Mi` | its resident set, since a whole-tree download is written to the response as it is built rather than assembled in memory          |
| `ingest` sidecar                | `256Mi`  | around 3x its peak, and it runs a git checkout whose cost grows with the catalog                                                 |
| `arena`                         | `512Mi`  | sized for concurrent wasm matches rather than for an idle week                                                                   |
| `auth`, `dispatcher`, `web`     | `256Mi`  | around 32x their peaks, and the headroom costs a node almost nothing                                                             |
| `publisher` (per publish `Job`) | `1Gi`    | several times the largest run tree it pulls from the artifact service                                                            |

CPU is treated differently. A container over its CPU limit is throttled rather
than killed, so the failure mode is latency instead of a lost pod, and CPU limits
are set loosely as a runaway backstop or left off entirely.

Size a ceiling against anonymous memory plus slab rather than against a peak. A
cgroup's high-water mark counts page cache, which cgroup v2 reclaims under limit
pressure, so a peak overstates the figure that actually decides a kill. Read the
numbers from the environment being sized, since prod and staging differ by orders
of magnitude:

```sh
kubectl -n <ns> exec <pod> -c <container> -- \
  sh -c 'cat /sys/fs/cgroup/memory.peak; grep -E "^(anon|file|slab) " /sys/fs/cgroup/memory.stat'
```

## Per-environment differences

Staging and prod apply the same base manifests, so staging rehearses prod. Only
these differ:

|               | Staging                           | Prod                           |
| ------------- | --------------------------------- | ------------------------------ |
| Deployed from | the `staging` branch              | the `master` branch            |
| Cluster       | `testcabinet-staging-westus2-aks` | `testcabinet-prod-westus2-aks` |
| Namespace     | `tcab-staging`                    | `tcab-prod`                    |
| `TCAB_ENV`    | `staging`                         | `prod`                         |
| Secrets       | staging keys and tokens           | prod keys and tokens           |
| Hostnames     | `*.staging.tcab.testcabinet.ai`   | `*.tcab.testcabinet.ai`        |

Use separate Cloudflare R2 buckets and deploy hooks per environment to keep
staging publishes out of the prod gallery dataset; point each backend's
`TCAB_R2_*` and `TCAB_SITE_DEPLOY_HOOK_URL` at the right one.

## Next steps

- [Control plane](/deployment/kubernetes/control-plane/): the backend, its
  catalog ingest, and the auth service.
- [Run plane](/deployment/kubernetes/run-plane/): RBAC, the dispatcher, per-run
  driver `Job`s, publish `Job`s, and the artifact and arena services.
- [PostgreSQL](/deployment/kubernetes/postgres/): the managed-database shape and
  passwordless Entra auth.
- [Internal ingress](/deployment/kubernetes/internal-ingress/): the VPN-only
  console and service hostnames.
- [Backups](/deployment/backups/) and [Telemetry](/deployment/telemetry/): the
  two cross-cutting operational concerns.
