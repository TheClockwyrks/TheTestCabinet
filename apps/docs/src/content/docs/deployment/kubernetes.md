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
          OpenVPN client (operator laptop)  ──▶  resolves *.testcabinet.ai
                 │                                via private DNS → internal LB IP
                 ▼
   ingress-nginx (internal LB, private VNet IP, VPN-only)   TLS: cert-manager (LE)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  console.tcab.testcabinet.ai → tcab-web   api.tcab.testcabinet.ai → tcab-backend:8787 │
   │  auth.tcab.testcabinet.ai → tcab-auth:8789  artifacts.* → tcab-artifacts:8790    │
   │                                        arena.*     → tcab-arena:8791        │
   └──────────────────────────────────────┬─────────────────────────────────────┘
                                          │ (NetworkPolicy admits ingress-nginx ns)
   Kubernetes namespace: tcab-prod   (NetworkPolicy: no PUBLIC Ingress)
   ┌──────────────────────────────────────▼─────────────────────────────────────┐
   │                                                                            │
   │   tcab-web (Deployment, 1)              tcab-dispatcher (Deployment, 1)    │
   │   ┌────────────────────┐  ClusterIP     ┌──────────────────────┐  no Svc   │
   │   │ static console SPA │                │ claims a queued run, │ (binds no  │
   │   │ (runtime cfg → API)│                │ creates ONE Job/run  │  socket)   │
   │   └────────────────────┘                └──────────┬───────────┘            │
   │                                                    │ creates Job (K8s API)  │
   │   tcab-backend (StatefulSet, 1)                    ▼                        │
   │   ┌────────────────────┐  ClusterIP     ┌──────────────────────┐           │
   │   │ tcab-backend       │◀── enqueue ────│ tcab-driver Job       │ one per   │
   │   │ + PVC (state)      │── claim ──────▶│ (per-run, then GC'd)  │  run      │
   │   │ + run queue        │                │ creates / exec /      │           │
   │   │ + headless browser │                │ deletes ▼ (K8s API)   │           │
   │   └─────────┬──────────┘                │  ┌────────────────┐   │           │
   │   tcab-auth (StatefulSet, 1)            │  │  sandbox pod   │   │ untrusted │
   │   ┌────────────────────┐  ClusterIP     │  │  (ephemeral)   │   │           │
   │   │ tcab-auth + PVC    │◀───────────────│  └────────────────┘   │           │
   │   └────────────────────┘                └──────────────────────┘           │
   │   tcab-artifacts (StatefulSet, 1)        tcab-arena (Deployment, 1)         │
   │   ┌────────────────────┐  ClusterIP      ┌────────────────────┐  ClusterIP  │
   │   │ tcab-artifacts     │◀── upload ──────│ tcab-arena (wasm)  │             │
   │   │ + PVC (artifacts)  │                 └────────────────────┘             │
   │   └─────────┬──────────┘                                                    │
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

Operators reach all of this over the **VPN**: an **internal** ingress-nginx (its
load balancer holds a private VNet IP, never a public one) fronts the in-cluster
`tcab-web` console and the four services at one `*.testcabinet.ai` hostname each,
with TLS from cert-manager. The `*.testcabinet.ai` names resolve only through
private DNS that VPN clients see — nothing is given a **public** `Ingress` or FQDN.
That layer ships as the reusable
[`components/internal-ingress`](#internal-ingress) component, wired into the live
`overlays/azure-prod` overlay; the section below builds it.

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
  from. The canonical builds are published to GHCR by CI — the **service** images
  (`tcab-backend`, `tcab-auth-service`, `tcab-dispatcher`, `tcab-driver`,
  `tcab-artifacts`, `tcab-arena`, `tcab-publisher`, `tcab-web`) by
  [`build-service-images.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-service-images.yml)
  and the run-container images by
  [`build-containers.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.github/workflows/build-containers.yml),
  all published **multi-arch** (`linux/amd64` + `linux/arm64`, so they run on either
  node architecture) and each tagged `:latest` and an immutable `:<git-sha>`. These
  are pinned in **two different places**, because the two image sets reach the
  cluster differently:
  - **Service images** are Kubernetes `image:` fields, so the overlays' kustomize
    `images:` transformer pins them — set `newTag` to a `:<git-sha>`. For the
    routine "promote the latest CI build to prod" loop — finding the built sha,
    re-pinning, and applying through the private cluster — see
    [Rolling Production Service Images](/guides/rolling-prod-service-images/).
  - **Run-container images** are *not* `image:` fields anywhere; the driver resolves
    them at run time (`core::harness::resolve_run_image`). Pin them by setting
    `TCAB_CONTAINER_TAG` (and optionally `TCAB_CONTAINER_REGISTRY`) on the
    **dispatcher**, which forwards both into every driver `Job`. Left unset/`latest`
    the driver tracks the mutable `:latest`. Roll both sets in lockstep — same
    `:<git-sha>`, staging before prod — so the run images promote on the same flow as
    the services.

  If the registry is private, an `imagePullSecret` (referenced by
  `TCAB_K8S_IMAGE_PULL_SECRETS` for sandbox pods).
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
| `TCAB_K8S_*` (sandbox passthroughs) | no | `TCAB_K8S_NAMESPACE`, `TCAB_K8S_RUN_CPU_REQUEST`/`_LIMIT`, `TCAB_K8S_RUN_MEMORY_REQUEST`/`_LIMIT`, `TCAB_K8S_IMAGE_PULL_SECRETS`, `TCAB_K8S_POD_READY_TIMEOUT_SECONDS`, `TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS`, `TCAB_K8S_RUN_POD_PREFIX` — forwarded verbatim into each driver Job | per-variable |

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

### Queueing when the cluster is full

When more runs are dispatched than the cluster has capacity for, the surplus
sandbox pods sit `Pending` until the scheduler can place them. **This is not a
failure:** an unscheduled run waits its turn rather than erroring out, and the
time it spends queued for capacity is excluded from the run's recorded duration
(it was waiting, not running). Only once a pod is scheduled onto a node does the
`TCAB_K8S_POD_READY_TIMEOUT_SECONDS` clock start, so a genuinely broken pod
(`ImagePullBackOff`, a bad image, …) still fails promptly.

The scheduling wait is **unbounded by default**, which is what lets a busy
cluster absorb a large batch of runs. Set `TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS`
to a positive value only if you want to cap how long a run may queue — for
example to surface a pod whose resource requests no node can ever satisfy. `0`
(or unset) means wait forever. Right-size `TCAB_K8S_RUN_CPU_*`/`_MEMORY_*` so a
run's requests actually fit on a node; a request larger than any node is
unschedulable forever and will only ever queue.

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
   at them. The **`tcab-driver`** image carries the same Node/Playwright toolchain
   (plus `git`), because the driver seeds, builds, and load-checks each run's
   implementation in-process; only the auth, dispatcher, and artifact images stay
   slim and ship no browser. Set `TCAB_REFERENCE_BROWSER` yourself only to override
   that baked Chromium with an explicit binary (the backend forwards it to the
   driver).

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
A worked example of exactly this — backend and auth as stateless `Deployment`s
with the connection strings supplied by Secret — ships as the reusable
[`components/postgres`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/postgres)
component, applied per environment by the
[`overlays/azure-prod`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/overlays/azure-prod)
and
[`overlays/azure-staging`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/overlays/azure-staging)
overlays (Azure Database for PostgreSQL — Flexible Server); apply one instead of
`overlays/prod` / `overlays/staging`.

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

When the [internal ingress](#internal-ingress) is in play, the `tcab-web` console
and the four services are no longer reached pod-to-pod but **through ingress-nginx**,
which runs in its own `ingress-nginx` namespace and so is not admitted by the rules
above. The `components/internal-ingress` component therefore adds two more
default-deny exceptions, selecting the controller by its namespace's automatic
`kubernetes.io/metadata.name: ingress-nginx` label:

- **ingress-nginx → backend/auth/artifacts/arena** (on `8787`/`8789`/`8790`/`8791`)
  — routing the four service hostnames.
- **ingress-nginx → tcab-web** (on `8080`) — the only caller the console has; the
  ingress is what makes `console.tcab.testcabinet.ai` reach the pod at all.

These are **additive** — the base policies above are left intact. (They take effect
only on a `NetworkPolicy`-enforcing CNI such as Calico or Cilium.)

Everything else is denied. The sandbox pods themselves need **no** inbound access
except the driver's `exec`/preview connections, which Kubernetes routes over the
API server and pod network respectively; their egress is the model APIs and
package registries a run needs.

## Internal ingress

By default the services are `ClusterIP`-only and the web console isn't served
in-cluster at all — an operator runs `apps/web` locally against a
`kubectl port-forward`ed backend. That works for one operator at a debugging
laptop, but not for a team. The
[`components/internal-ingress`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/internal-ingress)
kustomize component closes that gap by serving the console in-cluster and exposing
it plus the four services over an **internal-only** ingress-nginx, so operators
reach prod by **browsing a private URL over the VPN**. It is included by the live
[`overlays/azure-prod`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/overlays/azure-prod)
overlay and is written reusable, so a future staging overlay adopts it with its own
hostnames.

The boundary is **never public.** ingress-nginx is installed with the Azure
internal-LB annotation, so its `Service` gets a **private VNet IP** — there is no
public `LoadBalancer`, no public `Ingress`, and no publicly resolvable FQDN. The
`*.testcabinet.ai` console/service names resolve only through an **Azure Private DNS
zone** that VPN clients see; off the VPN they do not resolve at all. The public
[gallery](/components/site/overview/) and [docs](/components/docs/overview/) stay on
Cloudflare Pages and are unaffected.

### What the component adds

The component carries only **app-level** resources — the controllers are a cluster
prerequisite (see [the runbook](#internal-ingress-prerequisites-controllers-dns-tls)):

- **`tcab-web`** — a `Deployment` + `ClusterIP` `Service` serving the console
  (`apps/web`) as a static SPA from the
  [`tcab-web` image](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/images/web.Dockerfile)
  (nginx, port `8080`). The single image is environment-agnostic — one build per
  git-sha, like the publisher image — so the backend/auth URLs are injected at
  **runtime**: the image's entrypoint `envsubst`s a `/config.js` from
  `TCAB_WEB_BACKEND_URL` / `TCAB_WEB_AUTH_URL`, and the SPA prefers that
  `window.__TCAB_CONFIG__` over its build-time `VITE_*` defaults. The console
  workload itself is factored into its own
  [`components/web`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/web)
  component (included here as a nested component) so it can be reused by any overlay
  that wants an in-cluster console without this component's ingress/cert/NetworkPolicy
  wiring. The **local k3d overlay deliberately does not include it** — locally the
  console runs from source (`npm run -w apps/web dev`) against a `kubectl
  port-forward`ed backend, so a UI edit hot-reloads instead of forcing an image
  rebuild + re-import.
- **Five host-per-service `Ingress` routes** (one `Ingress` each, no path-routing) —
  `console` → `tcab-web`, `api` → `tcab-backend:8787`, `auth` → `tcab-auth:8789`,
  `artifacts` → `tcab-artifacts:8790`, `arena` → `tcab-arena:8791`, all with
  `ingressClassName: nginx`. Each carries the nginx annotations the data plane
  needs: `proxy-body-size: "0"` (the artifact service streams run-tree tars and
  accepts uploads, which the default 1 MB cap would truncate),
  `proxy-read-timeout`/`proxy-send-timeout: "3600"` (the backend and arena serve
  long-lived NDJSON live streams the default 60 s timeout would sever), and
  `proxy-buffering: "off"` (flush stream chunks straight through).
- **A cert-manager `ClusterIssuer`** (`letsencrypt-internal`) issuing each host a
  real Let's Encrypt certificate over the ACME **production** directory, solved by
  **DNS-01 over Cloudflare** (`cert-manager.io/cluster-issuer` annotation → per-host
  TLS secret). DNS-01 is required because the hosts are internal-only: Let's Encrypt
  cannot reach an HTTP-01 token, but proving control of the `testcabinet.ai` zone via
  a TXT record needs no inbound. The solver reads a **Cloudflare API token with
  `Zone:DNS:Edit`** from the `cert-manager-cloudflare` Secret (key `api-token`).
- **Two additive `NetworkPolicy` rules** admitting the `ingress-nginx` namespace
  through the base default-deny — see [NetworkPolicy](#networkpolicy) above.

### Client-facing URL repointing

A second sharp edge the overlay fixes: the backend advertises the artifact and arena
base URLs to the console (via `GET /config`), and the base sets those to
cluster-internal DNS (`http://tcab-artifacts:8790` / `http://tcab-arena:8791`), which
a laptop on the VPN cannot resolve — so artifact and arena media would break even
with everything else routed. The `azure-prod` overlay therefore patches:

- the backend's `TCAB_ARTIFACTS_PUBLIC_URL` → `https://artifacts.tcab.testcabinet.ai` and
  `TCAB_ARENA_PUBLIC_URL` → `https://arena.tcab.testcabinet.ai`
  (`patch-backend-public-urls.yaml`), and
- the `tcab-web` pod's `TCAB_WEB_BACKEND_URL` → `https://api.tcab.testcabinet.ai` and
  `TCAB_WEB_AUTH_URL` → `https://auth.tcab.testcabinet.ai` (`patch-web-config.yaml`).

`TCAB_BACKEND_AUTH_URL` — the backend's **server-side** token-verify URL — is
deliberately **not** repointed; it stays the in-cluster `http://tcab-auth:8789`.
Only the **client-facing** URLs move to the https hostnames.

### Internal-ingress prerequisites (controllers, DNS, TLS)

The component carries app-level resources only; the controllers and the cloud-side
plumbing are a one-time cluster prerequisite, installed out of band. **Order
matters** — the DNS records can only be created once the ingress controller has its
internal LB IP:

1. **Install ingress-nginx (INTERNAL LB)** via Helm into its own `ingress-nginx`
   namespace (prod pins chart `4.15.1`), forcing an Azure internal LB so it gets a
   private VNet IP. Values:

   ```yaml
   controller:
     service:
       annotations:
         service.beta.kubernetes.io/azure-load-balancer-internal: "true"
       externalTrafficPolicy: Local
     ingressClassResource: { name: nginx, default: false }
   ```

   After it settles, read the assigned private IP — the DNS records point at it:

   ```sh
   kubectl -n ingress-nginx get svc ingress-nginx-controller \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}'   # prod: 10.224.0.9
   ```

   The LB IP lives in the **AKS node VNet** (`aks-vnet-*`, `10.224.0.0/12`), not the
   app VNet.

2. **Create the Azure Private DNS zone + records.** Prod uses a dedicated
   **`tcab.testcabinet.ai`** sub-zone (NOT a private `testcabinet.ai` zone, which
   would *shadow* the public zone for VPN clients and stop them resolving the public
   gallery/docs). Create the zone, **link it to both the AKS VNet and the app/VPN
   VNet** (virtual-network-link, registration disabled), and add **A records** for
   `console` / `api` / `auth` / `artifacts` / `arena` → the internal LB IP from
   step 1. The `_acme-challenge` TXT records (step 5) still live in the **public
   Cloudflare `testcabinet.ai` zone** — `tcab.` is only a private Azure zone, not a
   public delegation — so the `Zone:DNS:Edit` token covers them.

3. **Install cert-manager (with CRDs)** via Helm into the `cert-manager` namespace
   (prod pins `v1.20.3`). Two non-default flags are **load-bearing**:

   ```sh
   helm upgrade --install cert-manager jetstack/cert-manager \
     --namespace cert-manager --create-namespace --version v1.20.3 \
     --set crds.enabled=true \
     --set clusterResourceNamespace=tcab-prod \
     --set "extraArgs={--dns01-recursive-nameservers-only=true,--dns01-recursive-nameservers=1.1.1.1:53,1.0.0.1:53}"
   ```

   - `clusterResourceNamespace=tcab-prod` makes the **cluster-scoped** `ClusterIssuer`
     resolve the `cert-manager-cloudflare` Secret from `tcab-prod` (where keyvault-csi
     syncs it), instead of the `cert-manager` namespace.
   - `--dns01-recursive-nameservers*` points the DNS-01 self-check at **public**
     resolvers. This is required because the `tcab.testcabinet.ai` private zone is
     linked to the AKS VNet, so in-cluster DNS resolves those names to the private LB
     IP and has no public NS records — without this flag cert-manager loops on
     *"Could not determine authoritative nameservers for `_acme-challenge.…`"* and no
     cert ever issues. The CRDs must exist before the component's `ClusterIssuer`
     applies.

4. **Provision the Cloudflare DNS-01 token.** Mint a Cloudflare API token with
   `Zone:DNS:Edit` scoped to `testcabinet.ai` (the Pages-scoped publishing token
   cannot edit DNS records). Store it for cert-manager as the `cert-manager-cloudflare`
   Secret (key `api-token`) — prod adds it as a `cloudflare-dns-token` Key Vault secret
   synced via the
   [`components/keyvault-csi`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/keyvault-csi)
   `SecretProviderClass`, mirroring how the other secrets are added. (CSI gotcha: on a
   plain remount the driver does **not** reconcile an *existing* synced Secret — it
   neither picks up changed values nor adds new keys; a brand-new Secret materializes
   fine. **Secret auto-rotation** closes the gap for changed *values*: with it enabled
   on the AKS `azure-keyvault-secrets-provider` add-on, the driver polls Key Vault and
   reconciles updated values into the synced Secrets on its own (~2m), so a refreshed
   credential reaches the cluster without a restart. Enable it once per cluster with
   [`scripts/enable-secret-rotation.sh`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/scripts/enable-secret-rotation.sh)
   — it's AKS add-on config, not a Kubernetes object, so it can't live in the overlay.
   Adding a brand-new key to a Secret still needs `kubectl delete secret <name> &&
   kubectl rollout restart deploy/tcab-keyvault-sync`.)

5. **Apply the overlay** (`kubectl apply -k deployments/k8s/overlays/azure-prod`), then
   `kubectl rollout restart deploy/tcab-keyvault-sync -n tcab-prod` so the new
   `cert-manager-cloudflare` Secret materializes. cert-manager then completes the
   DNS-01 challenge with the Cloudflare token and issues the five certificates
   (`kubectl -n tcab-prod get certificate` → all `Ready=True`).

6. **Confirm VPN DNS resolution.** The OpenVPN config must make clients resolve the
   private zone (push Azure DNS `168.63.129.16`, or a resolver that sees the Private
   DNS zone). Validate from a connected client:
   `nslookup console.tcab.testcabinet.ai` should return the internal LB IP.

The Cloudflare token (step 4) and the Azure DNS zone (step 2) are independent and can
be prepared in parallel.

## Observability (in-cluster Grafana LGTM)

The default observability plane runs **in the cluster** rather than in a managed
metrics backend: the
[`components/observability`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/observability)
kustomize component adds a `tcab-lgtm` `StatefulSet` + `ClusterIP` `Service` (the
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one
collector + Tempo/Mimir/Loki + Grafana, with a `PersistentVolumeClaim` for
Grafana's state) and a `NetworkPolicy` admitting the services' and driver Jobs'
OTLP through the base default-deny. All four cloud overlays
(`overlays/{staging,prod,azure-staging,azure-prod}`) include it and set every
workload's `OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318` via their env
patch — the same stack local development runs, so staging/prod observability
mirrors local exactly. It carries no public Ingress; reach Grafana with
`kubectl port-forward svc/tcab-lgtm 3000:3000`. To send telemetry to Grafana
Cloud or an external collector instead, drop the component and set the endpoint to
that collector — see [Telemetry](/deployment/telemetry/).

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
  for staging and prod, tagged by `TCAB_ENV`. Enable it in both environments. The
  default is the in-cluster Grafana LGTM stack (the
  [`components/observability`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/observability)
  component), included by all four cloud overlays; see below.
