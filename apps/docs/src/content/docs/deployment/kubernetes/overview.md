---
title: Overview
---

These pages build a staging and a production environment for the backend, the
dispatcher, the artifacts and repos services, the arena, the console and the
edge on a Kubernetes cluster. Read the
[Deployment overview](/deployment/overview/) first for the shape of the system:
a console enqueues a run at the backend, the dispatcher claims it and creates a
per-run `Job` running the driver, and that driver creates one ephemeral sandbox
pod for the run.

The design is provider-agnostic apart from its object stores. The backend is a
two-replica `Deployment` on a managed PostgreSQL instance, the dispatcher is a
stateless one-replica `Deployment` with RBAC to manage `Job`s, the artifacts and
repos services are stateless `Deployment`s over Azure Blob containers, and a
run is a short-lived `Job` whose driver creates one sandbox pod. Any conformant
cluster, managed or self-hosted, works the same way.

The manifests are a kustomize base under `deployments/k8s/base/`, reusable
components under `deployments/k8s/components/`, one overlay per environment under
`deployments/k8s/overlays/`, and the cluster-scoped objects under
`deployments/k8s/cluster/`. They carry placeholder values and are starting points
to adapt.

## Topology

```text
   browser / operator client / tcab
        │  https://console.testcabinet.ai  (+ grafana.testcabinet.ai)
        ▼
   Cloudflare edge: TLS, WAF, Access (Entra ID sign-in, Cf-Access-Jwt-Assertion)
        │  Cloudflare Tunnel, held open from inside the namespace
   Kubernetes namespace: tcab-prod
   ┌────┼─────────────────────────────────────────────────────────────────────────┐
   │    ▼                                                                         │
   │  tcab-cloudflared (Deployment, 2)   routes by path:                          │
   │    /            → tcab-web:8080         /api/   → tcab-backend:8787          │
   │    /artifacts/  → tcab-artifacts:8790   /arena/ → tcab-arena:8791            │
   │    grafana.*    → tcab-lgtm:3000                                             │
   │                                                                              │
   │  tcab-backend (Deployment, 2)  ◀── claim ──  tcab-dispatcher (Deployment, 1) │
   │   queue, records, scoring,                    creates one Job per run        │
   │   ingest sidecar, + PostgreSQL                and one per publish (K8s API)  │
   │      │ public writes                              │                          │
   │      ▼                                            ▼                          │
   │  tcab-artifacts (Deployment, 2) ◀─ run tree ─  tcab-driver Job               │
   │   run trees → Blob, public → R2                   │ bundle   │ exec          │
   │  tcab-repos (Deployment, 2)   ◀───────────────────┘          ▼               │
   │   bundles → Blob, publish → GitHub  ◀── publish ──     sandbox pod           │
   │                                     tcab-publisher Job  (ephemeral,          │
   │  tcab-arena (Deployment, 1)         (Pages deploy)       untrusted)          │
   └──────────────────────────────────────────────────────────────────────────────┘
          outbound only: Azure Blob, Cloudflare R2, GitHub, Cloudflare Pages
```

One environment is one namespace, `tcab-staging` or `tcab-prod`, so the two are
isolated and tearing one down is `kubectl delete namespace`. Build staging first,
confirm the flow, then repeat for prod with prod's own secrets and a
`TCAB_ENV=prod` tag.

Nothing in the namespace accepts an inbound connection from outside the
cluster. The tunnel is outbound, the artifacts service's writes to Blob and R2
are outbound, the repos service's pushes to GitHub are outbound, and the
publisher's Pages deploys are outbound. Because the sandbox pod's disk is
ephemeral, the driver uploads the produced run tree and the implementation's
bundle before reporting terminal status. The console reads the tree from the
artifacts service through the edge, and the bundle through the backend, which
fetches it from the repos service.

## Prerequisites

- A Kubernetes cluster and `kubectl` configured to reach it. The run model needs
  no privileged pods, no Docker socket, and no special node pool.
