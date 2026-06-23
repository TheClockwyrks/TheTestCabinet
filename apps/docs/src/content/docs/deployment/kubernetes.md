---
title: Kubernetes (staging & prod)
---

This page builds a **staging** and a **production** environment for the
[backend](/components/backend/overview/), the
[auth service](/components/auth/overview/), the
[dispatcher](/components/dispatcher/overview/), and the
[artifact service](/components/artifacts/overview/) on a Kubernetes cluster. Read
the [Overview](/deployment/overview/) first — runs are no longer executed by a
long-lived worker pool. A console **enqueues** a run at the backend; the
dispatcher claims it and creates a per-run **Job** running the
[driver](/components/driver/overview/), which (under the Kubernetes runtime)
creates one ephemeral **sandbox pod** for that run. Concurrency scales with the
cluster, not a hand-sized pool.

The cluster is the worked example here, but nothing about the design is
provider-specific: the backend, auth, and artifact services are each "a
single-replica `StatefulSet` with a volume," the dispatcher is "a stateless
1-replica `Deployment` with RBAC to manage Jobs," and a run is "a short-lived Job
whose driver creates one sandbox pod." Any conformant Kubernetes cluster —
managed (GKE, EKS, AKS) or self-hosted — works the same way.

The example manifests referenced below live as a **kustomize base** under
[`deployments/k8s/base/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/base),
with per-environment overlays under
[`deployments/k8s/overlays/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/overlays)
and the environment values under
[`deployments/env/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env).
They are copy-pasteable starting points with placeholder values, not a managed
GitOps pipeline — adapt them rather than applying them blind.

## Topology

```
   Kubernetes namespace: tcab-prod   (NetworkPolicy: no public Ingress)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                                                                            │
   │   tcab-backend (StatefulSet, 1)         tcab-dispatcher (Deployment, 1)    │
   │   ┌────────────────────┐  ClusterIP     ┌──────────────────────┐  no Svc   │
   │   │ tcab-backend       │◀── enqueue ────│ claims a queued run, │ (binds no  │
   │   │ + PVC (state)      │── claim ──────▶│ creates ONE Job/run  │  socket)   │
   │   │ + run queue        │                └──────────┬───────────┘            │
   │   │ + headless browser │                           │ creates Job (K8s API)  │
   │   └─────────┬──────────┘                           ▼                        │
   │             │                            ┌──────────────────────┐           │
   │   tcab-auth (StatefulSet, 1)             │ tcab-driver Job       │ one per   │
   │   ┌────────────────────┐  ClusterIP      │ (per-run, then GC'd)  │  run      │
   │   │ tcab-auth + PVC    │◀────────────────│ creates / exec /      │           │
   │   └────────────────────┘                 │ deletes ▼ (K8s API)   │           │
   │                                          │  ┌────────────────┐   │           │
   │   tcab-artifacts (StatefulSet, 1)        │  │  sandbox pod   │   │ untrusted │
   │   ┌────────────────────┐  ClusterIP      │  │  (ephemeral)   │   │           │
   │   │ tcab-artifacts     │◀── upload ──────┤  └────────────────┘   │           │
   │   │ + PVC (artifacts)  │── read ─┐       └──────────────────────┘           │
   │   └────────────────────┘         │                                          │
   │                                  ▼                                          │
   │        web console (enqueue at backend; read artifacts; via kubectl        │
   │        port-forward / internal Ingress)                                     │
   └─────────────┼──────────────────────────────────────────────────────────────┘
                 │ outbound only (backend)
                 ▼
        Cloudflare R2 (snapshot) + Pages deploy hook  ──▶  public gallery
```

Everything sits in one namespace per environment. A console **enqueues** a run at
the backend's queue; the dispatcher claims it and creates one driver **Job**; the
driver creates one **sandbox pod**, execs the harness in, copies the produced
tree out, and deletes the pod. Because the sandbox pod's disk is ephemeral, the
driver **uploads** the produced run tree (playable build, proof/asset media) to
the **artifact service** before reporting terminal status, and the console reads
those artifacts from there — **artifact bytes never transit the backend**. The
backend's only outbound traffic is the snapshot upload to Cloudflare R2 and the
deploy-hook call that rebuilds the
[public gallery](/components/site/overview/).

One environment is one **namespace** — `tcab-staging` and `tcab-prod` — so the
two are isolated and tearing one down is `kubectl delete namespace`. Build staging
first, confirm the flow, then repeat for prod with prod's own secrets and a
`TCAB_ENV=prod` tag.

## Prerequisites

- A Kubernetes cluster and `kubectl` configured to reach it. The run model needs
  **no** privileged pods, no Docker socket, and no special node pool — any
  conformant cluster works, including GKE Autopilot, EKS, and AKS.
- A container registry the cluster can pull the service images and the
  [run-container images](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)
  from. The canonical builds are published to GHCR by CI — the five **service**
  images (`tcab-backend`, `tcab-auth-service`, `tcab-dispatcher`, `tcab-driver`,
  `tcab-artifacts`) by
  [`build-service-images.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-service-images.yml)
  and the run-container images by
  [`build-containers.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-containers.yml),
  each tagged `:latest` and an immutable `:<git-sha>`. Point the overlays'
  `image:` fields at that namespace and pin a `:<git-sha>` tag. If the registry is
  private, an `imagePullSecret` (referenced by `TCAB_K8S_IMAGE_PULL_SECRETS` for
  sandbox pods).
- A `StorageClass` for the backend, auth, and artifact `PersistentVolumeClaim`s
  (`ReadWriteOnce` is sufficient; none of the volumes is shared).
- The backend's publishing credentials, if it will publish runs: a `GITHUB_TOKEN`
  and a Cloudflare API token, plus the backend's R2 credentials and site
  deploy-hook URL. Publishing is a separate explicit **backend** operation — the
  driver does not publish — so these are the backend's concern, not the
  dispatcher's. See
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example)
  for the full list, and
  [`.env.dispatcher.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.dispatcher.example)
  for the dispatcher's; treat all of them as secrets.

The manifests are a kustomize base with one overlay per environment. **Create the
secrets first** (from your secret manager), then apply an overlay:

```sh
kubectl kustomize deployments/k8s/overlays/prod      # preview the rendered manifests
kubectl apply    -k deployments/k8s/overlays/prod    # or .../overlays/staging
```

The base
([`deployments/k8s/base/kustomization.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/kustomization.yaml))
lists the namespace, RBAC, backend, auth, dispatcher, artifacts, arena, ingest
CronJob, and NetworkPolicy resources; the overlay sets the namespace and `TCAB_ENV` and
patches in the environment's images and secret references. Apply the **overlay**,
not the individual base files.

## RBAC

Run execution now involves **two** in-cluster identities, each a namespaced
`Role` (not a `ClusterRole`), bound to its own `ServiceAccount`. The example is
[`deployments/k8s/base/rbac.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/rbac.yaml).

### Dispatcher (`tcab-dispatcher`)

The dispatcher claims queued runs, creates one Job per run, watches them, and —
when a driver pod dies — reads its logs for failure reporting. It creates **no
pods directly**.

| Resource | Verbs | Why |
| --- | --- | --- |
| `batch`/`jobs` | `create`, `get`, `list`, `watch`, `delete` | create the per-run driver Job, watch it to completion, delete it |
| `core`/`pods` | `get`, `list` | find the Job's driver pod |
| `core`/`pods/log` | `get` | surface a dead driver pod's logs in the run's failure detail |

### Driver (`tcab-driver`)

The driver runs inside each Job and, under the Kubernetes runtime, is the trusted
process that creates the untrusted sandbox pod. The dispatcher names this
`ServiceAccount` on every Job it creates.

| Resource | Verbs | Why |
| --- | --- | --- |
| `core`/`pods` | `create`, `get`, `list`, `delete` | start the sandbox pod, wait for it to be `Running`, delete it when the run ends |
| `core`/`pods/exec` | `create` | seed the working tree and run the harness session in the sandbox pod |

Both are namespaced `Role`s scoped to the run namespace; neither creates
Deployments, Services, or RBAC objects, and neither touches anything outside its
namespace. Each pod runs under its `ServiceAccount`; in-cluster the Kubernetes
client picks up the mounted token automatically, so no kubeconfig is needed.

## Dispatcher

The dispatcher is a thin, stateless **1-replica `Deployment`** with **no
`Service`** — it binds no socket. It polls the backend's run queue, claims a
queued run, and creates one driver Job for it; the trust model lives entirely in
the driver and sandbox pod, so the dispatcher stays minimal. The example is
[`deployments/k8s/base/dispatcher.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/dispatcher.yaml).

Configure it with the dispatcher's environment (the full list is in
[`crates/dispatcher/src/config.rs`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/crates/dispatcher/src/config.rs)
and
[`.env.dispatcher.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.dispatcher.example)):

| Variable | Required | Purpose | Default |
| --- | --- | --- | --- |
| `TCAB_BACKEND_URL` | yes | The backend `Service`, e.g. `http://tcab-backend:8787` | — |
| `TCAB_BACKEND_SERVICE_TOKEN` | yes | Shared service token authenticating the claim. **The backend must carry the same value** or the queue never drains | — |
| `TCAB_DRIVER_IMAGE` | yes | The `tcab-driver` image to run as each Job | — |
| `TCAB_DISPATCHER_NAMESPACE` | no | Namespace the Jobs are created in | the dispatcher's own namespace |
| `TCAB_DISPATCHER_DRIVER_SA` | yes | `ServiceAccount` named on every driver Job (`tcab-driver`) | — |
| `TCAB_DISPATCHER_MAX_INFLIGHT` | no | Queue-admission cap on concurrent runs | `8` |
| `TCAB_DISPATCHER_POLL_INTERVAL_SECONDS` | no | How often to poll the queue | `2` |
| `TCAB_DISPATCHER_JOB_TTL_SECONDS` | no | TTL after which a finished Job is garbage-collected | `300` |
| `TCAB_DISPATCHER_DRIVER_SECRETS` | yes | Comma-separated `Secret` names mounted into each driver Job via `envFrom` — how the harness API key reaches the run engine | — |
| `TCAB_ARTIFACTS_URL` | yes | The artifact `Service`, forwarded to each driver so it can upload | — |
| `TCAB_K8S_*` (sandbox passthroughs) | no | `TCAB_K8S_NAMESPACE`, `TCAB_K8S_RUN_CPU_REQUEST`/`_LIMIT`, `TCAB_K8S_RUN_MEMORY_REQUEST`/`_LIMIT`, `TCAB_K8S_IMAGE_PULL_SECRETS`, `TCAB_K8S_POD_READY_TIMEOUT_SECONDS`, `TCAB_K8S_RUN_POD_PREFIX` — forwarded verbatim into each driver Job | per-variable |

Concurrency scales with the cluster: `TCAB_DISPATCHER_MAX_INFLIGHT` plus the
cluster's own capacity admit runs, rather than a hand-sized pool. There is no
KEDA.

## Driver (per-run Jobs)

The driver is not a long-lived service — it is created **per run** as a Job by
the dispatcher and executes exactly one run. Under `TCAB_DRIVER_RUNTIME=kubernetes`
it is the trusted pod that creates one untrusted sandbox pod via the Kubernetes
API (the same trust model the old worker used — a trusted process creates an
untrusted sandbox), execs the harness in, copies the produced tree out, deletes
the sandbox pod, and uploads the produced tree to the artifact service before
reporting terminal status. The example Job template is
[`deployments/k8s/base/dispatcher.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/dispatcher.yaml)
(the dispatcher renders it).

The dispatcher forwards the `TCAB_K8S_*` passthroughs and `TCAB_ARTIFACTS_URL`
verbatim into each Job, so the driver creates the sandbox pod with the right
namespace, image-pull secrets, and resource requests, and knows where to upload.
The **harness API key** arrives via `TCAB_DISPATCHER_DRIVER_SECRETS`: those
`Secret`s are mounted into the Job with `envFrom`, so the carrier of third-party
keys is the Secret set, not a per-pod injection.

### Resource requests on run/sandbox pods

Set `TCAB_K8S_RUN_CPU_*` and `TCAB_K8S_RUN_MEMORY_*` (the dispatcher forwards
them into each Job, and the driver applies them to the sandbox pod) so the
scheduler can place sandbox pods sensibly and one heavy run cannot starve a node.
A run compiles and runs a small app under a coding agent, so a request in the
region of `500m`/`1Gi` and a limit a few times that is a reasonable starting
point; tune against your cases.

### Live asset previews

For an asset-generation run with a viewer attached, the **sandbox** pod streams
preview frames back to the **driver** pod (see
[live previews](/components/core/execution/)). In-cluster the sandbox reaches the
driver by IP, so the driver's own pod IP is wired in via the downward API
(`TCAB_K8S_POD_IP` from `status.podIP`, set on the Job):

```yaml
env:
  - name: TCAB_K8S_POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
```

This is best-effort — a missed frame is skipped — so leaving it unset only means
previews don't stream; runs are unaffected.

## Artifact service

The driver's sandbox pod is ephemeral, so the produced run tree (playable build,
proof/asset media) has to land somewhere durable before the run is reported
terminal. That is the artifact service: a **1-replica `StatefulSet`** with a
**`ClusterIP` `Service`** and a `PersistentVolumeClaim` at `TCAB_ARTIFACTS_ROOT`,
bound to `0.0.0.0:8790`. The example is
[`deployments/k8s/base/artifacts.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/artifacts.yaml).

It runs under its **own `ServiceAccount` with no Kubernetes API access** — it only
stores and serves bytes. The driver **uploads** to it; the **console reads** from
it. The backend exposes the console-facing base URL as `TCAB_ARTIFACTS_PUBLIC_URL`
(reported to the console via `GET /config`), and **no artifact bytes pass through
the backend** — they flow driver → artifacts → console directly.

## Arena service

Adversarial **matches** and **tournaments** are CPU-bound in-process wasm, so they
run on the arena service rather than the single-replica control-plane backend. It is
a **stateless** `Deployment` (not a `StatefulSet`, **no PVC**) with a **`ClusterIP`
`Service`**, its own `ServiceAccount` (no Kubernetes API access), and real CPU
`requests`/`limits`, bound to `0.0.0.0:8791`. The example is
[`deployments/k8s/base/arena.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/arena.yaml).

It runs **exactly one replica**: its in-flight tournament registry and live progress
channel are in-memory and per-pod. It fetches every controller input from the backend
and persists finished tournaments + replays back to it (no bytes of its own to store).
The backend exposes the console-facing base URL as `TCAB_ARENA_PUBLIC_URL` (reported
via `GET /config`); arena **reads** (published tournaments + replays) are served by
the backend, only **execution** lives here. A capacity semaphore
(`TCAB_ARENA_MAX_CONCURRENT`, default `2`) rejects past the cap with `503` rather than
queueing. See [Arena overview](/components/arena/overview/).

## Backend

The backend with its default **SQLite** store is
[stateful](/deployment/overview/): it owns a database file, an on-disk definition
store, a checkout it ingests from, the **run queue**, and a headless browser for
rendering references. As a `StatefulSet`
([`deployments/k8s/base/backend.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/backend.yaml))
three things are non-negotiable and follow directly from that:

