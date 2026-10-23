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

| Thing                                                                   | Deployed as                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Backend](/components/backend/overview/) (`tcab-backend`)               | `Deployment` (2 replicas) on managed PostgreSQL + `ClusterIP` `Service`, each replica caching the definition store and ingest checkout; owns the run queue |
| [Dispatcher](/components/dispatcher/overview/) (`tcab-dispatcher`)      | `Deployment` (1 replica), no `Service`; creates one driver `Job` per claimed run and one publisher `Job` per publish                                       |
| [Driver](/components/driver/overview/) (`tcab-driver`)                  | One `Job` per run, created by the dispatcher; each creates a sandbox pod through the API and exits                                                         |
| Publisher (`tcab-publisher`)                                            | One `Job` per publish, created by the dispatcher                                                                                                           |
| [Artifacts service](/components/artifacts/overview/) (`tcab-artifacts`) | `Deployment` (2 replicas) + `Service`, stateless; the run trees in a private Azure Blob container and the public dataset in Cloudflare R2                  |
| [Repos service](/components/repos/overview/) (`tcab-repos`)             | `Deployment` (2 replicas) + `Service`, stateless; the run bundles in a private Azure Blob container                                                        |
| [Arena](/components/arena/overview/) (`tcab-arena`)                     | `Deployment` (1 replica) + `Service`; runs adversarial matches and tournaments                                                                             |
| [Console](/components/web/overview/) (`tcab-web`)                       | `Deployment` (2 replicas) + `Service` serving a static bundle at `/` of the environment's origin                                                           |
| [Edge](/deployment/kubernetes/edge/) (`tcab-cloudflared`)               | `Deployment` holding the Cloudflare Tunnel that routes the origin to the services above                                                                    |
| [Gallery](/components/site/serving/)                                    | Cloudflare Pages, two Workers and the R2 bucket; see [Public Gallery](/deployment/public-gallery/)                                                         |
| Docs, per-run builds                                                    | Static Cloudflare Pages sites; see [Releasing](/development/releasing/)                                                                                    |
| [CLI](/components/cli/overview/) (`tcab`)                               | A local tool an operator installs; see [Building](/development/building/)                                                                                  |
| [Operator client](/components/client/overview/)                         | Desktop and Android bundles of a tag, loading the console's origin                                                                                         |

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
  PostgreSQL instance makes it a plain `Deployment`, the shape of both remote
  environments.
- The dispatcher turns queued runs into `Job`s. The backend's job table is the
  source of truth, so the dispatcher holds no state. It claims queued runs with
  a shared service token the backend also holds and creates one driver `Job`
  each. It is a single-replica `Deployment` with no `Service` and no volume; it
  needs a `ServiceAccount` with RBAC to create and watch `Job`s and to read a
  dead driver pod's logs.
- The driver executes one run. Each driver pod is the trusted pod that creates
  one untrusted sandbox pod through the Kubernetes API, `exec`s the harness into
  it, and deletes it. Its `ServiceAccount` may manage pods and `pods/exec` in
  the run namespace. The per-run working tree is scratch: the driver uploads the
  produced tree to the artifacts service and the implementation's git bundle to
  the repos service before it exits.
- The artifacts service owns every byte a run produces and every byte the
  public reads. The run trees live in a private Azure Blob container per
  environment, written as the driver uploads them and served to the console
  through the service; the public dataset lives in the Cloudflare R2 bucket,
  which only this service writes. It runs under its own `ServiceAccount` with
  no Kubernetes API access, authenticates to Blob as a managed identity, and is
  stateless, so it runs two replicas. The backend calls it over
  its in-cluster `TCAB_ARTIFACTS_URL` to prune a deleted run's tree, to sweep
  the trees no run row references, and to write the public snapshot.
- The repos service owns each run's implementation as a git bundle in a
  private Blob container of its own, serves it for download, and at publish
  creates the run's public GitHub repository and pushes to it. It takes the same
  shape as the artifacts service.

| Service           | Kubernetes shape                                                             | Persistent storage                                     | External egress                                                |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Backend           | `Deployment` + external PostgreSQL, or `StatefulSet` (1) + `Service` + `PVC` | Database, definition store, ingest checkout            | OpenRouter, for list prices and model probes                   |
| Dispatcher        | `Deployment` (1), no `Service`                                               | None                                                   | None                                                           |
| Driver            | One `Job` per run                                                            | Scratch only                                           | Model APIs and package registries, from inside the sandbox pod |
| Publisher         | One `Job` per publish                                                        | Scratch only                                           | Cloudflare Pages                                               |
| Artifacts service | `Deployment` (2) + `Service`                                                 | Azure Blob (run trees), Cloudflare R2 (public dataset) | Azure Blob, Cloudflare R2                                      |
| Repos service     | `Deployment` (2) + `Service`                                                 | Azure Blob (run bundles)                               | Azure Blob, GitHub                                             |
| Arena             | `Deployment` (1) + `Service`                                                 | None                                                   | None                                                           |
| Console           | `Deployment` (2) + `Service`                                                 | None                                                   | None                                                           |
| Edge              | `Deployment` (2), no `Service`                                               | None                                                   | Cloudflare, the tunnel                                         |

