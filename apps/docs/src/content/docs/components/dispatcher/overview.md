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
   backend hands each job to exactly one dispatcher. The backend — not the
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
4. Let each finished `Job` reap itself (`ttlSecondsAfterFinished`).

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

## RBAC

The dispatcher runs under its own `ServiceAccount` with a namespaced `Role`
granting exactly: `batch`/`jobs` create/get/list/watch/delete (to create and
reconcile driver `Job`s) and `core`/`pods` + `pods/log` get/list (to read a dead
driver pod's status and logs for failure reporting). It creates **no** pods
directly — the [driver](/components/driver/overview/) does that, under its own
identity. The manifests are in
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
