---
title: Kubernetes (staging & prod)
---

This page builds a **staging** and a **production** environment for the
[backend](/components/backend/overview/), the
[auth service](/components/auth/overview/), and the
[workers](/components/worker/overview/) on a Kubernetes cluster. Read the
[Overview](/deployment/overview/) first — in particular
[why Kubernetes](/deployment/overview/#why-kubernetes) and
[how the worker spawns run pods](/deployment/overview/#run-pods-how-the-worker-spawns-containers),
which are what make the worker an ordinary stateless `Deployment`/`StatefulSet`
rather than a privileged VM.

The cluster is the worked example here, but nothing about the design is
provider-specific: the backend is "a single-replica `StatefulSet` with a volume,"
the auth service is the same, and a worker is "a stateless pod with RBAC to manage
pods." Any conformant Kubernetes cluster — managed (GKE, EKS, AKS) or
self-hosted — works the same way.

The example manifests referenced below live under
[`deployments/k8s/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s)
and the environment values under
[`deployments/env/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env).
They are copy-pasteable starting points with placeholder values, not a managed
GitOps pipeline — adapt them rather than `kubectl apply`-ing them blind.

## Topology

```
   Kubernetes namespace: tcab-prod   (NetworkPolicy: no public Ingress)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                        │
   │   tcab-backend (StatefulSet, 1)        tcab-worker (StatefulSet, N)    │
   │   ┌────────────────────┐  ClusterIP    ┌──────────────┐ headless Svc   │
   │   │ tcab-backend       │◀──────────────│ tcab-worker-0│ (stable pod    │
   │   │ + PVC (state)      │               │ tcab-worker-1│  DNS names)     │
   │   │ + headless browser │               └──────┬───────┘                │
   │   └─────────┬──────────┘                      │ creates / exec / deletes
   │             │                                 ▼  (Kubernetes API)       │
   │   tcab-auth (StatefulSet, 1)            ┌──────────────┐                 │
   │   ┌────────────────────┐  ClusterIP     │  run pod     │  one per run,   │
   │   │ tcab-auth + PVC    │◀───────────────│  (ephemeral) │  then deleted   │
   │   └────────────────────┘                └──────────────┘                 │
   │                                                                          │
   │        web console (operator via kubectl port-forward / internal Ingress)│
   └─────────────┼────────────────────────────────────────────────────────────┘
                 │ outbound only
                 ▼
        Cloudflare R2 (snapshot) + Pages deploy hook  ──▶  public gallery
```

Everything sits in one namespace per environment. The backend's only inbound
traffic is from workers and operators in the namespace; its only outbound traffic
is the snapshot upload to Cloudflare R2 and the deploy-hook call that rebuilds the
[public gallery](/components/site/overview/). Workers reach the backend and auth
service by their `Service` names and reach the Kubernetes API to manage run pods;
the run pods reach model APIs and package registries.

One environment is one **namespace** — `tcab-staging` and `tcab-prod` — so the
two are isolated and tearing one down is `kubectl delete namespace`. Build staging
first, confirm the flow, then repeat for prod with prod's own secrets and a
`TCAB_ENV=prod` tag.

## Prerequisites

- A Kubernetes cluster and `kubectl` configured to reach it. The run-pod model
  needs **no** privileged pods, no Docker socket, and no special node pool — any
  conformant cluster works, including GKE Autopilot, EKS, and AKS.
- A container registry the cluster can pull the service images and the
  [run-container images](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)
  from. The canonical builds are published to GHCR by CI — the three **service**
  images (`tcab-backend`, `tcab-auth-service`, `tcab-worker`) by
  [`build-service-images.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-service-images.yml)
  and the run-container images by
  [`build-containers.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-containers.yml),
  each tagged `:latest` and an immutable `:<git-sha>`. Point the manifests'
  `image:` fields (`REPLACE_REGISTRY`) at that namespace and pin a `:<git-sha>`
  tag. If the registry is private, an `imagePullSecret` (referenced by
  `TCAB_K8S_IMAGE_PULL_SECRETS` for run pods).
- A `StorageClass` for the backend and auth `PersistentVolumeClaim`s
  (`ReadWriteOnce` is sufficient; neither volume is shared).
- The publishing credentials a worker needs if it will publish runs: a
  `GITHUB_TOKEN` and a Cloudflare API token, plus the backend's R2 credentials and
  site deploy-hook URL. See
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example)
  and
  [`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example)
  for the full list; treat all of them as secrets.

Apply the manifests in dependency order — namespace, RBAC and secrets, then the
services:

```sh
kubectl apply -f deployments/k8s/namespace.yaml
kubectl apply -f deployments/k8s/rbac.yaml
kubectl apply -f deployments/k8s/secrets.example.yaml   # after filling in values
kubectl apply -f deployments/k8s/auth.yaml
kubectl apply -f deployments/k8s/backend.yaml
kubectl apply -f deployments/k8s/worker.yaml
kubectl apply -f deployments/k8s/ingest-cronjob.yaml
```

Set the namespace per environment (`tcab-staging` vs `tcab-prod`) with
`kubectl apply -n <ns>` or by editing the `metadata.namespace` in each manifest.

## RBAC

The worker's one privilege is managing run pods in its run namespace. The
[`deployments/k8s/rbac.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/rbac.yaml)
example creates a `ServiceAccount` (`tcab-worker`) and a namespaced `Role` bound
to it granting exactly:

| Resource | Verbs | Why |
| --- | --- | --- |
| `pods` | `create`, `get`, `list`, `watch`, `delete` | start a run pod, wait for it to be `Running`, delete it when the run ends |
| `pods/exec` | `create` | seed the working tree and run the harness session in the pod |
| `pods/log` | `get` | surface a failed pod's logs in the run's failure detail |

That is the entire surface — a namespaced `Role`, not a `ClusterRole`, scoped to
the run namespace. The worker creates **no** Deployments, Services, or RBAC
objects; it never touches anything outside its namespace. The worker pod runs
under this `ServiceAccount`; in-cluster the Kubernetes client picks up the
mounted token automatically, so no kubeconfig is needed.

## Worker

A worker is a stateless HTTP service that turns submitted runs into run pods. It
runs as a `StatefulSet` behind a **headless `Service`** so each pod has a stable
DNS name — required because
[worker jobs are per-instance](/deployment/overview/#access-the-cluster-network-plus-accounts-on-it).
The example is
[`deployments/k8s/worker.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/worker.yaml).

Select the Kubernetes runtime and point it at its run namespace with the worker's
environment (the full list is in
[`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example)):

| Variable | Required | Purpose | Default |
| --- | --- | --- | --- |
| `TCAB_WORKER_RUNTIME` | for K8s | `kubernetes` to spawn run pods via the API; `cli` (default) uses a host Docker/Podman, for local dev | `cli` |
| `TCAB_BACKEND_URL` | yes | The backend `Service`, e.g. `http://tcab-backend:8787` | — |
| `TCAB_AUTH_URL` | no | The auth `Service`, e.g. `http://tcab-auth:8789` | `http://127.0.0.1:8789` |
| `TCAB_K8S_NAMESPACE` | no | Namespace run pods are created in | the worker's own namespace |
| `TCAB_K8S_RUN_SERVICE_ACCOUNT` | no | `ServiceAccount` for run pods | namespace default |
| `TCAB_K8S_IMAGE_PULL_SECRETS` | no | Comma-separated `imagePullSecret` names for the run-container image | none |
| `TCAB_K8S_RUN_CPU_REQUEST` / `_LIMIT` | no | CPU request/limit on each run pod | unset |
| `TCAB_K8S_RUN_MEMORY_REQUEST` / `_LIMIT` | no | Memory request/limit on each run pod | unset |
| `TCAB_K8S_POD_READY_TIMEOUT_SECONDS` | no | How long to wait for a run pod to reach `Running` | `180` |
| `TCAB_K8S_POD_IP` | no | The worker pod's own IP, for the live asset-preview route (set from the downward API) | unset |
| `TCAB_K8S_RUN_POD_PREFIX` | no | Name prefix for run pods | `tcab-run-` |

The worker is otherwise the same binary it is locally: it injects the harness API
key into each run pod, so the worker's `Secret` carries only the harness key(s) it
will run plus, if it publishes, the GitHub and Cloudflare credentials.

### Resource requests on run pods

Set `TCAB_K8S_RUN_CPU_*` and `TCAB_K8S_RUN_MEMORY_*` so the scheduler can place
run pods sensibly and one heavy run cannot starve a node. A run compiles and runs
a small app under a coding agent, so a request in the region of `500m`/`1Gi` and a
limit a few times that is a reasonable starting point; tune against your cases.

### A "pool" is individually-addressed pods

Because [worker jobs are per-instance](/deployment/overview/#access-the-cluster-network-plus-accounts-on-it),
the worker `Service` is **headless** (`clusterIP: None`). A run submitted to
`tcab-worker-0.tcab-worker.<ns>.svc:8788` must be polled at that same name; a
load-balancing `Service` would scatter the follow-up polls. Scale by raising the
`StatefulSet` replica count and registering each pod's stable DNS name in the
[web console](/components/web/overview/) individually.

### Live asset previews

For an asset-generation run with a viewer attached, the worker opens a short-lived
TCP listener and the run pod streams preview frames back to it (see
[live previews](/components/core/execution/)). In-cluster the run pod reaches the
worker by IP, so set `TCAB_K8S_POD_IP` from the downward API and the worker adds it
as a `hostAlias` on the run pod:

```yaml
env:
  - name: TCAB_K8S_POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
```

This is best-effort — a missed frame is skipped — so leaving it unset only means
previews don't stream; runs are unaffected.

## Backend

The backend with its default **SQLite** store is
[stateful](/deployment/overview/#the-three-services-on-kubernetes): it owns a
database file, an on-disk definition store, a checkout it ingests from, and a
headless browser for rendering references. As a `StatefulSet`
([`deployments/k8s/backend.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/backend.yaml))
three things are non-negotiable and follow directly from that:

1. **A single replica.** SQLite is single-writer and the store is local, so the
   `StatefulSet` is pinned to `replicas: 1`. This service coordinates publishes
   and serves a low-traffic API; it is not something you scale out.
2. **A `PersistentVolumeClaim`.** Mount it at the SQLite database path (in
   `TCAB_BACKEND_DATABASE_URL`) and the paths `TCAB_BACKEND_STORE` and
   `TCAB_BACKEND_CHECKOUT` point to, so the database, store, and checkout survive
   a restart or reschedule. A volume survives restarts but is **not** a backup;
   see [Backups](/deployment/backups/).
3. **An image with a browser.** The stock binary has no Chromium. The published
   `tcab-backend` image
   ([`deployments/images/backend.Dockerfile`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/images/backend.Dockerfile))
   layers the `tcab-backend` binary over a headless Chromium and the fonts it
   needs, and points `TCAB_REFERENCE_BROWSER` at it; the auth and worker images
   stay slim and ship no browser. Set `TCAB_REFERENCE_BROWSER` yourself only if
   you build a backend image where the browser is not auto-detected.

Constraints 1 and 2 are properties of the **SQLite** store, not the backend
itself. Point `TCAB_BACKEND_DATABASE_URL` at a managed **PostgreSQL** instance
(see [Backups](/deployment/backups/#managed-postgresql)) and the backend becomes
stateless: no volume for the database, no single-replica pin, and it can run as a
plain `Deployment`. Constraint 3 (the browser image) and a volume for the
definition store and checkout still apply, since those remain on local disk.

The backend `Service` is `ClusterIP` with no `Ingress` — workers and operators
reach it in-cluster, and its outbound R2 and deploy-hook calls need no inbound
exposure.

### Ingesting definitions

The backend serves the catalog from the checkout at `TCAB_BACKEND_CHECKOUT`,
populated by calling `POST /ingest`. Run this as a `CronJob`
([`deployments/k8s/ingest-cronjob.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/ingest-cronjob.yaml))
that pulls the repository onto the backend's volume and then calls `POST /ingest`.
Because the volume is persistent, this is a periodic refresh, not something that
happens on every restart.

## Auth service

The auth service hosts the user [accounts](/components/backend/overview/#accounts)
the backend verifies tokens against. It keeps its **own** SQLite database, so it
takes the same single-replica `StatefulSet` + `PersistentVolumeClaim` shape as the
backend, or — pointed at a managed database via `TCAB_AUTH_DATABASE_URL` — runs as
a plain `Deployment`. It renders nothing, holds no third-party secret (only
Argon2id password hashes), and has no egress. The example is
[`deployments/k8s/auth.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/auth.yaml);
point the backend at it with `TCAB_BACKEND_AUTH_URL=http://tcab-auth:8789`.

## NetworkPolicy

With no public `Ingress`, reachability is already limited to the cluster network.
A namespace `NetworkPolicy` tightens it further — for example, allow run pods only
the egress they need (model APIs, package registries) and deny everything else, or
restrict who may reach the backend. The run pods carry a
`app.kubernetes.io/managed-by: tcab-worker` label so a policy can select them. Run
pods need **no** inbound access except the worker's `exec`/preview connections,
which Kubernetes routes over the API server and pod network respectively.

## Per-environment differences

Staging and prod are the same manifests; keep them that way so staging actually
rehearses prod. Only these differ:

| | Staging | Prod |
| --- | --- | --- |
| Namespace | `tcab-staging` | `tcab-prod` |
| `TCAB_ENV` | `staging` | `prod` |
| Worker replicas | one is enough | sized to demand |
| Secrets | staging keys & tokens | prod keys & tokens |

Use separate Cloudflare R2 buckets (and deploy hooks) per environment if you want
staging publishes to land in a separate gallery dataset from prod; point each
backend's `TCAB_R2_*` and `TCAB_SITE_DEPLOY_HOOK_URL` at the right one.

## Operating these environments

Two cross-cutting concerns have their own pages:

- **[Backups](/deployment/backups/)** — the only irreplaceable data is the
  backend's database, so backups reduce to protecting that one store: a SQLite
  backend streams its volume to object storage with a Litestream sidecar, while
  managed PostgreSQL hands you provider-managed point-in-time restore.
- **[Telemetry](/deployment/telemetry/)** — choosing and wiring an OTLP collector
  for staging and prod, tagged by `TCAB_ENV`. Enable it in both environments.