A planned disruption, a deploy or a node drain, leaves every run to finish.
The run pods carry a budget that holds a drain until they finish, and the
services restart with graceful termination, one replica at a time where they
run two. See [Node drains](/deployment/kubernetes/run-plane/#node-drains) and
[Planned disruption](/deployment/kubernetes/control-plane/#planned-disruption).

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
   sandbox pod, runs code analysis over the tree, commits the model's work on
   top of the seed commit, and uploads the tree as a tar to the artifacts
   service and the repository as a bundle to the repos service;
5. it reports terminal status with the produced record, and the `Job` reaps
   itself after `TCAB_DISPATCHER_JOB_TTL_SECONDS`.

Publishing follows the same path with its own `Job`. A completed,
validator-rated run is published automatically: the backend queues a publish
job, the dispatcher admits it in the publish lane, and one `tcab-publisher`
`Job` fetches the build output from the artifacts service, deploys it to the
per-run Cloudflare Pages project, asks the repos service to create and push the
public repository, and reports both links to the backend. The backend then
marks the run published, has the artifacts service copy the run's media to R2,
writes the run's document and the updated index objects through it, and mints
the run's short code. See [Publish Jobs](/deployment/kubernetes/run-plane/#publish-jobs).

Three properties of this shape carry through the rest of the section. The
console talks to one origin, enqueueing runs and watching them at `/api/`, and
never addresses a dispatcher or a driver. The driver needs Kubernetes API access
rather than a container engine, so the sandbox is created with `create`, `exec`,
and `delete` on `Pod`. Each sandbox pod runs as the image's unprivileged user,
receives its working tree over the `exec` API, holds no API token of its own,
and is deleted when the run finishes.

## Environments

The same images run in every environment. What changes is the namespace they live
in, what they talk to, and their `TCAB_ENV` tag (`local`, `staging`, `prod`), so
[telemetry](/development/observability/) and logs from each can be told apart.
Each service binds its own port: backend `8787`, artifacts service `8790`,
arena `8791`, repos service `8792`, console `8080`. In-cluster each is reached
by its `Service` name.

| Environment | Purpose                                             | Control plane                       | Runs                                |
| ----------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Local       | Exercise the whole flow on one machine              | the services on a local k3d cluster | Per-run `Job`s in the local cluster |
| Staging     | A production-shaped environment to validate changes | the services in `tcab-staging`      | Per-run `Job`s in `tcab-staging`    |
| Prod        | The environment operators use                       | the services in `tcab-prod`         | Per-run `Job`s in `tcab-prod`       |

The local environment is documented under [Running](/development/running/). This
section is about the two remote environments. Staging and prod apply the same
base manifests so staging is a faithful rehearsal, differing in their namespace,
their own secrets, their hostnames, their object stores, and their `TCAB_ENV`
tag. The kustomize overlays under `deployments/k8s/overlays/` are exactly that
difference.

## Delivery

Each `microservice-*` repository's pipeline builds that service's image on
every gated push to `master` and `staging` and pushes it to
`testcabinet.azurecr.io` as `<name>:<commit>`; `microservice-driver`'s run
also builds the run-container images. The superrepo's Azure pipeline
(`azure-pipelines.yml`) is the route a deploy set takes into both remote
environments: a push to `staging` or `master` runs the gates, mirrors the
commit to GitHub, and rolls the matching cluster onto the set the commit's
submodule pointers name, then deploys the docs site. See
[The microservice images](/development/releasing/#the-microservice-images).
The two environments take different routes through it:

- **Staging** is the workspace template's `deploy` stage, on `staging`. It
  pins every image of the `staging` overlay with `scripts/ci/pin-images.sh`
  to the commit the superrepo's submodule pointer for its repository names,
  applies the overlay, waits on the backend and then on every other workload,
  and undoes what failed.
- **Prod** is the project's `prod` stage, on `master`:
  `scripts/ci/deploy-environment.sh prod <sha>`, which pins the `prod` overlay
  the same way, applies it, and waits on every workload together.

Rolling an environment is therefore bumping a repository's submodule pointer
and merging to the environment's branch. See
[Deploying](/deployment/kubernetes/overview/#deploying).

The registry holds only what an environment can use. Its tier has no retention
policy, so each deployment ends by purging it: the images both environments'
deploy sets pin, those of the set just deployed and each repository's newest
stay, and every other go. A run image whose inputs are unchanged is not
rebuilt for a new `microservice-driver` commit but retagged from the last
build, which stays under its inputs tag, so a commit that changes no run image
costs the registry nothing and the build minutes. The CI images the gates run inside
are kept while a live branch pins them and purged by the CI-images pipeline
after each of its builds. `scripts/ci/README.md` describes both purges.

The pipeline's deploy identity may write only the application namespace, so the
few cluster-scoped objects an environment needs are a one-time bootstrap applied
by a cluster administrator. See
[Cluster prerequisites](/deployment/kubernetes/overview/#cluster-prerequisites)
and [Deploying](/deployment/kubernetes/overview/#deploying).

## Access

Nothing in a cluster is reachable from outside it except through its
Cloudflare Tunnel. Every service is a `ClusterIP` `Service` with no `Ingress`,
no load balancer and no public IP; a `cloudflared` `Deployment` in the
namespace holds an outbound tunnel whose ingress rules route one public
hostname per environment to the services by path. Cloudflare Access sits in
front of that hostname and admits a person through Microsoft Entra ID, and
every request that crosses the edge carries a signed assertion the backend,
artifacts and arena services verify themselves. A `NetworkPolicy` per
namespace restricts traffic to the components that need to talk to each other.
The full build is in [Edge](/deployment/kubernetes/edge/); the identity
contract is in [Identity](/components/auth/overview/).

An operator opens the console at `https://console.testcabinet.ai` (staging:
`https://console.staging.testcabinet.ai`) and signs in on the Microsoft login
page. The console reaches the backend at `/api/`, media at `/artifacts/` and
the arena at `/arena/` of the same origin. The CLI reaches the same backend at
the origin's `/api` path with an Access credential; see
[Running](/development/running/#pointing-tcab-at-a-deployment). The artifacts
service opens every connection to the [public plane](/deployment/public-gallery/),
writing the public dataset to the R2 bucket, and the repos service pushes to
GitHub; both are outbound, so the cluster keeps its tunnel-only reachability
while published runs reach the gallery.

## Secrets

Every credential is a Kubernetes `Secret` mounted as environment variables or
files, created from your secret manager rather than committed. The set is:

- Harness API keys, in the Secret(s) named by
  `TCAB_DISPATCHER_DRIVER_SECRETS`. The dispatcher mounts them into each driver
  `Job`, and the run engine injects them into the sandbox pod.
- Harness subscription credentials, in the optional Secret named by
  `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET`, mounted read-only as files.
- The shared service token. The backend and the dispatcher must carry the same
  `TCAB_BACKEND_SERVICE_TOKEN` or the queue never drains; the artifacts and
  repos services hold it too, for the routes only the backend may call.
- The artifacts service's R2 credentials, for writing the public dataset to the
  [public plane](/deployment/public-gallery/). Its Blob access, and the repos
  service's, is a managed identity rather than a secret.
- The backend's OpenRouter key, `TCAB_OPENROUTER_API_KEY`, which its own
  completion calls ([model probes](/components/backend/api/#model-probes)) are
  billed to. It is mapped from the same vault secret as the drivers'
  `OPENROUTER_API_KEY`, so runs and probes spend one credit pool.
- The repos service's GitHub token, which creates and pushes the per-run public
  repositories.
- The publisher's `CLOUDFLARE_API_TOKEN`, in the Secret named by
  `TCAB_DISPATCHER_PUBLISHER_SECRETS`, for the per-run Pages deploy.
- The tunnel's credentials file, in the `tcab-cloudflared` Secret; see
  [The tunnel](/deployment/kubernetes/edge/#the-tunnel).
- The Grafana admin credentials, in the `tcab-grafana-admin` Secret.

Two credentials of the edge live at Cloudflare rather than in the cluster: the
Entra client secret of the Access identity provider and the Access service
token, both recorded in Key Vault. See [Edge](/deployment/kubernetes/edge/).
Every file under `deployments/k8s/` carries placeholder values, and each
service repository's `crates/<name>/src/config.rs` is the reference for every
variable it reads.

## Next steps

- [Kubernetes](/deployment/kubernetes/overview/): the cluster build, covering
  topology, prerequisites, the cluster bootstrap, the pipeline's deploy,
  overlays, and network policy.
- [Edge](/deployment/kubernetes/edge/): the tunnel, the Access applications and
  the hostnames.
- [Backups](/deployment/backups/): protecting the run records.
- [Telemetry](/deployment/telemetry/): choosing and wiring a collector for
  staging and prod.
- [Running](/development/running/): the same manifests on k3d, for development.