- A container registry the cluster can pull the service images and the
  run-container images from. Each `microservice-*` repository's pipeline builds
  its image for `linux/amd64` and `linux/arm64` on each gated push to `master`
  and `staging` and pushes it to `testcabinet.azurecr.io` as `<name>:<commit>`,
  and `microservice-driver`'s builds the run-container images beside it. Each
  cluster's kubelet identity holds `AcrPull` on that registry, so the `staging`
  and `prod` overlays need no pull secret. A deployment pulling from a private registry
  without such a grant creates an `imagePullSecret` and names it in
  `TCAB_K8S_IMAGE_PULL_SECRETS`.
- A `StorageClass` for the observability stack's volumes, and in the SQLite
  shape for the backend's `PersistentVolumeClaim`. `ReadWriteOnce` is
  sufficient.
- An Azure storage account with the environment's two private Blob containers,
  one for the artifacts service's run trees and one for the repos service's
  bundles, and a user-assigned managed identity per service holding Storage
  Blob Data Contributor on its container, federated to the service's
  `ServiceAccount` as [PostgreSQL](/deployment/kubernetes/postgres/) federates
  the backend's.
- The Cloudflare side of the [edge](/deployment/kubernetes/edge/): the tunnel,
  the hostnames, the Access applications and the service token.
- The publisher's Cloudflare API token and the repos service's GitHub token,
  if the deployment will publish runs, plus the artifacts service's R2
  credentials for the public dataset.

### Pinning images

Every image a deployment runs is pinned to one commit of its repository: the
commit the superrepo's submodule pointer for that repository names, which the
repository's pipeline pushed as `<name>:<commit>`. The service images are
Kubernetes `image:` fields. The driver and publisher images are the
dispatcher's `TCAB_DRIVER_IMAGE` and `TCAB_PUBLISHER_IMAGE`, and the
run-container images are resolved by the driver at run time from
`TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG`, which the dispatcher forwards
into every driver `Job`; `microservice-driver`'s pipeline builds the run images
beside the driver's, so their tag is the driver's commit. The `cloudflared`
image is third-party and pinned to its own version in the edge component.

