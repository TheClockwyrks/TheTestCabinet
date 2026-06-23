---
title: Overview
---

This section covers standing up The Test Cabinet's three long-running **services**
— the [backend](/components/backend/overview/) (`tcab-backend`), the
[worker](/components/worker/overview/) (`tcab-worker`), and the
[auth service](/components/auth/overview/) (`tcab-auth-service`) — as a **remote**
deployment on **Kubernetes**: a staging and a production environment, each a
namespace in a cluster. The guidance is written to be reproducible by anyone
running their own instance; there is nothing here specific to a private
deployment.

To run the same services **entirely on one machine** for development — the local
mirror of everything below — see [Running](/development/running/) in the
Development section. Local development does not need a cluster: a worker run on a
laptop uses the host's own container runtime directly. This section is about the
real, remote, cluster-based build.

For the **static** surfaces — the public [gallery](/components/site/overview/),
this [docs site](/components/docs/overview/), and the per-run playable builds —
see [Releasing](/development/releasing/) instead. Those are static Cloudflare
Pages sites with no servers to operate. This section is only about the services
that do.

## What gets deployed

| Thing | Deployed as | Covered by |
| ----- | ----------- | ---------- |
| [Backend](/components/backend/overview/) (`tcab-backend`) | A `StatefulSet` (1 replica) + `Service`, with a `PersistentVolumeClaim` for state | This section |
| [Worker](/components/worker/overview/) (`tcab-worker`) | A `StatefulSet` whose pods spawn each run as a **separate pod via the Kubernetes API** | This section |
| [Auth service](/components/auth/overview/) (`tcab-auth-service`) | A `StatefulSet` (1 replica) + `Service`, with its own `PersistentVolumeClaim` | This section |
| [Web console](/components/web/overview/) (`apps/web`) | A static bundle served to operators on the cluster network | This section |
| [Gallery](/components/site/overview/), [docs](/components/docs/overview/), per-run builds | Static Cloudflare Pages sites | [Releasing](/development/releasing/) |
| [CLI](/components/cli/overview/) (`tcab`), [Tauri app](/components/tauri/overview/) | Local tools an operator installs | Not deployed — see [Building](/development/building/) |

The [CLI](/components/cli/overview/) and [Tauri app](/components/tauri/overview/)
are runner/reporter tools an individual operator runs on their own machine; they
are not part of a deployment. The web console *is* part of one, but it is just a
static bundle — the only stateful, always-on processes to operate are the
backend, the workers, and the auth service.

## Why Kubernetes

A run does not execute in the worker; it executes in a **fresh, throwaway
container the worker starts for that one run** and discards afterward (see
[Execution](/components/core/execution/) and
[Run Containers](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)).
That single fact — *the worker's job is to launch containers* — is what shapes
the whole deployment, and it is exactly what Kubernetes exists to do.

So rather than treat the cluster as a place that merely *holds* the worker, the
worker uses the cluster as its container runtime. When the worker selects the
Kubernetes runtime (`TCAB_WORKER_RUNTIME=kubernetes`), it does not run
Docker-in-a-pod; it calls the **Kubernetes API** to create a run pod, streams the
harness session in and out of it with the pod `exec` API, copies the produced
working tree out, and deletes the pod. Each run is a first-class, schedulable pod
the cluster places, isolates, and cleans up like any other workload.

This removes the awkward part of the older design — a worker that had to be a VM
with a privileged container engine of its own — and replaces it with the
cluster's native one:

- **No nested container engine.** The worker pod needs no Docker/Podman daemon,
  no `privileged: true`, no Docker socket. It holds a Kubernetes `ServiceAccount`
  permitted to manage pods in one namespace, and nothing more.
- **The cluster schedules runs.** Run pods carry their own resource requests and
  limits and are placed across nodes by the scheduler, instead of being packed
  onto whichever VM received the request.
- **One private network for free.** In-cluster DNS and `ClusterIP` services give
  every component a stable private address with nothing exposed publicly — no
  mesh VPN to operate. `NetworkPolicy` is the access boundary.

## The three services on Kubernetes

The three services have different hosting needs, and those differences drive
every choice in this section.

