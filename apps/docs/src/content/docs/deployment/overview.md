---
title: Overview
---

This section covers standing up The Test Cabinet's long-running services as a
remote deployment on Kubernetes: a staging and a production environment, each a
namespace in a cluster. The guidance is reproducible by anyone running their own
instance.

To run the same services on one machine for development, see
[Running](/development/running/). Local development applies the same manifests to
a local [k3d](https://k3d.io) cluster, so a run is a Kubernetes `Job` there as it
is in the cloud. The public gallery runs on a plane of its own, covered by
[Public Gallery](/deployment/public-gallery/). This docs site and the per-run
playable builds are static and are covered by
[Releasing](/development/releasing/).

## Deployed components

| Thing                                                                  | Deployed as                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Backend](/components/backend/overview/) (`tcab-backend`)              | `StatefulSet` (1 replica) + `ClusterIP` `Service` + `PersistentVolumeClaim`; owns the run queue       |
| [Auth service](/components/auth/overview/) (`tcab-auth`)               | `StatefulSet` (1 replica) + `Service` + its own `PersistentVolumeClaim`                               |
| [Dispatcher](/components/dispatcher/overview/) (`tcab-dispatcher`)     | `Deployment` (1 replica), no `Service`; creates one driver `Job` per claimed run                      |
| [Driver](/components/driver/overview/) (`tcab-driver`)                 | One `Job` per run, created by the dispatcher; each creates a sandbox pod through the API and exits    |
| Publisher (`tcab-publisher`)                                           | One `Job` per publish, created by the dispatcher                                                      |
| [Artifact service](/components/artifacts/overview/) (`tcab-artifacts`) | `StatefulSet` (1 replica) + `Service` + `PersistentVolumeClaim`; serves produced run trees            |
| [Arena](/components/arena/overview/) (`tcab-arena`)                    | `Deployment` (1 replica) + `Service`; runs adversarial matches and tournaments                        |
| [Web console](/components/web/overview/) (`tcab-web`)                  | `Deployment` + `Service` serving a static bundle, reached over the VPN through the internal `Ingress` |
| [Gallery](/components/site/serving/) (`tcab-gallery`)                  | A Container App on the public plane; see [Public Gallery](/deployment/public-gallery/)                |
| Docs, per-run builds                                                   | Static Cloudflare Pages sites; see [Releasing](/development/releasing/)                               |
| [CLI](/components/cli/overview/) (`tcab`)                              | A local tool an operator installs; see [Building](/development/building/)                             |

## The control plane and the run plane

The services split into a control plane that is always on and a run plane that
exists for the duration of one run.

- The backend owns the run queue. A console enqueues a run at the backend; the
  backend records it, relays the run's live events back to the console, and
  stores the produced record. It keeps a database, an on-disk definition store,
  and a repository checkout it ingests from, and it renders reference
  screenshots with a headless browser at ingest. With its default embedded
  SQLite store it runs as a single-replica `StatefulSet` with a
  `PersistentVolumeClaim`. Pointing `TCAB_BACKEND_DATABASE_URL` at a managed
  PostgreSQL instance makes it a plain `Deployment`.
- The auth service keeps the accounts database. It stores Argon2id password
  hashes for user accounts in its own database (`TCAB_AUTH_DATABASE_URL`) and
  binds `TCAB_AUTH_BIND`, default `127.0.0.1:8789`, which a deployment overrides
  with a private-network interface. It takes the same shape as the
  backend, and the backend reaches it at `TCAB_BACKEND_AUTH_URL`.
- The dispatcher turns queued runs into `Job`s. The backend's job table is the
  source of truth, so the dispatcher holds no state. It claims queued runs with
  a shared service token the backend also holds and creates one driver `Job`
  each. It is a single-replica `Deployment` with no `Service` and no volume; it
  needs a `ServiceAccount` with RBAC to create and watch `Job`s and to read a
  dead driver pod's logs.