1. **A single replica.** SQLite is single-writer and the store is local, so the
   `StatefulSet` is pinned to `replicas: 1`. This service coordinates publishes,
   owns the queue, and serves a low-traffic API; it is not something you scale
   out.
2. **A `PersistentVolumeClaim`.** Mount it at the SQLite database path (in
   `TCAB_BACKEND_DATABASE_URL`) and the paths `TCAB_BACKEND_STORE` and
   `TCAB_BACKEND_CHECKOUT` point to, so the database, store, and checkout survive
   a restart or reschedule. A volume survives restarts but is **not** a backup;
   see [Backups](/deployment/backups/).
3. **An image with a browser.** The stock binary has no Chromium. The published
   `tcab-backend` image
   ([`deployments/images/backend.Dockerfile`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/images/backend.Dockerfile))
   layers the `tcab-backend` binary over Node, the bundled Playwright driver, and a
   Playwright-managed Chromium (plus the fonts it needs), and points the render path
   at them; the auth, dispatcher, driver, and artifact images stay slim and ship no
   browser. Set `TCAB_REFERENCE_BROWSER` yourself only to override that baked
   Chromium with an explicit binary (the backend forwards it to the driver).

The backend also carries two values that wire it into the new run path:

- **`TCAB_BACKEND_SERVICE_TOKEN`** — the shared service token it verifies the
  dispatcher's claim against. It must **match the dispatcher's**
  `TCAB_BACKEND_SERVICE_TOKEN`, or the dispatcher's claims are rejected and the
  queue never drains.