- **The worker manages run pods.** It is a stateless HTTP service that talks to
  the Kubernetes API to create, `exec` into, and delete a pod per run. Its only
  requirement is a `ServiceAccount` with RBAC to manage pods (and `pods/exec`,
  `pods/log`) in its run namespace. It keeps no database and needs no persistent
  volume; the per-run working tree it collects is scratch under
  `TCAB_WORK_DIR`/`TCAB_WORKER_OUT_DIR` (an `emptyDir` is enough).
- **The backend is a (mostly) stateful service.** It keeps a database, an on-disk
  definition store, and a repository checkout it ingests from, and it renders
  reference screenshots with a headless browser at ingest. With its default
  embedded **SQLite** store it runs as a `StatefulSet` pinned to a **single
  replica** (SQLite is single-writer) with a **`PersistentVolumeClaim`** and an
  image that includes a browser. Pointing `TCAB_BACKEND_DATABASE_URL` at a
  managed **PostgreSQL** instead lifts the single-replica and database-volume
  constraints (it can then be a plain `Deployment`). The details are in
  [Kubernetes: staging & prod](/deployment/kubernetes/#backend).
- **The auth service is a small stateful service.** It keeps its **own** database
  — separate from the backend's — of user accounts (`TCAB_AUTH_DATABASE_URL`, its
  own SQLite by default) and an HTTP listener (`TCAB_AUTH_BIND`, default
  `0.0.0.0:8789`); it renders nothing and has no egress. It hosts the same
  single-writer SQLite trade-off as the backend, so it is a single-replica
  `StatefulSet` with a `PersistentVolumeClaim`, or pointed at a managed database.
  The backend reaches it at `TCAB_BACKEND_AUTH_URL`.

| Service | Kubernetes shape | Persistent storage | External egress |
| ------- | ---------------- | ------------------ | --------------- |
| Worker | `StatefulSet` + headless `Service`; spawns a run pod per run via the API | Scratch only (`emptyDir`) | Model APIs + package registries (from inside run pods); GitHub & Cloudflare when it pushes |
| Backend | `StatefulSet` (1 replica) + `Service` + `PVC`, or `Deployment` + external PostgreSQL | **Yes** — database (SQLite, or external PostgreSQL), definition store, ingest checkout | Cloudflare R2 (snapshot upload) + the site's deploy hook |
| Auth service | `StatefulSet` (1 replica) + `Service` + `PVC`, or `Deployment` + external DB | **Yes** — its own accounts database (SQLite, or external) | None |

## Run pods: how the worker spawns containers

When a run is submitted, the worker:

1. resolves the test-case definition and references from the backend;
2. **creates a run pod** in its run namespace from the resolved run-container
   image, carrying the run's resource requests/limits, image-pull secrets, and a
   `restartPolicy: Never`;
3. waits for the pod to be `Running`, then seeds the working tree into it and
   `exec`s the harness session, streaming output back onto the run's live event
   stream;
4. copies the produced `/work` tree out of the pod;
5. **deletes the pod.**

Two properties of this matter for the rest of the section:

