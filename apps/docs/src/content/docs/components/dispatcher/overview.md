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
   non-terminal ones as the in-flight total, and report any driver-pod death the
   driver itself could not. Counting from the cluster rather than from an
   in-memory tally is what makes a restart safe.
2. Admit while the in-flight total is under `TCAB_DISPATCHER_MAX_INFLIGHT`:
   claim the oldest queued run job (`POST /jobs/next`) and create one driver
   `Job` for it. When the run queue is empty and a publisher image is
   configured, claim the oldest queued publish job instead and create one
   publisher `Job`. Both kinds carry the same `managed-by` label, so one
   in-flight cap covers both.
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

## RBAC

The dispatcher runs under its own `ServiceAccount` with a namespaced `Role`
granting exactly `batch`/`jobs` create/get/list/watch/delete and `core`/`pods`
plus `pods/log` get/list. It creates no pods directly; the
[driver](/components/driver/overview/) does that under its own identity. Naming
a `Secret` on a `Job` needs no `secrets` rule, because the kubelet reads and
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
