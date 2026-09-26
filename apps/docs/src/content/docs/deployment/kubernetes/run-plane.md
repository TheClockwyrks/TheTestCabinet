---
title: Run plane
---

The run plane turns a queued run into a Kubernetes `Job` and keeps the bytes that
`Job` produces: the [dispatcher](/components/dispatcher/overview/), the per-run
[driver](/components/driver/overview/) `Job`s and their sandbox pods, the publish
`Job`s, the [artifact service](/components/artifacts/overview/), and the
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
| `TCAB_DISPATCHER_MAX_INFLIGHT`                                                | no       | Queue-admission cap on concurrent runs                                                                                                                                                                                                                                                  | `8`                            |
| `TCAB_DISPATCHER_POLL_INTERVAL_SECONDS`                                       | no       | Back-off after an empty claim or a full cap                                                                                                                                                                                                                                             | `2`                            |
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
`TCAB_CONTAINER_IMAGE_*` overrides, `TCAB_ARTIFACTS_URL`, the `TCAB_GG_*` install
controls, the `OTEL_EXPORTER_OTLP_*` variables, and `TCAB_ENV`. Each is forwarded
only when it is set. Publish `Job`s receive `TCAB_ARTIFACTS_URL`,
`TCAB_GITHUB_ORG`, `TCAB_PAGES_PROJECT`, the same observability variables, and
`TCAB_ENV`.

Concurrency scales with the cluster: `TCAB_DISPATCHER_MAX_INFLIGHT` plus
available capacity admit runs, so there is no pool to size by hand.

## Driver Jobs

The driver is created per run as a `Job` and executes exactly one run. The `Job`
is one-and-done: `restartPolicy: Never` and `backoffLimit: 0`, so a failed driver
is not retried, and `ttlSecondsAfterFinished` reaps the terminated `Job` and its
pod. The `tcab-driver` image sets `TCAB_DRIVER_RUNTIME=kubernetes`, under which
the driver creates one untrusted sandbox pod through the Kubernetes API, `exec`s
the harness into it, copies the produced tree out, deletes the sandbox pod, and
uploads the tree to the artifact service before reporting terminal status.

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
run pod is precisely the mechanism that produces it. An earlier revision set the
limit equal to the request so a node's arithmetic was exact; the first run to
outgrow that ceiling was OOM-killed (`exit 137`) by its own cgroup, the outcome
the ceiling existed to prevent.

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
rather than `OOMKilled`, and just as dead. The limit was a certain kill at a fixed
ceiling regardless of node headroom; what remains is a kill only when the node is
genuinely out of memory. Closing that gap is a sizing job. The request must cover
the real peak so the scheduler never seats a run on a node that cannot hold it.
Size it from `container_memory_max_usage_bytes`, which the observability
component's cAdvisor scrape keeps, over a window wide enough to contain the rare
heavy case. The always-on services take the opposite treatment, memory request
equal to limit, because for them a kill is a restart rather than lost spend; see
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
Those cases do not fit an `8Gi` node whatever the manifest says: they no longer
die at the `4Gi` ceiling, but they are still evicted when the node runs short.
Running them needs nodes that can seat an `8Gi` request, and the request raised to
match. Raise it only to a value one node can still seat, since a request no node
can satisfy queues forever.

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
[validation](/components/core/validation/) item. Those are Node and browser
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
[live previews](/components/core/execution/)), and every run's produced tree is
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

## Publish Jobs

Publishing a run runs in its own `Job`. The backend queues a publish job, the
dispatcher claims it whenever `TCAB_PUBLISHER_IMAGE` is configured, and one
`tcab-publisher` `Job` downloads the run tree from the artifact service and
releases it with `gh` and `wrangler`. The publisher streams progress lines back
to the backend and reports its terminal result there, and the backend relays both
to a watching console.

The publisher needs no Kubernetes API access, so its `Job` names no
`ServiceAccount` and runs under the namespace default. Its credentials come from
the Secrets named by `TCAB_DISPATCHER_PUBLISHER_SECRETS`, which carry `GH_TOKEN`
and `CLOUDFLARE_API_TOKEN`. `TCAB_GITHUB_ORG` and `TCAB_PAGES_PROJECT` are
required on every environment, so each overlay names its own GitHub org and
Cloudflare Pages project. With no publisher image configured the dispatcher never
touches the publish queue and the run path is unaffected.

## Artifact service

The sandbox pod is ephemeral, so the produced run tree has to land somewhere
durable before the run is reported terminal. That is the artifact service: a
one-replica `StatefulSet` with a `ClusterIP` `Service` and a
`PersistentVolumeClaim` at `TCAB_ARTIFACTS_ROOT`, bound to `0.0.0.0:8790`
(`deployments/k8s/base/artifacts.yaml`). Each run's tree lives at
`<root>/<run-id>/`.

It runs under its own `ServiceAccount` with no Kubernetes API access. An upload
presents the driver's per-job token, which the service forwards to the backend
(`TCAB_BACKEND_URL`) as the token authority. Reads are ungated, since
browser-loaded media cannot present a token; the private-network boundary is what
gates them. A run-tree delete and the `GET /runs` tree listing present the shared
`TCAB_BACKEND_SERVICE_TOKEN`, and leaving that unset disables both routes.

The backend calls those two routes on the service's `ClusterIP` `Service` through
`TCAB_ARTIFACTS_URL`, and reports the console-facing base URL separately as
`TCAB_ARTIFACTS_PUBLIC_URL`. Artifact bytes flow driver to artifacts to console
without passing through the backend.

## Arena service

Adversarial matches and tournaments are CPU-bound in-process wasm, so they run on
the arena rather than the single-replica backend. It is a stateless `Deployment`
with a `ClusterIP` `Service`, its own `ServiceAccount` with no Kubernetes API
access, and real CPU requests and limits, bound to `0.0.0.0:8791`
(`deployments/k8s/base/arena.yaml`).

It runs exactly one replica: the in-flight tournament registry and the live
progress channel are in-memory and per-pod. It fetches every controller input
from the backend and persists finished tournaments and replays back to it. The
backend reports the console-facing base URL as `TCAB_ARENA_PUBLIC_URL`, and
serves published tournaments and replays itself; only execution lives on the
arena. A capacity semaphore (`TCAB_ARENA_MAX_CONCURRENT`, default `2`) answers
`503` past the cap rather than queueing. Scale the cap and the pod's CPU rather
than the replica count.
