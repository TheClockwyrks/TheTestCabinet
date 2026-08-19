---
title: Overview
---

The dispatcher is a thin, stateless controller that turns the
[backend](/components/backend/overview/)'s **run queue** into Kubernetes work. It
holds no durable state of its own — the backend's job table is the source of truth
— and it does only one thing: claim a queued run and create one
[driver](/components/driver/overview/) `Job` to execute it.

It replaces the old long-lived **worker pool**. Where a worker was a registered,
hand-scaled HTTP server that a console addressed directly, the dispatcher sits
entirely behind the backend: a console enqueues a run at the backend and never
talks to the dispatcher at all. Concurrency scales with the cluster (queue
admission plus available capacity), not with a manually-sized set of workers, and
there is no per-pod registration to manage.

## What it does

The dispatcher runs a single control loop forever:

1. **Claim** the next claimable job from the backend (`POST /jobs/next`),
   authenticating with a shared **service token**. The claim is atomic, so the
   backend hands each job to exactly one dispatcher. Selection is **FIFO by enqueue
   order** across harnesses (see [Queue order](#queue-order)), skipping any job held
   back. The backend — not the
   dispatcher — enforces each harness's **maximum parallelism** here: it only hands
   back a job whose harness has fewer than its configured limit of runs already in
   flight, holding the rest in the `pending` state until a slot frees (see
   [Harnesses → per-harness configuration](/components/core/harnesses/#per-harness-configuration)).
   The backend also holds back a **game-jam** job while another run of the same jam
   and model is in flight under any harness, so a model's jam entries run one at a
   time and each is briefed with the previous one's README (see
   [Game jam → repeated runs](/testing/game-jam/overview/#repeated-runs-build-something-distinct)).
2. **Create one driver `Job`** for the claimed run through the Kubernetes API, with
   exactly the environment the [driver](/components/driver/overview/) reads: the
   backend URL, the job id and its per-job token, the serialized launch request,
   `TCAB_DRIVER_RUNTIME=kubernetes`, the `TCAB_K8S_*` sandbox-pod passthroughs, and
   the `TCAB_CONTAINER_*` run-image selection the driver resolves the sandbox image
   from (so a deployment pins the run images by `:<git-sha>` here, not via a
   Kubernetes `image:` field) — plus the driver pod's own IP from the downward API,
   so the driver can route a sandbox's live-preview frames back to itself.
3. **Watch** the `Job`s it created, holding at most `TCAB_DISPATCHER_MAX_INFLIGHT`
   in flight **across all harnesses** (this global cap composes with the backend's
   per-harness limit from step 1), and **report** any driver-pod death the driver
   itself could not (`POST /jobs/{id}/status`), reading the dead pod's logs for the
   failure detail.
4. **Reap the sandbox pods** a dead driver orphaned — see
   [Sandbox reaping](#sandbox-reaping).
5. Let each finished `Job` reap itself (`ttlSecondsAfterFinished`).

The dispatcher never executes a run, resolves a definition, or touches a record:
all of that is the driver's job. It is purely the bridge between the backend's
queue and the cluster's scheduler.

## Relationship to the others

- **The backend owns the queue; the dispatcher owns all `Job` creation.** This
  keeps the backend portable (HTTP + a database, no cluster dependency) and isolates
  the cluster RBAC in one small component.
- **The driver does the work.** The dispatcher's whole product is a
  [driver](/components/driver/overview/) `Job` per run; see that page for how a run
  actually executes.
- **One service token, per-job tokens minted by the backend.** The dispatcher
  authenticates its claim with a shared service token (`TCAB_BACKEND_SERVICE_TOKEN`,
  which the backend also holds); each driver authenticates its own streaming with
  the per-job token the backend minted at enqueue and the dispatcher passed in.

## Queue order

The backend hands jobs back in the order they were **enqueued**. Each job takes a
monotonic queue position (`job.queue_seq`) when it is inserted, and the claim orders
by that position — not by the enqueue timestamp, which cannot order a batch (every
run of one `POST /jobs/batch` shares a single timestamp) and, being stored as an
RFC 3339 string with a variable-length subsecond part, does not always compare
chronologically either.

The practical consequence is that **a batch runs in the order the console listed
it**, and it is the whole mechanism by which anything upstream controls execution
order: nothing in the dispatcher, the driver, or the queue needs to know why a run
was enqueued, because emitting is choosing.

Both consoles exploit that by emitting a case's repeats together — the new-run form
fans each harness/model combination out over its "runs each" count before moving to
the next combination, and a [coverage plan](/components/backend/coverage/) emits each
cell's missing runs together — so three runs each of three cases start as three of
the first case, then three of the second, then three of the third, and finish in
roughly that order. That is what makes a repeated set reviewable a case at a time
instead of arriving interleaved. A caller that wants a different execution order
submits the runs in that order.

Which axis a coverage plan puts **outside** that per-cell grouping is **configurable
per plan**, not fixed: `outerAxis: "case"` (the default, and the historical
behaviour) finishes one case across every combination before starting the next,
while `outerAxis: "combination"` takes one model through every case first. A
[ladder](/components/backend/ladders/) makes the same choice between advancing every
climber one rung and taking one climber as far as it gets. Both settings are purely
a decision about the order cells are handed to `POST /jobs/batch`; the dispatcher's
behaviour is identical either way.

A plan or ladder also does not enqueue its whole matrix at once. It keeps a bounded
[review buffer](/components/backend/coverage/#the-review-buffer) of outstanding runs
and refills it as they are reviewed, so the queue this dispatcher drains is normally
a short, deliberately ordered slice rather than an entire sweep.

Ordering governs when a run *starts*, not when it finishes: runs still execute
concurrently up to the caps below, so a slow early run can finish after a fast later
one. The one queue the backend fully serializes is a **game jam per model**, for the
reason in step 1 above.

An automatic retry is a fresh enqueue, so it goes to the **back** of the queue rather
than jumping ahead of work queued while it was running.

## Sandbox reaping

The [driver](/components/driver/overview/) normally deletes its own sandbox pod, but
that cleanup is in-process: a driver killed by `SIGKILL` (OOM kill, eviction, node
drain, spot preemption) never runs it, and the orphaned sandbox has no
`ownerReference` to garbage-collect it — so it runs until something deletes it,
holding its requests against the node the entire time. Left alone this compounds:
the leaked requests crowd the node, which makes the next driver more likely to be
killed, which leaks another sandbox.

The dispatcher is the only component positioned to clean this up — it is long-lived
and already watches every driver `Job` it created — so when one fails terminally it
deletes that job's sandbox pods, selecting on **both** the job-id label and the
driver's `managed-by` label. Both are required: the driver `Job`'s own pod carries
the same job id, and matching it would destroy the logs the failure report reads.

The reap is deliberately independent of the death **report**. Reporting needs a
retained per-job token and a non-terminal backend job, neither of which is
guaranteed; a sandbox must be cleaned up regardless, so it is gated only on the
`Job` having failed. A failed reap is retried on the next tick rather than recorded
as done.

The driver pod also carries small resource **requests**
(`TCAB_DISPATCHER_DRIVER_{CPU,MEMORY}_REQUEST`) purely to keep it out of the
`BestEffort` QoS class, which is what made it the first thing evicted and
OOM-killed. Limits are deliberately unset by default: a memory limit would
re-introduce the same `SIGKILL` from the container's own cgroup.

## Surviving the cluster autoscaler

Reaping an orphaned sandbox limits the damage from a killed driver; it does not stop
the run from dying. The cluster autoscaler is a standing source of exactly that kill,
and by default it has every reason to pick a driver:

- A driver pod is a `Job` pod, so the autoscaler treats it as **replaceable** — for an
  ordinary `Job` a new pod would simply appear elsewhere. These `Job`s are
  `backoffLimit: 0`, so there is no replacement. Evicting one destroys the run it is
  conducting, mid flight, along with whatever model spend the run had already incurred.
- Those deliberately small requests make the driver's node look **idle**. The run's
  real reservation belongs to the sandbox, which is a separate pod and frequently on a
  separate node, so a node whose only tenant is a driver sits under the autoscaler's
  utilization threshold for the entire length of the run — precisely the profile it
  consolidates away.

So every pod the dispatcher and driver create — driver `Job`s, publish `Job`s, and
sandbox pods — carries
`cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`. A node running one lingers
until the work on it finishes. The sandbox carries the annotation even though the
autoscaler already spares controller-less pods: that exemption is a property of the
cluster's configuration rather than of the manifest, and it would silently invert if
anything ever gave the sandbox an owner.

This is a **scale-down** guard only. It does not pin the pod against a node the
operator drains, a spot reclaim, or kubelet node-pressure eviction — the sandbox
reaping above, and the driver's own `activeDeadlineSeconds` backstop, remain the
answer for those.

When a driver *is* disrupted anyway, the death report says so. The dispatcher reads
the pod's `DisruptionTarget` condition ahead of its container state, because an
evicted driver's container reports the `SIGTERM` it received — describing how it died
and not why — which would otherwise read as an ordinary crash. If the pod is gone
entirely, the report distinguishes "the `Job` never started a pod" from "a pod ran and
was deleted out from under the run" using the `Job`'s own `status.failed` count, which
outlives the pod.

## RBAC

The dispatcher runs under its own `ServiceAccount` with a namespaced `Role`
granting exactly: `batch`/`jobs` create/get/list/watch/delete (to create and
reconcile driver `Job`s), `core`/`pods` get/list/delete (to read a dead driver pod's
status and to reap orphaned sandbox pods), and `core`/`pods/log` get (for the
failure detail). It creates **no** pods directly — the
[driver](/components/driver/overview/) does that, under its own identity. A
deployment that points the driver at a different sandbox namespace
(`TCAB_K8S_NAMESPACE`) must grant the same pod `list`/`delete` there, or reaping
fails in that namespace (logged, never fatal). The manifests are in
[`deployments/k8s/base/rbac.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/base/rbac.yaml)
and [Kubernetes: staging & prod](/deployment/kubernetes/#rbac).

## Status

The dispatcher is implemented as the `test-cabinet-dispatcher` crate
(`crates/dispatcher`), with no HTTP server and no flags — its whole configuration
is environment variables, documented on its
[`config.rs`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/crates/dispatcher/src/config.rs).
It is deployed as a single-replica `Deployment` (a second replica would only race
the same atomic claim — wasted work, not a correctness risk) with no `Service`,
since it binds no socket. Local development runs the same manifests on
[k3d](/development/running/), so a run schedules as a `Job` locally exactly as it
does in the cloud.
