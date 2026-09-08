---
title: Overview
---

The dispatcher is a stateless controller that turns the
[backend](/components/backend/overview/)'s queues into Kubernetes work. It
claims a queued run and creates one [driver](/components/driver/overview/) `Job`
to execute it, and claims a queued publish and creates one publisher `Job` to
release it. The backend's job tables are the source of truth, so the dispatcher
holds no durable state of its own.

The dispatcher sits entirely behind the backend. A console enqueues work at the
backend and never addresses the dispatcher. Concurrency scales with queue
admission and available cluster capacity.

## The control loop

The dispatcher runs one loop forever. Each tick:

1. Reconcile against the live cluster: list the `Job`s this dispatcher owns
   (selected by their `app.kubernetes.io/managed-by` label), count the
   non-terminal ones as the in-flight total, report any driver-pod death the
   driver itself could not, and reap the sandbox pods a dead driver orphaned
   (see [Sandbox reaping](#sandbox-reaping)). Counting from the cluster rather
   than from an in-memory tally is what makes a restart safe.
2. Admit while the in-flight total is under `TCAB_DISPATCHER_MAX_INFLIGHT`:
   claim the oldest queued run job (`POST /jobs/next`) and create one driver
   `Job` for it. The backend hands jobs back in enqueue order across harnesses,
   skipping any it is holding back (see [Queue order](#queue-order)). When the
   run queue is empty and a publisher image is configured, claim the oldest
   queued publish job instead and create one publisher `Job`. Both kinds carry
   the same `managed-by` label, so one in-flight cap covers both.
3. Let each finished `Job` reap itself (`ttlSecondsAfterFinished`).

A tick that admits a job loops straight back, so the queue keeps draining while
capacity remains. An empty queue or a full cap backs off for the poll interval.

The dispatcher authenticates its claims with a shared service token
(`TCAB_BACKEND_SERVICE_TOKEN`, which the backend also holds). The claim is
atomic, so the backend hands each job to exactly one dispatcher.

The dispatcher is the bridge between the backend's queues and the cluster's
scheduler. Executing a run, resolving a definition, and storing a record all
belong to other components.

## Backend-enforced admission rules

Two admission rules are enforced by the backend at the claim, not by the
dispatcher.

- Per-harness maximum parallelism. The backend hands back only a job whose
  harness has fewer than its configured limit of runs already in flight, holding
  the rest in the `pending` state until a slot frees. See
  [Harnesses](/components/core/harnesses/#per-harness-configuration).
- One game-jam entry per jam and model. The backend holds a
  [game-jam](/testing/game-jam/overview/) job back while another run of the same
  jam by the same model is in flight under any harness, so a model's jam entries
  run one at a time and each is briefed with the previous one's README.

## Queue order

The backend hands jobs back in the order they were enqueued. Each job takes a
monotonic queue position, `job.queue_seq`, when it is inserted, and the claim
orders by that position rather than by the enqueue timestamp. A timestamp cannot
order a batch, because every run of one `POST /jobs/batch` shares a single one,
and being stored as an RFC 3339 string with a variable-length subsecond part it
does not always compare chronologically either.

The consequence is that a batch runs in the order the console listed it, and
that is the whole mechanism by which anything upstream controls execution order:
nothing in the dispatcher, the driver, or the queue needs to know why a run was
enqueued, because emitting is choosing.

Both consoles exploit that by emitting a case's repeats together. The new-run
form fans each harness and model combination out over its "runs each" count
before moving to the next combination, and a [coverage
plan](/components/backend/coverage/) emits each cell's missing runs together, so
three runs each of three cases start as three of the first case, then three of
the second, then three of the third, and finish in roughly that order. That is
what makes a repeated set reviewable a case at a time instead of arriving
interleaved. A caller that wants a different execution order submits the runs in
that order.

Which axis a coverage plan puts outside that per-cell grouping is configurable
per plan rather than fixed. `outerAxis: "case"`, the default, finishes one case
across every combination before starting the next, while
`outerAxis: "combination"` takes one model through every case first. A
[ladder](/components/backend/ladders/) makes the same choice between advancing
every climber one rung and taking one climber as far as it gets. Both settings
are purely a decision about the order cells are handed to `POST /jobs/batch`;
the dispatcher behaves identically either way.

A plan or ladder also keeps a
[review buffer](/components/backend/coverage/#the-review-buffer) of outstanding
runs and refills it as they are reviewed, unless its buffer is unbounded, so the
queue this
dispatcher drains is normally a short, deliberately ordered slice rather than an
entire sweep.

Ordering governs when a run starts, not when it finishes: runs still execute
concurrently up to the in-flight cap and the per-harness limit, so a slow early
run can finish after a fast later one. The one queue the backend fully
serializes is a game jam per model, for the reason above.

An automatic retry is a fresh enqueue, so it goes to the back of the queue
rather than jumping ahead of work queued while it was running.

## The driver Job

The dispatcher's product for a claimed run is one `batch/v1` `Job` running the
driver image, with exactly the environment the driver reads: the backend URL,
the job id and its per-job token, the serialized launch request,
`TCAB_DRIVER_RUNTIME=kubernetes`, the `TCAB_K8S_*` sandbox-pod passthroughs, and
the `TCAB_CONTAINER_*` run-image selection the driver resolves the sandbox image
from. A deployment therefore pins the run images by `:<git-sha>` here rather
than through a Kubernetes `image:` field. The driver pod's own IP is wired in
from the downward API so the driver can route a sandbox's live-preview frames
back to itself.

The `Job` is one-and-done: `restartPolicy: Never` and `backoffLimit: 0`, because
the driver owns reporting its own specific failure and a silent retry would race
that. Every `Job` carries the `managed-by` label the reconcile selects on, and a
`tcab.dev/job-id` label mapping it back to its backend job.

Configured driver `Secret`s reach the pod's environment through `envFrom`, which
is how the harness provider API key arrives. When a subscription `Secret` is
configured it is mounted instead as a read-only volume at the configured
directory, with `optional: true` so a missing `Secret` never wedges an
API-key-only pod, and the pod carries an `fsGroup` so the unprivileged driver
user can read the projected files.

## Death detection

A driver that dies before reporting leaves its backend job hanging. For each
owned `Job` that failed terminally, the dispatcher checks the backend job's
state and, while it is still live, reports the failure with the dead pod's logs
as the detail (`POST /jobs/{id}/status`), presenting the per-job token it
retained at dispatch. Each job is reported once. A token lost across a restart
leaves that job to its own driver's reporting.

The publish path carries no equivalent detection. A publisher that dies surfaces
as a stuck `dispatched` publish job or is reaped by its TTL.

## Sandbox reaping

The [driver](/components/driver/overview/) normally deletes its own sandbox pod,
but that cleanup is in-process. A driver killed by `SIGKILL`, whether by an OOM
kill, an eviction, a node drain, or a spot preemption, never runs it, and the
orphaned sandbox has no `ownerReference` to garbage-collect it, so it runs until
something deletes it and holds its requests against the node the whole time.
Left alone this compounds: the leaked requests crowd the node, which makes the
next driver more likely to be killed, which leaks another sandbox.

The dispatcher is the only component positioned to clean this up, since it is
long-lived and already watches every driver `Job` it created. When one fails
terminally it deletes that job's sandbox pods, selecting on both the job-id
label and the driver's `managed-by` label. Both are required: the driver `Job`'s
own pod carries the same job id, and matching it would destroy the logs the
failure report reads.

The reap is deliberately independent of the death report. Reporting needs a
retained per-job token and a non-terminal backend job, neither of which is
guaranteed, while a sandbox must be cleaned up regardless, so the reap is gated
only on the `Job` having failed. A failed reap is retried on the next tick
rather than recorded as done.

The driver pod also carries resource requests
(`TCAB_DISPATCHER_DRIVER_CPU_REQUEST` and
`TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST`). They keep it out of the `BestEffort`
QoS class, which is what made it the first thing evicted and OOM-killed, and the
memory request is the node's reservation for the post-run toolchain the driver
runs. The memory limit is deliberately unset by default, because a memory limit
would re-introduce the same `SIGKILL` from the container's own cgroup; only a CPU
limit is set, and over-limit CPU throttles rather than kills. See
[the run plane](/deployment/kubernetes/run-plane/#driver-pod-reservation).

## Surviving the cluster autoscaler

Reaping an orphaned sandbox limits the damage from a killed driver; it does not
stop the run from dying. The cluster autoscaler is a standing source of exactly
that kill, and by default it has every reason to pick a driver.

- A driver pod is a `Job` pod, so the autoscaler treats it as replaceable: for
  an ordinary `Job` a new pod would simply appear elsewhere. These `Job`s are
  `backoffLimit: 0`, so there is no replacement, and evicting one destroys the
  run it is conducting mid-flight along with whatever model spend that run had
  already incurred.
- Those deliberately small requests make the driver's node look idle. The run's
  real reservation belongs to the sandbox, a separate pod and frequently on a
  separate node, so a node whose only tenant is a driver sits under the
  autoscaler's utilization threshold for the entire length of the run, which is
  precisely the profile it consolidates away.

Every pod the dispatcher and driver create, meaning driver `Job`s, publish
`Job`s, and sandbox pods, therefore carries
`cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`, and a node running
one lingers until the work on it finishes. The sandbox carries the annotation
even though the autoscaler already spares controller-less pods: that exemption
is a property of the cluster's configuration rather than of the manifest, and it
would silently invert if anything ever gave the sandbox an owner.

This is a scale-down guard only. It does not pin the pod against a node the
operator drains, a spot reclaim, or a kubelet node-pressure eviction; the
sandbox reaping above and the driver's own `activeDeadlineSeconds` backstop
remain the answer for those.

When a driver is disrupted anyway, the death report says so. The dispatcher
reads the pod's `DisruptionTarget` condition ahead of its container state,
because an evicted driver's container reports the `SIGTERM` it received,
describing how it died rather than why, which would otherwise read as an
ordinary crash. If the pod is gone entirely, the report distinguishes a `Job`
that never started a pod from a pod that ran and was deleted out from under the
run, using the `Job`'s own `status.failed` count, which outlives the pod.

## RBAC

The dispatcher runs under its own `ServiceAccount` with a namespaced `Role`
granting exactly `batch`/`jobs` create/get/list/watch/delete, `core`/`pods`
get/list/delete, and `core`/`pods/log` get. The pod rules cover reading a dead
driver pod's status and logs for the failure report and deleting the sandbox
pods that pod orphaned. It creates no pods directly; the
[driver](/components/driver/overview/) does that under its own identity. A
deployment that points the driver at a different sandbox namespace
(`TCAB_K8S_NAMESPACE`) must grant the same pod `list` and `delete` there, or
reaping fails in that namespace, which is logged and never fatal. Naming a
`Secret` on a `Job` needs no `secrets` rule, because the kubelet reads and
projects it. The manifests are in `deployments/k8s/base/rbac.yaml`. See
[Kubernetes: staging & prod](/deployment/kubernetes/run-plane/#rbac).

## Deployment

The dispatcher is the `test-cabinet-dispatcher` crate (`crates/dispatcher`),
with no HTTP server and no flags. Its whole configuration is environment
variables, documented in `crates/dispatcher/src/config.rs`. `TCAB_BACKEND_URL`,
`TCAB_BACKEND_SERVICE_TOKEN` and `TCAB_DRIVER_IMAGE` are required, and
`TCAB_PUBLISHER_IMAGE` enables the publish path.

It is deployed as a single-replica `Deployment` with no `Service`, since it
binds no socket. A second replica would only race the same atomic claim. Local
development runs the same manifests on [k3d](/development/running/), so a run
schedules as a `Job` locally exactly as it does in the cloud.
