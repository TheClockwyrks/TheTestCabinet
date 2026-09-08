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
components under `deployments/k8s/components/`, and one overlay per environment
under `deployments/k8s/overlays/`. They carry placeholder values and are starting
points to adapt.

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
  run-container images from. The canonical builds are published to GHCR by CI:
  the service images (`tcab-backend`, `tcab-auth-service`, `tcab-dispatcher`,
  `tcab-driver`, `tcab-artifacts`, `tcab-arena`, `tcab-publisher`, `tcab-web`) by
  `build-service-images.yml`, and the run-container images by
  `build-containers.yml`. All are published for `linux/amd64` and `linux/arm64`
  and tagged both `:latest` and an immutable `:<git-sha>`. Both workflows run on
  every push to `master` and `staging`, unfiltered, so any sha on those branches
  has a complete image set and both halves are always pinnable to the same one.
  If the registry is private, create an `imagePullSecret` and name it in
  `TCAB_K8S_IMAGE_PULL_SECRETS`.
- A `StorageClass` for the backend, auth, and artifact `PersistentVolumeClaim`s.
  `ReadWriteOnce` is sufficient; none of the volumes is shared.
- The publisher's credentials, if the deployment will publish runs: a GitHub
  token and a Cloudflare API token, plus the backend's R2 credentials and site
  deploy-hook URL.

### Pinning images

The two image sets reach the cluster differently and are pinned in two places.

- Service images are Kubernetes `image:` fields, so each overlay's kustomize
  `images:` transformer pins them by setting `newTag` to a `:<git-sha>`. For
  promoting the latest CI build to prod, see
  [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/).
- Run-container images are resolved by the driver at run time. Pin them by
  setting `TCAB_CONTAINER_TAG` (and optionally `TCAB_CONTAINER_REGISTRY`) on the
  dispatcher, which forwards both into every driver `Job`. Left unset the driver
  tracks the mutable `:latest`. Re-pin `TCAB_CONTAINER_TAG` only to a sha at
  which `build-containers` actually published, and roll staging before prod.

The driver stages a run's [audio packs](/components/core/execution/#staged-audio)
into the run container, so the `tcab-driver` image and `TCAB_CONTAINER_TAG` move
to the same commit. Where they have to be sequenced, roll the driver first: a run
image that does not accept the driver's staging contract fails an audio-bearing
run at container start, before a model session is spent. End-to-end, adversarial,
and performance runs stage no audio and are unaffected either way.

## Applying an overlay

Create the environment's secrets first, from your secret manager, then apply an
overlay. Apply the overlay, never the individual base files.

```sh
kubectl kustomize deployments/k8s/overlays/prod      # preview the rendered manifests
kubectl apply    -k deployments/k8s/overlays/prod    # or .../overlays/staging
```

The base lists the namespace, RBAC, backend, auth, dispatcher, artifacts, arena,
ingest `CronJob`, and `NetworkPolicy` resources. An overlay sets the namespace
and `TCAB_ENV`, patches in the environment's images and secret references, and
layers on the components it needs:

| Component                      | What it adds                                                             |
| ------------------------------ | ------------------------------------------------------------------------ |
| `components/postgres`          | Backend and auth as stateless `Deployment`s on managed PostgreSQL        |
| `components/postgres-azure-ad` | Passwordless Microsoft Entra database auth for those two `Deployment`s   |
| `components/observability`     | The in-cluster Grafana LGTM stack                                        |
| `components/keyvault-csi`      | Materializes the environment's Kubernetes `Secret`s from Azure Key Vault |
| `components/web`               | The in-cluster `tcab-web` console workload                               |
| `components/internal-ingress`  | The console plus the service hostnames over a VPN-only ingress           |

The `staging` and `prod` overlays run the SQLite shape; `azure-staging` and
`azure-prod` run the same base with the PostgreSQL, Key Vault, observability, and
internal-ingress components layered on.

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

|            | Staging                         | Prod                    |
| ---------- | ------------------------------- | ----------------------- |
| Namespace  | `tcab-staging`                  | `tcab-prod`             |
| `TCAB_ENV` | `staging`                       | `prod`                  |
| Secrets    | staging keys and tokens         | prod keys and tokens    |
| Hostnames  | `*.staging.tcab.testcabinet.ai` | `*.tcab.testcabinet.ai` |

Give each environment its own [public plane](/deployment/public-gallery/) so
staging publishes stay out of the prod gallery dataset; point each backend's
`TCAB_R2_*` and `TCAB_PROJECTION_DATABASE_URL` at the right bucket and
projection.

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