- **`TCAB_ARTIFACTS_PUBLIC_URL`** — the console-facing artifact base URL the
  backend reports to the console via `GET /config`.

Constraints 1 and 2 are properties of the **SQLite** store, not the backend
itself. Point `TCAB_BACKEND_DATABASE_URL` at a managed **PostgreSQL** instance
(see [Backups](/deployment/backups/#managed-postgresql)) and the backend becomes
stateless: no volume for the database, no single-replica pin, and it can run as a
plain `Deployment`. Constraint 3 (the browser image) and a volume for the
definition store and checkout still apply, since those remain on local disk.

The backend `Service` is `ClusterIP` with no `Ingress` — the dispatcher, the
artifact service, and operators reach it in-cluster, and its outbound R2 and
deploy-hook calls need no inbound exposure.

### Ingesting definitions

The backend serves the catalog from the checkout at `TCAB_BACKEND_CHECKOUT`,
populated by calling `POST /ingest`. Run this as a `CronJob`
([`deployments/k8s/base/ingest-cronjob.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/ingest-cronjob.yaml))
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
[`deployments/k8s/base/auth.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/auth.yaml);
point the backend at it with `TCAB_BACKEND_AUTH_URL=http://tcab-auth:8789`.

## NetworkPolicy

With no public `Ingress`, reachability is already limited to the cluster network.
A namespace `NetworkPolicy`
([`deployments/k8s/base/networkpolicy.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/networkpolicy.yaml))
tightens it further with **default-deny ingress** and a small set of allowed
flows. The pods carry selectable labels: sandbox pods are labelled
`app.kubernetes.io/managed-by: tcab-driver`, and driver Job pods
`app.kubernetes.io/managed-by: tcab-dispatcher`. The allowed flows are:

- **dispatcher + driver pods → backend/auth** — claiming runs and reporting
  status/tokens.
- **driver pods → artifacts** — uploading the produced run tree.
- **sandbox pods → driver pod** — streaming live preview frames.
- **artifacts → backend/auth** — token verification.
- **arena → backend** — fetching controller inputs and persisting tournaments.
- **console → arena** — running matches/tournaments (over the private boundary).

Everything else is denied. The sandbox pods themselves need **no** inbound access
except the driver's `exec`/preview connections, which Kubernetes routes over the
API server and pod network respectively; their egress is the model APIs and
package registries a run needs.

## Per-environment differences

Staging and prod are the same base manifests; keep them that way so staging
actually rehearses prod. The `overlays/staging` overlay rewrites the namespace and
`TCAB_ENV`; only these differ:

| | Staging | Prod |
| --- | --- | --- |
| Namespace | `tcab-staging` | `tcab-prod` |
| `TCAB_ENV` | `staging` | `prod` |
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
