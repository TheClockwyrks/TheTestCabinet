---
title: Run plane
---

The run plane turns a queued run into a Kubernetes `Job` and keeps the bytes that
`Job` produces: the [dispatcher](/components/dispatcher/overview/), the per-run
[driver](/components/driver/overview/) `Job`s and their sandbox pods, the publish
`Job`s, the [artifacts service](/components/artifacts/overview/), the
[repos service](/components/repos/overview/), and the
[arena](/components/arena/overview/).

## RBAC

Run execution involves two in-cluster identities, each a namespaced `Role` bound
to its own `ServiceAccount` (`deployments/k8s/base/rbac.yaml`). Neither creates
Deployments, Services, or RBAC objects, and neither reaches outside its
namespace. Each pod runs under its `ServiceAccount`, and the in-cluster
Kubernetes client picks up the mounted token, so no kubeconfig is needed.

The dispatcher (`tcab-dispatcher`) claims queued runs, creates one `Job` per run,
watches them, reads a dead driver pod's logs, and deletes the sandbox pods that
driver orphaned. It creates no pods directly.

| Resource          | Verbs                                      | Why                                                                                                                                                                       |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`/`jobs`    | `create`, `get`, `list`, `watch`, `delete` | create the per-run driver `Job`, watch it to completion, delete it                                                                                                        |
| `core`/`pods`     | `get`, `list`, `delete`                    | find the `Job`'s driver pod; reap the sandbox pods a `SIGKILL`ed driver could not delete itself (see [sandbox reaping](/components/dispatcher/overview/#sandbox-reaping)) |
| `core`/`pods/log` | `get`                                      | surface a dead driver pod's logs in the run's failure detail                                                                                                              |

The `delete` verb is for sandbox pods, not driver pods: the reaper's selector
pins the driver's `managed-by` label alongside the job id, so it cannot match a
driver `Job`'s own pod. A deployment that points the driver at a different
sandbox namespace (`TCAB_K8S_NAMESPACE`) must grant the same pod `list` and
`delete` there too; otherwise reaping fails in that namespace, which is logged
and never fatal, leaving the sandbox's `activeDeadlineSeconds` as the only
backstop.

The driver (`tcab-driver`) runs inside each `Job` and is the trusted process that
creates the untrusted sandbox pod. The dispatcher names this `ServiceAccount` on
every `Job` it creates.

| Resource           | Verbs                             | Why                                                                             |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------- |
| `core`/`pods`      | `create`, `get`, `list`, `delete` | start the sandbox pod, wait for it to be `Running`, delete it when the run ends |
| `core`/`pods/exec` | `get`, `create`                   | seed the working tree and run the harness session in the sandbox pod            |

Both verbs on `pods/exec` are required. The driver's Kubernetes client execs over
a WebSocket, which the API server authorizes as a `get` on the subresource;
`create` covers the SPDY exec path. A `Role` carrying only one of them fails the
transport it does not cover.

The driver's own `delete` only covers the runs it survives to the end of. A
driver killed by `SIGKILL` leaves its sandbox behind, which is why the dispatcher
reaps above and why each sandbox carries an `activeDeadlineSeconds`
(`TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS`, default 24h) as the last-resort
backstop. See [sandbox lifetime](/components/driver/overview/#sandbox-lifetime).

The dispatcher needs no `secrets` rule. It references the driver and publisher
Secrets by name on the `Job` it creates, and the kubelet projects them into the
pod.

## Dispatcher

The dispatcher is a stateless one-replica `Deployment` with no `Service`, since
it binds no socket (`deployments/k8s/base/dispatcher.yaml`). It polls the
backend's run queue, claims a queued run, and creates one driver `Job` for it.
Keep it at one replica: claims are atomic, so a second replica only duplicates
work.

| Variable                                                                      | Required | Purpose                                                                                                                                                                                                                                                                                 | Default                        |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `TCAB_BACKEND_URL`                                                            | yes      | The backend `Service`, e.g. `http://tcab-backend:8787`                                                                                                                                                                                                                                  | —                              |
| `TCAB_BACKEND_SERVICE_TOKEN`                                                  | yes      | Shared service token authenticating the claim. The backend must carry the same value                                                                                                                                                                                                    | —                              |
| `TCAB_DRIVER_IMAGE`                                                           | yes      | The `tcab-driver` image each `Job` runs                                                                                                                                                                                                                                                 | —                              |
| `TCAB_DISPATCHER_NAMESPACE`                                                   | no       | Namespace the `Job`s are created in                                                                                                                                                                                                                                                     | the dispatcher's own namespace |
| `TCAB_DISPATCHER_DRIVER_SA`                                                   | no       | `ServiceAccount` named on every driver `Job`                                                                                                                                                                                                                                            | the namespace default          |
| `TCAB_DISPATCHER_MAX_INFLIGHT`                                                | no       | Cap on concurrent driver `Job`s, the run lane. Publish `Job`s are counted apart                                                                                                                                                                                                         | `8`                            |
| `TCAB_DISPATCHER_MAX_PUBLISH_INFLIGHT`                                        | no       | Cap on concurrent publish `Job`s, the publish lane. Runs are counted apart                                                                                                                                                                                                              | `8`                            |
| `TCAB_DISPATCHER_POLL_INTERVAL_SECONDS`                                       | no       | Back-off after a tick that admits nothing                                                                                                                                                                                                                                               | `2`                            |
| `TCAB_DISPATCHER_JOB_TTL_SECONDS`                                             | no       | TTL after which a finished `Job` is garbage-collected                                                                                                                                                                                                                                   | `300`                          |
| `TCAB_DISPATCHER_DRIVER_CPU_REQUEST` / `_MEMORY_REQUEST`                      | no       | Requests on the driver container. They keep the driver pod out of the `BestEffort` QoS class, where it is evicted and OOM-killed first, and the memory request is the node's reservation for the driver                                                                                 | `100m` / `2Gi`                 |
| `TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT`                                         | no       | A memory limit on the driver container. Unset by default, deliberately: a memory limit is enforced by `SIGKILL`, and a driver OOM-killed mid-run destroys a run that has already paid for its API calls. Set it only when a namespace `LimitRange` or quota forces one                  | —                              |
| `TCAB_DISPATCHER_DRIVER_CPU_LIMIT`                                            | no       | The CPU limit on the driver container. The post-run toolchain sizes its worker pools from the CPU the container is allowed, so without a limit a large node multiplies the driver's memory footprint. Over-limit CPU is throttled, never killed. A blank value leaves the CPU unbounded | `2`                            |
| `TCAB_DISPATCHER_DRIVER_SECRETS`                                              | no       | Comma-separated `Secret` names mounted into each driver `Job` with `envFrom`, carrying the harness API keys                                                                                                                                                                             | —                              |
| `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET`                                  | no       | `Secret` of harness subscription credential files, mounted read-only into each driver `Job`                                                                                                                                                                                             | —                              |
| `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR`                                     | no       | Where that Secret is mounted, forwarded to the driver                                                                                                                                                                                                                                   | `/var/run/tcab/subscription`   |
| `TCAB_DISPATCHER_DRIVER_AUTH_MODE`                                            | no       | Locks the harness auth mode for every run (`auto`, `subscription`, `api-key`)                                                                                                                                                                                                           | per-run selection              |
| `TCAB_PUBLISHER_IMAGE`                                                        | no       | The `tcab-publisher` image each publish `Job` runs. Unset disables the publish path                                                                                                                                                                                                     | —                              |
| `TCAB_DISPATCHER_PUBLISHER_SECRETS`                                           | no       | Comma-separated `Secret` names mounted into each publish `Job` with `envFrom`                                                                                                                                                                                                           | —                              |
| `TCAB_DISPATCHER_PUBLISHER_CPU_REQUEST` / `_MEMORY_REQUEST` / `_MEMORY_LIMIT` | no       | Requests and the memory limit on each publish `Job`'s container. A publisher runs no toolchain, so `TCAB_DISPATCHER_PUBLISHER_CPU_LIMIT` is unset                                                                                                                                       | `100m` / `1Gi` / `1Gi`         |