- The driver executes one run. Each driver pod is the trusted pod that creates
  one untrusted sandbox pod through the Kubernetes API, `exec`s the harness into
  it, and deletes it. Its `ServiceAccount` may manage pods and `pods/exec` in
  the run namespace. The per-run working tree is scratch, and the driver uploads
  the produced tree to the artifact service before it exits.
- The artifact service retains the produced bytes. The sandbox pod's disk is
  gone the moment the run ends, so the driver uploads the produced run tree to
  the artifact service, which serves it to the console for review. It runs under
  its own `ServiceAccount` with no Kubernetes API access. Artifact bytes flow
  from the driver to the artifact service to the console, and the backend
  reports where they live through `TCAB_ARTIFACTS_PUBLIC_URL`. The backend also
  calls the service over its own in-cluster `TCAB_ARTIFACTS_URL` to prune a
  deleted run's tree and to sweep the trees no run row references.

| Service          | Kubernetes shape                                                             | Persistent storage                          | External egress                                                |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Backend          | `StatefulSet` (1) + `Service` + `PVC`, or `Deployment` + external PostgreSQL | Database, definition store, ingest checkout | Cloudflare R2 uploads and the public projection                |
| Auth service     | `StatefulSet` (1) + `Service` + `PVC`, or `Deployment` + external database   | Its own accounts database                   | None                                                           |
| Dispatcher       | `Deployment` (1), no `Service`                                               | None                                        | None                                                           |
| Driver           | One `Job` per run                                                            | Scratch only                                | Model APIs and package registries, from inside the sandbox pod |
| Publisher        | One `Job` per publish                                                        | Scratch only                                | GitHub and Cloudflare Pages                                    |
| Artifact service | `StatefulSet` (1) + `Service` + `PVC`                                        | The produced run trees                      | None                                                           |
| Arena            | `Deployment` (1) + `Service`                                                 | None                                        | None                                                           |

## From a queued run to a Job

When a run is enqueued at the backend:

1. the dispatcher claims it from the queue and creates one driver `Job`, passing
   in the run's identity, a per-job token, and the sandbox-pod settings;
2. the driver pod resolves the test-case definition and references from the
   backend and creates a sandbox pod in its run namespace from the resolved
   run-container image, carrying the run's resource requests and limits,
   image-pull secrets, and `restartPolicy: Never`;
3. it waits for the sandbox pod to be `Running`, seeds the working tree into it,
   and `exec`s the harness session, streaming output back to the backend, which
   relays it to the watching console;
4. it copies the produced `/work` tree out of the sandbox pod, deletes the
   sandbox pod, and uploads the tree to the artifact service from its own disk;
5. it reports terminal status with the produced record, and the `Job` reaps
   itself after `TCAB_DISPATCHER_JOB_TTL_SECONDS`.

Publishing follows the same path with its own `Job`: the backend queues a publish
job, the dispatcher claims it, and one `tcab-publisher` `Job` downloads the run
tree from the artifact service and releases it to GitHub and Cloudflare Pages.

Three properties of this shape carry through the rest of the section. The
console talks to one backend URL, enqueueing runs and watching them, and never
addresses a dispatcher or a driver. The driver needs Kubernetes API access
rather than a container engine, so the sandbox is created with `create`, `exec`,
and `delete` on `Pod`. Each sandbox pod runs as the image's unprivileged user,
receives its working tree over the `exec` API, holds no API token of its own,
and is deleted when the run finishes.

## Environments

The same images run in every environment. What changes is the namespace they live
in, what they talk to, and their `TCAB_ENV` tag (`local`, `staging`, `prod`), so
[telemetry](/development/observability/) and logs from each can be told apart.
Each service binds its own port: backend `8787`, auth service `8789`, artifact
service `8790`, arena `8791`. In-cluster each is reached by its `Service` name.

