---
title: Overview
---

This section covers standing up The Test Cabinet's long-running **services** — the
[backend](/components/backend/overview/) (`tcab-backend`), the
[auth service](/components/auth/overview/) (`tcab-auth-service`), the
[dispatcher](/components/dispatcher/overview/) (`tcab-dispatcher`), and the
[artifact service](/components/artifacts/overview/) (`tcab-artifacts`) — as a
**remote** deployment on **Kubernetes**: a staging and a production environment,
each a namespace in a cluster. The guidance is written to be reproducible by anyone
running their own instance; there is nothing here specific to a private deployment.

To run the same services **entirely on one machine** for development — the local
mirror of everything below — see [Running](/development/running/) in the
Development section. Local development runs the *same* manifests on a local
[k3d](https://k3d.io) cluster, so a run is a Kubernetes `Job` there exactly as it
is in the cloud. This section is about the real, remote, cluster-based build.

For the **static** surfaces — the public [gallery](/components/site/overview/),
this [docs site](/components/docs/overview/), and the per-run playable builds —
see [Releasing](/development/releasing/) instead. Those are static Cloudflare
Pages sites with no servers to operate. This section is only about the services
that do.

## What gets deployed

| Thing | Deployed as | Covered by |
| ----- | ----------- | ---------- |
| [Backend](/components/backend/overview/) (`tcab-backend`) | A `StatefulSet` (1 replica) + `Service`, with a `PersistentVolumeClaim` for state; owns the run queue | This section |
| [Auth service](/components/auth/overview/) (`tcab-auth-service`) | A `StatefulSet` (1 replica) + `Service`, with its own `PersistentVolumeClaim` | This section |
| [Dispatcher](/components/dispatcher/overview/) (`tcab-dispatcher`) | A `Deployment` (1 replica), no `Service`; claims queued runs and creates one driver `Job` per run | This section |
| [Driver](/components/driver/overview/) (`tcab-driver`) | One Kubernetes `Job` **per run**, created by the dispatcher; each spawns a sandbox pod via the API and exits | This section |
| [Artifact service](/components/artifacts/overview/) (`tcab-artifacts`) | A `StatefulSet` (1 replica) + `Service` + `PersistentVolumeClaim`; serves produced run trees | This section |
| [Web console](/components/web/overview/) (`apps/web`) | A static bundle served to operators on the cluster network | This section |
| [Gallery](/components/site/overview/), [docs](/components/docs/overview/), per-run builds | Static Cloudflare Pages sites | [Releasing](/development/releasing/) |
| [CLI](/components/cli/overview/) (`tcab`), [Tauri app](/components/tauri/overview/) | Local tools an operator installs | Not deployed — see [Building](/development/building/) |

The [CLI](/components/cli/overview/) and [Tauri app](/components/tauri/overview/)
are runner/reporter tools an individual operator runs on their own machine; they
are not part of a deployment. The web console *is* part of one, but it is just a
static bundle — the stateful, always-on processes to operate are the backend, the
auth service, the dispatcher, and the artifact service.

## Why Kubernetes

A run does not execute in any always-on service; it executes in a **fresh,
throwaway container started for that one run** and discarded afterward (see
[Execution](/components/core/execution/) and
[Run Containers](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)).
That single fact — *a run's job is to launch a container* — is what shapes the
whole deployment, and it is exactly what Kubernetes exists to do.

So rather than treat the cluster as a place that merely *holds* a long-lived
worker, The Test Cabinet uses the cluster as its container runtime, one `Job` at a
time. A console enqueues a run at the backend; the **dispatcher** claims it and
creates one **driver** `Job`; that driver calls the **Kubernetes API** to create a
sandbox pod, streams the harness session in and out of it with the pod `exec` API,
copies the produced working tree out, and deletes the pod. Each run is a
first-class, schedulable `Job` the cluster places, isolates, and cleans up like any
other workload.

This removes the awkward part of the older design — a long-lived worker pool that
had to be a VM with a privileged container engine, registered and hand-scaled — and
replaces it with the cluster's native scheduler:

- **No nested container engine.** No pod needs a Docker/Podman daemon, no
  `privileged: true`, no Docker socket. The driver holds a Kubernetes
  `ServiceAccount` permitted to manage pods in one namespace, and nothing more.
- **The cluster schedules runs.** Each run is a `Job` with its own resource
  requests and limits, placed across nodes by the scheduler, instead of being
  packed onto whichever VM received the request. Concurrency scales with the queue
  admission cap plus available capacity — there is no pool to size by hand and no
  per-pod registration.
- **One private network for free.** In-cluster DNS and `ClusterIP` services give
  every component a stable private address with nothing exposed publicly — no mesh
  VPN to operate. `NetworkPolicy` is the access boundary.

## The control plane and the run plane

The services split cleanly into a **control plane** (always-on) and a **run plane**
(per-run, ephemeral), and that split drives every choice in this section.

- **The backend owns the run queue (control plane).** A console enqueues a run at
  the backend; the backend records it, relays the run's live events back to the
  console, and stores the produced record. It keeps a database, an on-disk
  definition store, and a repository checkout it ingests from, and it renders
  reference screenshots with a headless browser at ingest. With its default
  embedded **SQLite** store it runs as a `StatefulSet` pinned to a **single
  replica** (SQLite is single-writer) with a **`PersistentVolumeClaim`** and an
  image that includes a browser. Pointing `TCAB_BACKEND_DATABASE_URL` at a managed
  **PostgreSQL** instead lifts the single-replica and database-volume constraints
  (it can then be a plain `Deployment`). The details are in
  [Kubernetes: staging & prod](/deployment/kubernetes/#backend).
- **The auth service is a small stateful service (control plane).** It keeps its
  **own** database — separate from the backend's — of user accounts
  (`TCAB_AUTH_DATABASE_URL`, its own SQLite by default) and an HTTP listener
  (`TCAB_AUTH_BIND`, default `0.0.0.0:8789`); it renders nothing and has no egress.
  It hosts the same single-writer SQLite trade-off as the backend, so it is a
  single-replica `StatefulSet` with a `PersistentVolumeClaim`, or pointed at a
  managed database. The backend reaches it at `TCAB_BACKEND_AUTH_URL`.
- **The dispatcher turns queued runs into `Job`s (control plane).** It is a thin,
  stateless controller — the backend's job table is the source of truth, so it
  holds no state of its own. It claims queued runs (authenticating with a shared
  service token the backend also holds) and creates one driver `Job` each. It is a
  single-replica `Deployment` with **no** `Service` (it binds no socket) and **no**
  volume; its only requirement is a `ServiceAccount` with RBAC to create and watch
  `Job`s (and read a dead driver pod's logs). See
  [Kubernetes: staging & prod](/deployment/kubernetes/#dispatcher).
- **The driver executes one run (run plane).** Each run is one `Job` the dispatcher
  creates. Under the Kubernetes runtime the driver is the *trusted* pod that creates
  one *untrusted* sandbox pod per run via the API, `exec`s the harness into it, and
  deletes it. Its only requirement is a `ServiceAccount` with RBAC to manage pods
  (and `pods/exec`) in its run namespace. It keeps no persistent state — the per-run
  working tree is scratch — and uploads the produced tree to the artifact service
  before it exits. See [Kubernetes: staging & prod](/deployment/kubernetes/#driver-per-run-jobs).
- **The artifact service retains the produced bytes (data plane).** Because the
  sandbox pod's disk is gone the moment the run ends, the driver uploads the
  produced run tree (the playable build, proof and asset media) to the artifact
  service, which serves it to the console for review. It is a single-replica
  `StatefulSet` + `Service` + `PersistentVolumeClaim`, with its own `ServiceAccount`
  that has **no** API access. Artifact bytes never transit the backend; the backend
  only tells the console where they live (`TCAB_ARTIFACTS_PUBLIC_URL`). See
  [Kubernetes: staging & prod](/deployment/kubernetes/#artifact-service).

| Service | Kubernetes shape | Persistent storage | External egress |
| ------- | ---------------- | ------------------ | --------------- |
| Backend | `StatefulSet` (1) + `Service` + `PVC`, or `Deployment` + external PostgreSQL | **Yes** — database (SQLite, or external PostgreSQL), definition store, ingest checkout | Cloudflare R2 (snapshot upload) + the site's deploy hook |
| Auth service | `StatefulSet` (1) + `Service` + `PVC`, or `Deployment` + external DB | **Yes** — its own accounts database (SQLite, or external) | None |
| Dispatcher | `Deployment` (1), no `Service`; creates driver `Job`s via the API | None | None |
| Driver | One `Job` **per run**; spawns a sandbox pod per run via the API | Scratch only (ephemeral pod) | Model APIs + package registries (from inside the sandbox pod) |
| Artifact service | `StatefulSet` (1) + `Service` + `PVC` | **Yes** — the produced run trees | None |

## How a run becomes a Job

When a run is enqueued at the backend:

1. the **dispatcher** claims it from the queue and **creates one driver `Job`**,
   passing in the run's identity, a per-job token, and the sandbox-pod settings;
2. the **driver** pod resolves the test-case definition and references from the
   backend and **creates a sandbox pod** in its run namespace from the resolved
   run-container image, carrying the run's resource requests/limits, image-pull
   secrets, and a `restartPolicy: Never`;
3. it waits for the sandbox pod to be `Running`, then seeds the working tree into
   it and `exec`s the harness session, streaming output back to the backend (which
   relays it to the watching console) over the run's live event stream;
4. it copies the produced `/work` tree out of the sandbox pod, **uploads it to the
   artifact service**, and **deletes the sandbox pod**;
5. it reports terminal status with the produced record, and the `Job` reaps itself.

Three properties of this matter for the rest of the section:

- **The console talks to one backend URL only.** It enqueues a run and watches it;
  it never addresses a dispatcher or a driver. There is no per-pod registration.
- **The driver needs API access, not a container engine.** Creating the sandbox is
  Kubernetes API calls (`create`, `exec`, `delete` on `Pod`). The RBAC that permits
  exactly this — and the narrower dispatcher RBAC for `Job`s — is in
  [Kubernetes: staging & prod](/deployment/kubernetes/#rbac).
- **Each sandbox pod is isolated and ephemeral.** It runs as the image's
  unprivileged `node` user, gets its working tree copied in over the `exec` API (no
  shared volume, no host mount, no API token of its own), and is deleted when the
  run finishes. Egress and reachability are governed by `NetworkPolicy` at the
  namespace level.

## Environments

The same images run in every environment; what changes is the namespace they live
in, what they talk to, and their `TCAB_ENV` tag (`local`, `staging`, `prod`) so
[telemetry](/development/observability/) and logs from each can be told apart. By
default the services bind to distinct ports — backend `8787`, auth service `8789`,
artifact service `8790` — though in-cluster each is reached by its `Service` name
regardless (the dispatcher binds no socket).

| Environment | Purpose | Control plane | Runs |
| ----------- | ------- | ------------- | ---- |
| **Local** | Exercise the whole flow on one machine (development) | backend + auth + dispatcher + artifacts on a local k3d cluster | Per-run `Job`s in the local cluster |
| **Staging** | A production-shaped environment to validate changes | the four services in `tcab-staging` | Per-run `Job`s in `tcab-staging` |
| **Prod** | The environment operators actually use | the four services in `tcab-prod` | Per-run `Job`s in `tcab-prod` |

The **local** environment is a development convenience and is documented under
[Running](/development/running/), not here; it runs the *same* manifests on
[k3d](https://k3d.io), so a run is a `Job` there exactly as in the cloud — there is
no separate local code path any more. This section is about the two **remote**
environments: staging and prod are the *same* manifests — keep them identical so
staging is a faithful rehearsal — differing only in their namespace, scale, their
own secrets, and their `TCAB_ENV` tag. The
[kustomize overlays](/deployment/kubernetes/) under
`deployments/k8s/overlays/{staging,prod}` are exactly that difference. See
[Kubernetes: staging & prod](/deployment/kubernetes/).

## Access: the cluster network, plus accounts on it

**Reachability is the first line of access control.** Every service is a
`ClusterIP` `Service` (the dispatcher has none at all) with no public `Ingress`, so
only workloads and operators who can already reach the cluster network can use them.
A `NetworkPolicy` per namespace restricts traffic to the components that need to
talk to each other. As described under
[Backend authentication](/components/backend/overview/#authentication), on top of
that the [auth service](/components/auth/overview/) adds real **user
[accounts](/components/backend/overview/#accounts)** so that the mutating run
actions (push, review, publish) are attributed to a person — the backend verifies
each request's bearer token against the auth service.

This is an added identity layer, **not** a public surface: registration is open,
but the auth service is itself private, so "open self-registration" means *anyone
already on the cluster network* can create an account — there is no public sign-up
page and nothing reachable from the public internet. Reads stay open even within
the network. Deploy the auth service in the same namespace as the backend and point
the backend at it with `TCAB_BACKEND_AUTH_URL`.

The console's topology is correspondingly simple: it talks to **one backend URL**.
It enqueues runs and watches them there; the dispatcher and per-run driver `Job`s
do the work behind the backend, and the console reads a pre-publish run's playable
build and media from the artifact service at the URL the backend reports
(`TCAB_ARTIFACTS_PUBLIC_URL`). There is no worker list to maintain and nothing to
register one pod at a time.

Operators reach the web console from inside the cluster network:
`kubectl port-forward` for ad-hoc access, or an internal-only `Ingress` behind your
VPN/bastion for a standing one. Nothing here is ever given a public FQDN.

## Secrets and telemetry

- **Secrets** — harness API keys, the shared dispatcher service token, and the
  backend's R2 credentials, deploy-hook URL, and the `GITHUB_TOKEN`/Cloudflare token
  it uses when a run is published — are Kubernetes `Secret`s mounted as environment
  variables, **never committed**. The dispatcher mounts the harness keys into each
  driver `Job` (via `TCAB_DISPATCHER_DRIVER_SECRETS`), and the run engine injects
  them into the sandbox pod it creates. The backend and the dispatcher must carry
  the **same** `TCAB_BACKEND_SERVICE_TOKEN` or the queue never drains. The auth
  service holds no third-party secret; it stores only Argon2id password hashes in
  its own database, which the [backups](/deployment/backups/) page covers alongside
  the backend's. Every file under
  [`deployments/k8s/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s)
  is a placeholder template, matching the repo-root
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example),
  [`.env.auth.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.auth.example),
  [`.env.dispatcher.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.dispatcher.example),
  and
  [`.env.artifacts.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.artifacts.example),
  which remain the authoritative reference for every variable each service reads.
- **Telemetry** is opt-in and vendor-neutral and is configured the same way in
  every environment — by pointing the standard `OTEL_*` variables at a collector.
  The variables themselves are documented under
  [Observability](/development/observability/); choosing and wiring a collector for
  a deployment is covered in [Telemetry](/deployment/telemetry/).

Two operational concerns get their own pages because they apply across every
environment: keeping published runs safe ([Backups](/deployment/backups/)) and
seeing what the services are doing ([Telemetry](/deployment/telemetry/)).

## Where to go next

- [Kubernetes: staging & prod](/deployment/kubernetes/) — the full cluster build
  (namespace, RBAC, the four services, per-run `Job` scheduling), for both
  environments.
- [Running](/development/running/) — the local mirror: the same manifests on k3d,
  for development.
- [Backups](/deployment/backups/) — what's actually at risk (just the backend's
  database) and how to protect it.
- [Telemetry](/deployment/telemetry/) — choosing and wiring a collector for staging
  and prod.