The dispatcher also forwards a set of variables into each `Job` verbatim without
interpreting them: `TCAB_K8S_NAMESPACE`, `TCAB_K8S_RUN_SERVICE_ACCOUNT`,
`TCAB_K8S_IMAGE_PULL_SECRETS`, the `TCAB_K8S_RUN_CPU_*` and
`TCAB_K8S_RUN_MEMORY_*` pairs, `TCAB_K8S_POD_READY_TIMEOUT_SECONDS`,
`TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS`, `TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS`,
`TCAB_K8S_RUN_POD_PREFIX`,
`TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG` with the per-image
`TCAB_CONTAINER_IMAGE_*` overrides, `TCAB_ARTIFACTS_URL`, `TCAB_REPOS_URL`, the
`TCAB_GG_*` install controls, the `OTEL_EXPORTER_OTLP_*` variables, and
`TCAB_ENV`. Each is forwarded only when it is set. Publish `Job`s receive
`TCAB_ARTIFACTS_URL`, `TCAB_REPOS_URL`, `TCAB_PAGES_PROJECT`, the same
observability variables, and `TCAB_ENV`.

Concurrency scales with the cluster: `TCAB_DISPATCHER_MAX_INFLIGHT` plus
available capacity admit runs, so there is no pool to size by hand.
Publishes are admitted through a lane of their own, so a publish starts while
runs are queued or the run cap is full. See
[Admission lanes](/components/dispatcher/overview/#admission-lanes).

## Driver Jobs

The driver is created per run as a `Job` and executes exactly one run. The `Job`
is one-and-done: `restartPolicy: Never` and `backoffLimit: 0`, so a failed driver
is not retried, and `ttlSecondsAfterFinished` reaps the terminated `Job` and its
pod. The `tcab-driver` image sets `TCAB_DRIVER_RUNTIME=kubernetes`, under which
the driver creates one untrusted sandbox pod through the Kubernetes API, `exec`s
the harness into it, copies the produced tree out, deletes the sandbox pod, and
uploads what the run produced before reporting terminal status.

The uploads are two, both authenticated by the per-job token the dispatcher
passed in:

- the run tree as a tar, `POST /runs/{id}/artifacts` on the artifacts service
  (`TCAB_ARTIFACTS_URL`), which writes it to the environment's private Blob
  container as it arrives;
- the implementation as a git bundle, `POST /runs/{id}/bundle` on the repos
  service (`TCAB_REPOS_URL`). The driver commits the model's work on top of the
  seed commit, with the commit message the contract defines, and writes
  `git bundle --all` after code analysis has run on the local tree.

The harness API keys arrive through `TCAB_DISPATCHER_DRIVER_SECRETS`: those
Secrets are mounted into the `Job` with `envFrom`, so the carrier of third-party
keys is the Secret set rather than a per-pod injection. Subscription credentials
arrive as files under `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR` when that Secret
is configured, and the mount is optional so a missing Secret never wedges
API-key-only driver pods.

### Sizing sandbox pods

`TCAB_K8S_RUN_CPU_*` and `TCAB_K8S_RUN_MEMORY_*` scope each sandbox pod so the
scheduler can place it and one heavy run cannot monopolise a node's CPU. The
shipped values are `500m`/`2` for CPU and a `4Gi` memory request with **no memory
limit**.

A run pod is never given a memory limit. A memory limit is a cgroup ceiling the
kernel enforces by `SIGKILL`: a sandbox that reaches it is dead that instant,
deterministically, however much memory the node still has free. A run may hold a
sandbox for hours and spend real money on harness API calls the whole time, so a
sandbox OOM-killed mid-run destroys a run that has already paid for every one of
them. That is the one failure the deployment must never produce, and a limit on a
run pod is precisely the mechanism that produces it.

The request does the work instead, and it must be sized to the real peak of the
heaviest case the deployment runs:

- The scheduler packs a node by requests, so a node admits a sandbox only when
  the whole `4Gi` is actually there.
- A request keeps the pod out of `BestEffort`, where it would be the first thing
  the kubelet evicts and the kernel OOM-kills.
- A sandbox that grows past its request is not killed for doing so. It spends
  memory the node was not holding for it, and survives whenever the node actually
  has that memory spare.

Removing the limit does not make node memory pressure harmless. If the node
itself runs short, the kubelet evicts the pod furthest above its request first,
and the kernel's OOM killer weighs a large resident set heavily, so a sandbox that
has outgrown its request on a full node is still the likely victim: `Evicted`
rather than `OOMKilled`, and just as dead. Closing that gap is a sizing job. The
request must cover the real peak so the scheduler never seats a run on a node
that cannot hold it. Size it from `container_memory_max_usage_bytes`, which the
observability component's cAdvisor scrape keeps, over a window wide enough to
contain the rare heavy case. The always-on services take the opposite treatment,
memory request equal to limit, because for them a kill is a restart rather than
lost spend; see
[memory ceilings](/deployment/kubernetes/overview/#memory-ceilings).

CPU is oversubscribed deliberately. A container over its CPU limit is throttled
rather than killed, so the failure mode is a slower run, which is worth the
density.

The memory request is charged in whole nodes. Node allocatable is what remains
after the kubelet's reservation, and the DaemonSets take a further slice: an AKS
`Standard_D2ps_v6` offers 5766Mi allocatable of 7.7Gi capacity and the DaemonSets
request around 984Mi of it, leaving roughly 4782Mi schedulable and seating
exactly one `4Gi` sandbox pod per node. A 16Gi node seats three. Read the figure
for the nodes in hand:

```sh
kubectl get nodes -o custom-columns=NAME:.metadata.name,ALLOCATABLE:.status.allocatable.memory
```

The heaviest cases need more than `4Gi`, and a dual-contouring `double` variant
wants around `8Gi`, which the `local` overlay's `patch-dispatcher.yaml` reserves.
Those cases do not fit an `8Gi` node whatever the manifest says: they are
evicted when the node runs short. Running them needs nodes that can seat an
`8Gi` request, and the request raised to match. Raise it only to a value one
node can still seat, since a request no node can satisfy queues forever.

`TCAB_K8S_RUN_MEMORY_LIMIT` is honoured when set, for a namespace whose
`LimitRange` or `ResourceQuota` refuses pods without one. Set it far above any
real peak.

### Driver pod reservation

The driver runs in its own pod and follows the same rule:
`TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST` defaults to `2Gi` and
`TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT` is unset. A driver killed after the harness
session has finished but before it reports terminal status destroys a run that
has already paid for every one of its API calls, so nothing on the driver may be
a mechanism that kills it.

The request is sized against the post-run work, not against relaying the session.
Once the sandbox is gone the driver runs the case's own toolchain over the
collected tree on its own filesystem: the `[build]` install, the
[toolchain commands](/testing/end-to-end/manifests/), the build the smoke check
serves, and a headless Chromium for that smoke check and for every scripted
[validation](/components/driver/validation/) item. Those are Node and browser
processes in the driver's own cgroup, and they are what the reservation has to
cover.

`TCAB_DISPATCHER_DRIVER_CPU_LIMIT` defaults to `2` and is what keeps that
footprint predictable on any node. Node sizes a worker pool from the CPU its
cgroup is allowed, so an unlimited driver container on a large node fans `vitest`,
`tsc` and the bundler out across every core the node has and multiplies its own
memory footprint. The limit makes the driver's peak a property of the pod rather
than of the machine it landed on, and over-limit CPU is throttled rather than
killed, which is why the driver carries a CPU limit and no memory limit.

The reservation is charged in nodes as well. A `4Gi` sandbox pod plus a `2Gi`
driver exceeds what an 8Gi node can schedule, so the driver lands on a different
node than the sandbox it drives and the two can never contend for one node's
memory.

### Queueing when the cluster is full

When more runs are dispatched than the cluster has capacity for, the surplus
sandbox pods sit `Pending` until the scheduler can place them. An unscheduled run
waits its turn, and the time it spends queued for capacity is excluded from the
run's recorded duration. The `TCAB_K8S_POD_READY_TIMEOUT_SECONDS` clock starts
only once a pod is scheduled onto a node, so a pod that cannot start
(`ImagePullBackOff`, a bad image) still fails promptly.

The scheduling wait is unbounded by default, which lets a busy cluster absorb a
large batch of runs. Set `TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS` to a positive
value to cap how long a run may queue, for example to surface a pod whose
resource requests no node can satisfy. Size `TCAB_K8S_RUN_CPU_*` and
`TCAB_K8S_RUN_MEMORY_*` so a run's requests fit on a node.

### Sandbox-to-driver channel

The sandbox pod reaches the driver pod by IP over two flows: an asset-generation
run with a viewer attached streams preview frames back to the driver (see
[live previews](/components/driver/execution/)), and every run's produced tree is
collected over a listener the driver opens for the transfer (see the
[driver](/components/driver/overview/#artifacts)). The driver's own pod IP is
wired in through the downward API on the `Job`:

```yaml
env:
  - name: TCAB_K8S_POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
```

Preview streaming is best-effort, and a missed frame is skipped. Collection is
not: it fails the run if the tree cannot be transferred whole, and it requires
the pod IP, so a driver `Job` without it cannot collect a run. The
`tcab-allow-driver-from-sandbox` NetworkPolicy admits both flows on clusters
that enforce policies.

## Node drains

A run pod that is evicted destroys its run. The driver `Job` is
`backoffLimit: 0` and the sandbox pod has no controller, so neither is ever
recreated, and the model spend the run had incurred is lost with it. Runs are
unscheduled and start at any hour, so no maintenance window lines up with them.
A drain therefore waits for the run pods on a node to finish rather than evicting
them.

### The run pod budget

The `tcab-run-pods` `PodDisruptionBudget` (`deployments/k8s/base/run-pods-pdb.yaml`)
refuses the eviction of every run pod in the namespace:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: tcab-run-pods
spec:
  minAvailable: 1000000
  unhealthyPodEvictionPolicy: IfHealthyBudget
  selector:
    matchExpressions:
      - key: app.kubernetes.io/managed-by
        operator: In
        values: [tcab-dispatcher, tcab-driver]
```

The selector covers the driver and publish `Job` pods, labelled `managed-by:
tcab-dispatcher`, and the sandbox pods, labelled `managed-by: tcab-driver`. The
budget takes an absolute integer `minAvailable` because that is the one form the
disruption controller computes for these pods: the sandbox pod is bare, and a
`Job` has no scale subresource, so `maxUnavailable` and percentages resolve to no
expected count. The integer sits far above any number of run pods the namespace
can hold, so the budget is never met and allows zero disruptions.

`IfHealthyBudget` keeps a run pod that is not `Ready` under the same protection.
A finished pod is outside any budget, so a driver pod waiting out
`TCAB_DISPATCHER_JOB_TTL_SECONDS` never holds a drain.

### Node pool upgrade settings

Every node pool that can seat a run pod carries these upgrade settings, which
`scripts/configure-node-pools.sh --env <prod|staging>` applies (see
[Cluster prerequisites](/deployment/kubernetes/overview/#cluster-prerequisites)):

| Setting                   | Value  | Why                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `drainTimeoutInMinutes`   | `1440` | The AKS maximum, above the longest run and equal to the sandbox's 24h deadline      |
| `undrainableNodeBehavior` | Cordon | A node still holding a run pod at the timeout is set aside and the upgrade moves on |
| `maxSurge`                | `10%`  | Surge nodes take new runs while the drained nodes finish theirs                     |
| `maxUnavailable`          | `0`    | Capacity never drops below the pool's size during an upgrade                        |

An upgrade cordons a node, so no new run lands on it, and retries each eviction
the budget refuses until the node's run pods have finished. The node then
empties and takes the new image. An upgrade of a busy pool takes as long as the
longest run on it, which is the intended cost.

A node that still holds a run pod when the timeout elapses stays cordoned,
labelled `kubernetes.azure.com/upgrade-status=Quarantined`, on its old image.
Once its run pods have finished, `scripts/configure-node-pools.sh --env <env>
--release-quarantined` deletes each empty quarantined node and scales its pool
back to its count, so the replacement node starts on the current image.

### What each guard covers

| Disruption                                | Guard                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A node-image or Kubernetes upgrade drain  | The run pod budget and the pools' drain timeout                                                                   |
| An operator's `kubectl drain`             | The run pod budget                                                                                                |
| Cluster autoscaler scale-down             | `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` and the budget                                          |
| Node pressure, node loss, spot preemption | None that keeps the run; [sandbox reaping](/components/dispatcher/overview/#sandbox-reaping) and the death report |

The `safe-to-evict` annotation every run pod carries is read by the cluster
autoscaler alone. It keeps the autoscaler from choosing a node with a run pod
for scale-down, and an upgrade drain or `kubectl drain` ignores it.

## Publish Jobs

Publishing a run runs in its own `Job`. A run publishes automatically when it
completes validator-rated, and an operator publishes the rest; either way the
backend queues a publish job, the dispatcher claims it whenever
`TCAB_PUBLISHER_IMAGE` is configured and fewer than
`TCAB_DISPATCHER_MAX_PUBLISH_INFLIGHT` publish `Job`s are running, and one
`tcab-publisher` `Job` releases the run:

1. It fetches the build output from the artifacts service
   (`GET /runs/{id}/tree.tar`) over `TCAB_ARTIFACTS_URL` with its
   per-publish-job token.
2. It deploys that output to the per-run Cloudflare Pages project
   (`TCAB_PAGES_PROJECT`) with `wrangler pages deploy`, under the run's branch
   alias.
3. It calls `POST /runs/{id}/publish` on the repos service
   (`TCAB_REPOS_URL`), which creates the run's public GitHub repository, pushes
   the bundle's `main` and answers the URL. The route is idempotent.
4. It reports both links to the backend.

The backend then marks the run published, has the artifacts service copy the
run's media from Blob to R2 (`POST /runs/{id}/publish-media`), writes the run's
document and the updated index objects through the artifacts service, and mints
the run's short code. The gallery reads those objects at runtime, so no site
rebuild follows. The publisher streams progress lines back to the backend and
reports its terminal result there, and the backend relays both to a watching
console.

The publisher needs no Kubernetes API access, so its `Job` names no
`ServiceAccount` and runs under the namespace default. Its one credential is the
`CLOUDFLARE_API_TOKEN` in the Secrets named by
`TCAB_DISPATCHER_PUBLISHER_SECRETS`; the GitHub token is the repos service's
own. `TCAB_PAGES_PROJECT` is required on every environment, so each overlay
names its own Cloudflare Pages project. With no publisher image configured the
dispatcher never touches the publish queue and the run path is unaffected.

## Artifacts service

The sandbox pod is ephemeral, so the produced run tree has to land somewhere
durable before the run is reported terminal. That is the artifacts service: a
stateless `Deployment` with a `ClusterIP` `Service`, bound to `0.0.0.0:8790`
(`deployments/k8s/base/artifacts.yaml`), over two object stores. The run trees
live in the environment's private Azure Blob container, and the public dataset
(the documents, media, index objects and short-code objects the gallery reads)
in the environment's Cloudflare R2 bucket, which only this service writes. No
`PersistentVolumeClaim` and no `StatefulSet`: the service holds nothing a
restart loses, and it runs two replicas so a planned disruption of one leaves
the other serving (see
[Planned disruption](/deployment/kubernetes/control-plane/#planned-disruption)).

It runs under its own `ServiceAccount` with no Kubernetes API access. Blob
access is a user-assigned managed identity per environment, holding Storage Blob
Data Contributor on the container and federated to the `ServiceAccount` through
workload identity, as the backend's database identity is (see
[PostgreSQL](/deployment/kubernetes/postgres/)); the pod carries the
`azure.workload.identity/use: "true"` label. The R2 bucket takes the
`TCAB_R2_*` credentials, from the Secret keyvault-csi materializes.

| Variable                                          | Purpose                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `TCAB_ARTIFACTS_BLOB_ACCOUNT`, `_BLOB_CONTAINER`  | The storage account and private container the run trees are written to                          |
| `TCAB_R2_*`                                       | The public bucket's endpoint, name and credentials                                              |
| `TCAB_BACKEND_URL`                                | The backend (`http://tcab-backend:8787`) a per-job or per-publish-job token is verified against |
| `TCAB_BACKEND_SERVICE_TOKEN`                      | The shared service token the backend's own calls present                                        |
| `TCAB_ACCESS_TEAM_DOMAIN`, `TCAB_ACCESS_AUDIENCE` | The Access application the service verifies an edge request's assertion against                 |

An upload presents the driver's per-job token, which the service forwards to
the backend as the token authority, and is streamed to Blob as it arrives. A
read from the console arrives through the edge at `/artifacts/` and carries the
Access assertion; the service answers by streaming the object or by redirecting
to a short-lived signed URL, its choice per route. The backend's calls, the
tree delete, the `GET /runs` listing, `publish-media` and the `PUT /public/{key}`
snapshot writes, present the shared service token over `TCAB_ARTIFACTS_URL`.

## Repos service

The repos service keeps each run's implementation as a git bundle: a stateless
`Deployment` with a `ClusterIP` `Service`, bound to `0.0.0.0:8792`
(`deployments/k8s/base/repos.yaml`), over a private Blob container of its own,
with `git` on its image. It takes the artifacts service's shape exactly: its own
`ServiceAccount` with no API access, a managed identity on its container, and two
replicas.

| Variable                                          | Purpose                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TCAB_REPOS_BLOB_ACCOUNT`, `_BLOB_CONTAINER`      | The storage account and private container the bundles are written to                                        |
| `TCAB_GITHUB_ORG`, `TCAB_GITHUB_TOKEN`            | The organization the per-run public repositories are created in, and the token that creates and pushes them |
| `TCAB_BACKEND_URL`, `TCAB_BACKEND_SERVICE_TOKEN`  | As for the artifacts service                                                                                |

The driver uploads a bundle with its per-job token; the publisher's
`POST /runs/{id}/publish` presents its per-publish-job token; the backend's
bundle read and delete present the service token. The service sits behind no
edge path: a console's bundle download is answered by the backend, which
verifies the Access assertion and fetches the bundle over the cluster network.
Its outbound traffic is the Blob container and GitHub.

## Arena service

Adversarial matches and tournaments are CPU-bound in-process wasm, so they run on
the arena rather than the backend. It is a stateless `Deployment`
with a `ClusterIP` `Service`, its own `ServiceAccount` with no Kubernetes API
access, and real CPU requests and limits, bound to `0.0.0.0:8791`
(`deployments/k8s/base/arena.yaml`).

It runs exactly one replica: the live progress channel is per-pod, and one
arena owns resuming the unfinished tournaments the backend records. It fetches
every controller input from the backend and records each tournament and its
matches through it as they complete, as the [arena](/components/arena/overview/)
page states. The
console reaches it through the edge at `/arena/`, and the arena verifies the
assertion on each request with the same two `TCAB_ACCESS_*` variables as the
backend; the backend serves published tournaments and replays itself, so only
execution lives on the arena. A capacity semaphore (`TCAB_ARENA_MAX_CONCURRENT`,
default `2`) answers `503` past the cap rather than queueing. Scale the cap and
the pod's CPU rather than the replica count.