| Environment | Purpose                                             | Control plane                       | Runs                                |
| ----------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Local       | Exercise the whole flow on one machine              | the services on a local k3d cluster | Per-run `Job`s in the local cluster |
| Staging     | A production-shaped environment to validate changes | the services in `tcab-staging`      | Per-run `Job`s in `tcab-staging`    |
| Prod        | The environment operators use                       | the services in `tcab-prod`         | Per-run `Job`s in `tcab-prod`       |

The local environment is documented under [Running](/development/running/). This
section is about the two remote environments. Staging and prod apply the same
base manifests so staging is a faithful rehearsal, differing in their namespace,
their own secrets, their hostnames, and their `TCAB_ENV` tag. The kustomize
overlays under `deployments/k8s/overlays/` are exactly that difference.

## Access

Reachability is the first line of access control. Every service is a `ClusterIP`
`Service` with no public `Ingress`, so only workloads and operators who can reach
the cluster network can use them. Operators reach that network through an
internal-only `Ingress` whose load balancer holds a private VNet IP, reachable
over the VPN and resolvable only through private DNS. A `NetworkPolicy` per
namespace restricts traffic to the components that need to talk to each other.
The full build is in
[Internal ingress](/deployment/kubernetes/internal-ingress/).

The backend opens every connection to the
[public plane](/deployment/public-gallery/), writing objects to the public bucket
and rows to the public projection. Those connections are outbound, so the cluster
keeps its VPN-only reachability while published runs reach the gallery.

On top of that boundary the [auth service](/components/auth/overview/) adds user
accounts, so the mutating run actions (push, review, publish) are attributed to a
person; the backend verifies each request's bearer token against it.
Registration is open within the cluster network, and reads stay open there too.
Deploy the auth service in the same namespace as the backend and point the
backend at it with `TCAB_BACKEND_AUTH_URL`.

On the VPN an operator opens the console at a private hostname; the console talks
to the backend and auth service at their own hostnames and pulls a pre-publish
run's artifact and arena media from theirs, all reported by the backend through
`GET /config`. For ad-hoc or off-VPN access, `kubectl port-forward` against the
`ClusterIP` services works; see
[Running](/development/running/#pointing-tcab-at-a-deployment) for pointing
`tcab` at either a private hostname or a forwarded port.

## Secrets

Every credential is a Kubernetes `Secret` mounted as environment variables or
files, created from your secret manager rather than committed. The set is:

- Harness API keys, in the Secret(s) named by
  `TCAB_DISPATCHER_DRIVER_SECRETS`. The dispatcher mounts them into each driver
  `Job`, and the run engine injects them into the sandbox pod.
- Harness subscription credentials, in the optional Secret named by
  `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET`, mounted read-only as files.
- The shared service token. The backend and the dispatcher must carry the same
  `TCAB_BACKEND_SERVICE_TOKEN` or the queue never drains.
- The backend's R2 credentials and its public-projection connection string, for
  publishing to the [public plane](/deployment/public-gallery/).
- The backend's OpenRouter key, `TCAB_OPENROUTER_API_KEY`, which its own
  completion calls ([model probes](/components/backend/api/#model-probes)) are
  billed to. It is mapped from the same vault secret as the drivers'
  `OPENROUTER_API_KEY`, so runs and probes spend one credit pool.
- The publisher's `GH_TOKEN` and `CLOUDFLARE_API_TOKEN`, in the Secret named by
  `TCAB_DISPATCHER_PUBLISHER_SECRETS`.

The auth service holds no third-party secret; it stores only password hashes in
its own database. Every file under `deployments/k8s/` carries placeholder
values, and the repo-root `.env.backend.example`,
`.env.auth.example`, `.env.dispatcher.example`, and `.env.artifacts.example`
remain the reference for every variable each service reads.

## Next steps

- [Kubernetes](/deployment/kubernetes/overview/): the cluster build, covering
  topology, prerequisites, overlays, and network policy.
- [Backups](/deployment/backups/): protecting the two irreplaceable databases.
- [Telemetry](/deployment/telemetry/): choosing and wiring a collector for
  staging and prod.
- [Running](/development/running/): the same manifests on k3d, for development.
