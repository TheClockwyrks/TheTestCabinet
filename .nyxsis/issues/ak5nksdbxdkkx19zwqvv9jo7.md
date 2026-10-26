---
format: nyxsis-issue
version: 3
id: ak5nksdbxdkkx19zwqvv9jo7
zone: DEPLOY
number: 2
title: Add service disruption budgets and graceful termination
type: generic
priority: 3
state: done
depends_on:
  - mkwwaowuuf9kuvps1wmow2pi
  - kzyuvjcx8wexztzcrmk3rwpi
  - nxs3up9tm7pi706lpgt12xkm
  - j499w017ihhm6k11fx3q0g4y
created: 2026-10-19T00:39:11.380210785Z
done: 2026-10-26T08:41:36.88502655Z
outcome: |
  Every always-on service now drains on `SIGTERM` as the control plane page's
  "Graceful termination" states. Before the code changed, the page was corrected
  to Kubernetes' real order (the `preStop` hook runs before the signal) and gained
  two rules: a 5-second in-process drain delay, and a stop deadline at the grace
  less 10 seconds.

  - **Manifests:**
    - `tcab-web` runs 2 replicas and `tcab-cloudflared` gains a surge rolling
      update; each has a `PodDisruptionBudget` with `minAvailable: 1`. The
      artifacts and repos manifests already had theirs from DATA-1/DATA-2, and the
      backend's came from BACK-4.
    - The dispatcher and arena use `Recreate`. The graces follow the page's table,
      including the SQLite backend's `StatefulSet` and `tcab-lgtm`.
    - Every container that serves a `Service` has a `preStop` sleep of 5 s. The
      arena gains a `/readyz` readiness probe, and the artifacts probe moves to
      `/readyz`. cloudflared runs with `--grace-period 25s`.
  - **Services:**
    - The backend, artifacts, repos and arena fail readiness at once, close their
      long-lived streams, keep accepting for the drain delay, then finish requests
      in flight and exit 0. Each is bounded by its stop deadline and installs its
      signal handlers before startup.
    - The dispatcher finishes the tick in progress, so a claimed run always gets
      its `Job`, then exits 0.
    - The console image declares `SIGQUIT`, nginx's graceful stop, as its stop
      signal.
  - **Tests:** each service binary has a test that starts the real process, sends
    it `SIGTERM` while a slow request (or, for the dispatcher, a tick) is in
    flight, and checks that readiness answers 503, the request completes and the
    process exits 0.

  Not done: the staging checks in Verify, namely `kubectl drain` during an upload,
  a rollout restart of each two-replica workload, and deleting the dispatcher pod
  after a claim. Also, in the submodule worktrees the `cspell` gate checks no
  files and fails whatever the change: either the `**/.git/**` ignore matches
  every file under the worktree's path, or cspell 10.2.2 prints its usage when run
  with no file arguments. Arena tournaments still cannot record their current
  match and be resumed on shutdown; that work is ARENA-1.
---

A node drain restarts every service pod at once with a 30-second grace and no
`SIGTERM` handling, so in-flight requests are cut and the backend and the
artifacts service are unreachable while their single replicas move. The control
plane documentation makes a planned restart invisible to a driver: services that
hold no state in their process run two replicas under a surge rolling update and
a `PodDisruptionBudget`, and every service drains its in-flight requests on
`SIGTERM` inside a stated grace. See
`apps/docs/src/content/docs/deployment/kubernetes/control-plane.md`, section
"Planned disruption" and its subsections "Two replicas and a budget", "One
replica" and "Graceful termination". The replica counts also appear in
`apps/docs/src/content/docs/deployment/overview.md`, section "Deployed
components".

Every workload in `deployments/k8s/` runs one replica with the default
strategy and grace, no workload sets a `preStop` hook, and the namespace holds
no `PodDisruptionBudget`. The backend, artifacts, arena and dispatcher
binaries exit at once on `SIGTERM`.

The two-replica artifacts and repos services need the stateless Blob-backed
shapes of DATA-1 and DATA-2, and `tcab-cloudflared` is the edge of EDGE-1. The
backend's two replicas, rolling update and budget belong to BACK-4; this issue
covers the backend's graceful termination and grace.

## What is missing

- `tcab-artifacts`, `tcab-repos`, `tcab-web` and `tcab-cloudflared` at
  `replicas: 2` with `strategy: RollingUpdate`, `maxSurge: 1`,
  `maxUnavailable: 0`, a readiness probe each, and a `PodDisruptionBudget` each
  selecting the workload's `app.kubernetes.io/name` label with
  `minAvailable: 1`.
- `Recreate` on the dispatcher and the arena.
- `terminationGracePeriodSeconds` per the page's table: `300` for artifacts
  and repos, `60` for the backend, dispatcher, arena and `tcab-lgtm`, `30` for
  web and cloudflared.
- A `preStop` `sleep` of 5 seconds on every service container that serves a
  `Service`.
- `SIGTERM` handling in the backend, artifacts, repos and arena: fail the
  readiness probe at once, keep serving through the `preStop` delay, stop
  accepting, finish requests in flight, close long-lived event streams, and
  exit 0 inside the grace.
- `SIGTERM` handling in the dispatcher: stop starting ticks, finish the tick in
  progress so a claimed run receives its `Job`, and exit 0.
- The `tcab-web` server shut down gracefully on `SIGTERM`.

## Verify

- `kubectl kustomize deployments/k8s/overlays/prod` renders the four budgets,
  the replica counts, strategies, graces and `preStop` hooks above, and the
  `k8s-manifests` and `k8s-deploy-sets` gates pass.
- A unit test per service binary sends the process `SIGTERM` while a slow
  request is in flight and asserts the readiness probe answers `503`, the
  request completes, and the process exits 0.
- On staging, `kubectl drain` of the node holding one artifacts replica while a
  run uploads its tree completes the upload, and a loop of
  `GET /artifacts/...` through the edge sees no failed request during the
  drain.
- On staging, `kubectl rollout restart deployment/tcab-artifacts` and the same
  for `tcab-repos`, `tcab-web` and `tcab-cloudflared` keep one `Ready` replica
  throughout (`kubectl get pods -w`).
- On staging, `kubectl delete pod` of the dispatcher just after a claim leaves
  that run with its driver `Job`.