- **The worker needs API access, not a container engine.** The whole interaction
  is Kubernetes API calls (`create`, `exec`, `delete` on `Pod`). The RBAC that
  permits exactly this — and nothing else — is in
  [Kubernetes: staging & prod](/deployment/kubernetes/#rbac).
- **Each run pod is isolated and ephemeral.** It runs as the image's unprivileged
  `node` user, gets its working tree copied in over the `exec` API (no shared
  volume, no host mount), and is deleted when the run finishes. Egress and
  reachability are governed by `NetworkPolicy` at the namespace level, the
  Kubernetes-native equivalent of per-container network rules.

## Environments

The same images run in every environment; what changes is the namespace they
live in, what they talk to, and their `TCAB_ENV` tag (`local`, `staging`,
`prod`) so [telemetry](/development/observability/) and logs from each can be
told apart. By default the services bind to distinct ports — backend `8787`,
worker `8788`, auth service `8789` — though in-cluster each is reached by its
`Service` name regardless.

| Environment | Purpose | Backend | Auth service | Workers |
| ----------- | ------- | ------- | ------------ | ------- |
| **Local** | Exercise the whole flow on one machine (development) | A process (or container) on `localhost` | A process on `localhost` (`127.0.0.1:8789`) | A process on the host, using the host's own container runtime |
| **Staging** | A production-shaped environment to validate changes | `StatefulSet` in `tcab-staging` | `StatefulSet` in `tcab-staging` | A `StatefulSet`, one or a few replicas |
| **Prod** | The environment operators actually use | `StatefulSet` in `tcab-prod` | `StatefulSet` in `tcab-prod` | A `StatefulSet`, replicas sized to demand |

The **local** environment is a development convenience and is documented under
[Running](/development/running/), not here; locally the worker uses the
[CLI container runtime](/components/core/execution/) (Docker/Podman on the host)
rather than the Kubernetes one. This section is about the two **remote**
environments: staging and prod are the *same* manifests — keep them identical so
staging is a faithful rehearsal — differing only in their namespace, scale, their
own secrets, and their `TCAB_ENV` tag. See
[Kubernetes: staging & prod](/deployment/kubernetes/).

## Access: the cluster network, plus accounts on it

**Reachability is the first line of access control.** Every service is a
`ClusterIP` (or headless) `Service` with no public `Ingress`, so only workloads
and operators who can already reach the cluster network can use them. A
`NetworkPolicy` per namespace restricts traffic to the components that need to
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
the network. Deploy the auth service in the same namespace as the backend and
point the backend at it with `TCAB_BACKEND_AUTH_URL`.

That has one consequence worth stating up front, because it shapes the worker
topology: a [worker's jobs are held per-instance](/components/worker/overview/) —
`POST /runs` returns a job id you then poll on the *same* worker, and the
[web console](/components/web/overview/) adds workers **by URL, one at a time**. A
worker "pool" is therefore a set of **individually addressable** instances, never
a single load-balanced endpoint. This is exactly what a `StatefulSet` behind a
**headless `Service`** provides: each pod gets a stable DNS name
(`tcab-worker-0.tcab-worker.<namespace>.svc`, `-1`, …) you register one at a
time. Do **not** put workers behind a load-balancing `Service` — a run submitted
through one address must be polled on that same pod.

Operators reach the web console and the per-worker addresses from inside the
cluster network: `kubectl port-forward` for ad-hoc access, or an internal-only
`Ingress` behind your VPN/bastion for a standing one. Nothing here is ever given
a public FQDN.

## Secrets and telemetry

- **Secrets** — harness API keys, the `GITHUB_TOKEN` and Cloudflare token used
  when a worker pushes a run, and the backend's R2 credentials and deploy-hook URL
  — are Kubernetes `Secret`s mounted as environment variables, **never committed**.
  The worker propagates the harness keys into each run pod it creates. The auth
  service holds no third-party secret; it stores only Argon2id password hashes in
  its own database, which the [backups](/deployment/backups/) page covers
  alongside the backend's. Every file under
  [`deployments/k8s/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s)
  is a placeholder template, matching the repo-root
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example)
  and
  [`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example),
  which remain the authoritative reference for every variable each service reads.
- **Telemetry** is opt-in and vendor-neutral and is configured the same way in
  every environment — by pointing the standard `OTEL_*` variables at a collector.
  The variables themselves are documented under
  [Observability](/development/observability/); choosing and wiring a collector
  for a deployment is covered in [Telemetry](/deployment/telemetry/).

Two operational concerns get their own pages because they apply across every
environment: keeping published runs safe ([Backups](/deployment/backups/)) and
seeing what the services are doing ([Telemetry](/deployment/telemetry/)).

## Where to go next

- [Kubernetes: staging & prod](/deployment/kubernetes/) — the full cluster build
  (namespace, RBAC, the three services, run-pod scheduling), for both
  environments.
- [Running](/development/running/) — the local mirror: the backend, a worker, and
  the web console together on one machine, for development.
- [Backups](/deployment/backups/) — what's actually at risk (just the backend's
  database) and how to protect it.
- [Telemetry](/deployment/telemetry/) — choosing and wiring a collector for
  staging and prod.