The `staging` and `prod` overlays name every Test Cabinet image at
`testcabinet.azurecr.io/<image>:unpinned`, a tag nothing pushes, so an overlay
applied as it stands fails to pull rather than running whatever a moving tag
last named. Before anything applies an overlay, `scripts/ci/pin-images.sh
<overlay>` rewrites every tag to the commit the submodule pointer for its
repository names and adds the dispatcher's `TCAB_DRIVER_IMAGE`,
`TCAB_PUBLISHER_IMAGE`, `TCAB_CONTAINER_REGISTRY=testcabinet.azurecr.io` and
`TCAB_CONTAINER_TAG=<driver commit>` (see [Deploying](#deploying)), so the
driver and the run images it stages
[audio packs](/components/driver/execution/#staged-audio) into always come from
one `microservice-driver` commit. It fails when an `unpinned` image survives
the pin. The run images need no registry setting, because the driver's default
registry is `testcabinet.azurecr.io`.

## Cluster prerequisites

The deploy identity may write only the environment's namespace, so the objects
outside it are a one-time cluster bootstrap that a cluster administrator applies
by hand. `deployments/k8s/cluster/azure-staging` and
`deployments/k8s/cluster/azure-prod` hold them: the environment's `Namespace`
and the observability stack's `ClusterRole` and `ClusterRoleBinding`
`tcab-lgtm-node-metrics`. Before the pipeline's first deploy to an environment:

1. Create the environment's secrets in its Key Vault: every secret the
   `components/keyvault-csi` `SecretProviderClass` lists, including the tunnel
   credentials and the Grafana admin credentials. The vault has an IP firewall,
   so run `az keyvault secret set` from an allow-listed host or add your IP
   with `az keyvault network-rule add`. With a listed secret missing the
   mounter fails the whole mount and the workloads that read it stay in
   `CreateContainerConfigError`, which is deliberately fail-closed.
2. Apply the cluster-scoped objects:

   ```sh
   kubectl apply -k deployments/k8s/cluster/azure-prod   # or cluster/azure-staging
   ```

   The API servers are private, so run this inside the cluster through
   `az aks command invoke` from `deployments/k8s`:

   ```sh
   cd deployments/k8s
   az aks command invoke -g testcabinet-prod-westus2-rg \
     -n testcabinet-prod-westus2-aks --file . \
     --command "kubectl apply -k cluster/azure-prod"
   ```

3. Grant the pipeline's deploy identity its two roles, scoped as described in
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

4. Grant the same identity its two roles on the registry. `<deploy-principal-id>`
   is again the service principal's object id or application id, which
   `--assignee` resolves; see [The deploy identity](#the-deploy-identity) for
   why `--assignee-object-id` must never be given the application id:

   ```sh
   ACR_ID=$(az acr show --name testcabinet --query id -o tsv)
   az role assignment create --assignee <deploy-principal-id> \
     --role AcrPush --scope "$ACR_ID"
   az role assignment create --assignee <deploy-principal-id> \
     --role AcrDelete --scope "$ACR_ID"
   ```

5. Apply the node pools' upgrade settings, which hold a drain until the run
   pods on a node have finished (see
   [Node drains](/deployment/kubernetes/run-plane/#node-drains)):

   ```sh
   scripts/configure-node-pools.sh --env prod   # or --env staging
   ```

   The script sets `drainTimeoutInMinutes`, `undrainableNodeBehavior`,
   `maxSurge` and `maxUnavailable` on every user node pool with
   `az aks nodepool update`, and is safe to re-run. A node pool added later is
   configured by running it again.

Re-apply step 2 whenever anything under `deployments/k8s/cluster/` changes. The
pipeline refuses to deploy an overlay that renders a cluster-scoped object, so a
change that needs one lands in `deployments/k8s/cluster/` and is applied here.

Secret auto-rotation on the AKS `azure-keyvault-secrets-provider` add-on makes
the driver poll Key Vault and reconcile a changed value into the synced Secrets
on its own, so a refreshed credential reaches the cluster without a restart.
Enable it once per cluster with
`scripts/enable-secret-rotation.sh --env <prod|staging>`, which is add-on
configuration rather than a Kubernetes object. Adding a brand-new key to a
Secret still needs
`kubectl delete secret <name> && kubectl rollout restart deploy/tcab-keyvault-sync`.

Keep each cluster on a supported Kubernetes version. An upgrade AKS initiates
for an unsupported version overrides every `PodDisruptionBudget`, the run pod
budget included.

## Deploying

The [Azure pipeline](/development/building/#continuous-integration) deploys the
`staging` and `prod` overlays once the gates have passed, onto the deploy set
the commit's submodule pointers name. A push to `staging` rolls `tcab-staging` on
`testcabinet-staging-westus2-aks`, and a push to `master` rolls `tcab-prod` on
`testcabinet-prod-westus2-aks`. The pipeline environments `tcab-staging` and
`tcab-prod` have no approval check. The two take different routes.

**Staging** is the workspace template's own `deploy` stage, which rolls one
overlay onto one commit's set, and the project's `before` and `after` steps
around it (`.azure/project/deploy-steps.yml`):

1. before: `scripts/ci/pre-deploy.sh staging <sha>` pins the overlay with
   `pin-images.sh` from the commit's submodule pointers, records the commit the
   backend runs now as `TCAB_PREVIOUS_COMMIT`, and sets a 600-second rollout
   timeout;
2. the template's `scripts/ci/deploy.sh <sha>` renders the pinned overlay,
   applies it inside the cluster, and waits on
   `deployment/the-test-cabinet-backend`, undoing it if it does not become
   ready;
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

**Prod** is the project's `prod` stage on `master`. It runs
`scripts/ci/deploy-environment.sh prod <sha>`, which:

1. copies `deployments/k8s` to a temporary directory and pins the `prod` overlay
   there with `pin-images.sh` from the commit's submodule pointers;
2. renders it with `kubectl kustomize` on the agent into one manifest file, and
   refuses the file if it holds anything outside the environment's namespace;
3. runs `kubectl apply -f` on the file inside the cluster through
   `az aks command invoke`, which uploads the file with the command;
4. waits up to 600 seconds, concurrently, on every `Deployment` and
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
deploy waits on. Its Service, ServiceAccount and Secret keep their
`tcab-backend` names, so every other workload reaches it unchanged.

A deploy that moves the backend's pin restarts the backend pod, and its ingest
sidecar force-ingests the branch tip (see
[Ingesting definitions](/deployment/kubernetes/control-plane/#ingesting-definitions));
`tcab ingest --env <env>` refreshes the catalog otherwise.

Run by hand, signed in to Azure with the same roles,
`scripts/ci/deploy-environment.sh <staging|prod> <sha>` rolls an environment
onto the set of any superrepo commit whose images the registry holds. That is
how an earlier set is put back; reverting the pointer bump on the branch and
letting the pipeline deploy the revert is the other route.

Which images the registry holds is a short list, by design. The registry's
tier has no retention policy, so each deployment ends by running
`scripts/ci/registry-purge.sh`, which reads what the staging and prod
namespaces run and keeps those images, the set just deployed and each
repository's newest, and deletes every other service and run image (a cluster
it cannot read stops it with nothing deleted). So the set an environment runs
and the one before it, which the other environment or a failed deploy's undo
still runs, can be put back by hand; an older image is put back by reverting
the change in its own repository, whose pipeline pushes the revert's image
(rebuilding only the run images whose inputs changed; see
[Reusing unchanged run images](/development/building/#reusing-unchanged-run-images)),
and pointing the superrepo at it.

### The deploy identity

The deploy runs under the `tcab-deploy` Azure Resource Manager service
connection, a workload-identity-federated identity with no stored secret. It
holds two roles on each cluster and two on the registry, and nothing else:

| Plane    | Role                                     | Scope                                         |
| -------- | ---------------------------------------- | --------------------------------------------- |
| Control  | Test Cabinet AKS Command Invoke (custom) | the cluster resource                          |
| Data     | Azure Kubernetes Service RBAC Admin      | `<cluster resource id>/namespaces/tcab-<env>` |
| Registry | AcrPush                                  | `testcabinet.azurecr.io`                      |
| Registry | AcrDelete                                | `testcabinet.azurecr.io`                      |

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
its own environment's namespace and delete images from the registry, which a
rebuild puts back.

On the registry, AcrPush is what every repository's image pipeline pushes
with and AcrDelete is what lets `scripts/ci/registry-purge.sh` delete. The
registry never refuses a token request for an action the identity has no right
to: it issues the token without that action, and each request made with it
answers 401. The purge therefore
reads the actions its token was granted and stops before deleting anything when
`delete` is not among them, naming this role.

Every role is assigned to the service principal's **object id**, never its
application (client) id, which is what the service connection displays.
`az role assignment create --assignee <id>` accepts either and looks the
principal up; `--assignee-object-id` takes the object id only, and given the
application id it creates an assignment that names no principal and grants
nothing, without a word of complaint. An assignment whose principal the portal
or `az role assignment list` cannot name is one of these.

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

The base lists the RBAC, backend, dispatcher, artifacts, repos, arena, ingest
`CronJob`, `NetworkPolicy` and `PodDisruptionBudget` resources, all namespaced.
An overlay sets the namespace and `TCAB_ENV`, patches in the environment's
secret references and its Access audience tag, and layers on the components it
needs. The `local`
overlay also includes `deployments/k8s/cluster/namespace` and
`deployments/k8s/cluster/observability`, so one apply creates its `Namespace`
and node-metrics grant; the remote overlays render only namespaced objects, and
their cluster-scoped objects are the bootstrap above.

| Component                      | What it adds                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `components/postgres`          | The backend as a stateless `Deployment` on managed PostgreSQL             |
| `components/postgres-azure-ad` | Passwordless Microsoft Entra database auth for that `Deployment`          |
| `components/observability`     | The in-cluster Grafana LGTM stack                                         |
| `components/keyvault-csi`      | Materializes the environment's Kubernetes `Secret`s from Azure Key Vault  |
| `components/web`               | The in-cluster `tcab-web` console workload                                |
| `components/edge`              | The `cloudflared` tunnel routing the environment's origin to the services |

The base alone runs the SQLite shape, as the `local` overlay does. The `staging`
and `prod` overlays run the same base with the PostgreSQL, Key Vault,
observability, web and edge components layered on.

## NetworkPolicy

The namespace `NetworkPolicy` set applies default-deny ingress plus a small list
of allowed flows. It takes effect on a `NetworkPolicy`-enforcing CNI such as
Calico or Cilium. Pods carry selectable labels: driver `Job` pods are labelled
`app.kubernetes.io/managed-by: tcab-dispatcher`, and sandbox pods
`app.kubernetes.io/managed-by: tcab-driver`.

The allowed flows are:

- dispatcher, driver and publisher pods to the backend, for claiming runs and
  publish jobs and reporting status;
- driver pods to the artifacts service, for uploading the produced run tree,
  and to the repos service, for uploading the bundle;
- publisher pods to the artifacts service, for fetching the build output, and
  to the repos service, for the public push;
- the backend to the artifacts service, for pruning a deleted run's tree,
  sweeping the trees no run row references, and writing the public snapshot,
  and to the repos service, for serving a bundle download and pruning a
  deleted run's bundle;
- sandbox pods to their driver pod, for streaming live preview frames and
  collecting the tree;
- the artifacts and repos services to the backend, for verifying a driver's or
  a publisher's token;
- the arena to the backend, for fetching controller inputs and persisting
  tournaments.

The `components/edge` component adds the flows from the `tcab-cloudflared` pods
to `tcab-web` on `8080`, to the backend, artifacts and arena on their service
ports, and to `tcab-lgtm` on `3000`. These are additive; the base policies stay
intact. The console reaches the arena, the artifacts service and the backend
through the edge, so no console-to-service flow exists in the cluster.

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

| Container                          | Ceiling  | Why                                                                                                                              |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `backend`                          | `2Gi`    | around 2.4x the anonymous memory plus slab a snapshot refresh reaches, which materializes every run record at once               |
| `lgtm`                             | `4Gi`    | a collector, three TSDBs and Grafana under bursty load, since validating a test case drives far more telemetry than a quiet week |
| `artifacts`                        | `1536Mi` | concurrent uploads and downloads streamed through to and from Blob, since no tree is assembled in memory                         |
| `repos`                            | `1Gi`    | unpacking and pushing the largest bundle at publish, with `git`'s own working set                                                |
| `ingest` sidecar                   | `256Mi`  | around 3x its peak, and it runs a git checkout whose cost grows with the catalog                                                 |
| `arena`                            | `512Mi`  | sized for concurrent wasm matches rather than for an idle week                                                                   |
| `dispatcher`, `web`, `cloudflared` | `256Mi`  | around 32x their peaks, and the headroom costs a node almost nothing                                                             |
| `publisher` (per publish `Job`)    | `1Gi`    | several times the largest build output it pulls from the artifacts service                                                       |

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

|               | Staging                                   | Prod                                   |
| ------------- | ----------------------------------------- | -------------------------------------- |
| Deployed from | the `staging` branch                      | the `master` branch                    |
| Cluster       | `testcabinet-staging-westus2-aks`         | `testcabinet-prod-westus2-aks`         |
| Namespace     | `tcab-staging`                            | `tcab-prod`                            |
| `TCAB_ENV`    | `staging`                                 | `prod`                                 |
| Secrets       | staging keys and tokens                   | prod keys and tokens                   |
| Origin        | `console.staging.testcabinet.ai`          | `console.testcabinet.ai`               |
| Tunnel        | `tcab-staging`                            | `tcab-prod`                            |
| Object stores | the staging Blob containers and R2 bucket | the prod Blob containers and R2 bucket |

Give each environment its own [public plane](/deployment/public-gallery/) so
staging publishes stay out of the prod gallery dataset; point each artifacts
service's `TCAB_R2_*` at the right bucket.

## Next steps

- [Control plane](/deployment/kubernetes/control-plane/): the backend and its
  catalog ingest.
- [Run plane](/deployment/kubernetes/run-plane/): RBAC, the dispatcher, per-run
  driver `Job`s, publish `Job`s, and the artifacts, repos and arena services.
- [PostgreSQL](/deployment/kubernetes/postgres/): the managed-database shape and
  passwordless Entra auth.
- [Edge](/deployment/kubernetes/edge/): the tunnel, the Access applications and
  the hostnames.
- [Backups](/deployment/backups/) and [Telemetry](/deployment/telemetry/): the
  two cross-cutting operational concerns.
