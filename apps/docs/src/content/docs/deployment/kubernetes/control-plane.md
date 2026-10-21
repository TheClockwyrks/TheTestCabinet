---
title: Control plane
---

The control plane is the always-on half of a deployment: the
[backend](/components/backend/overview/), which owns the run queue, the
published record and the catalog, and the identity the edge hands it.

## Backend

With its default SQLite store the backend owns a database file, an on-disk
definition store, a checkout it ingests from, the run queue, and a headless
browser for rendering references. As a `StatefulSet`
(`deployments/k8s/base/backend.yaml`) three things follow from that:

1. A single replica. SQLite is single-writer and the store is local, so the
   `StatefulSet` is pinned to `replicas: 1`. The backend coordinates publishes,
   owns the queue, and serves a low-traffic API.
2. A `PersistentVolumeClaim`. Mount it at the SQLite database path in
   `TCAB_BACKEND_DATABASE_URL` and at the paths `TCAB_BACKEND_STORE` and
   `TCAB_BACKEND_CHECKOUT` point to, so the database, store, and checkout survive
   a restart or reschedule. A volume is not a backup; see
   [Backups](/deployment/backups/).
3. An image with a browser. The published `tcab-backend` image layers the
   binary over Node, the bundled Playwright driver, and a Playwright-managed
   Chromium with the fonts it needs, and points the render path at them. Set
   `TCAB_REFERENCE_BROWSER` only to override that baked Chromium with an explicit
   binary. The `tcab-driver` image carries the same Node and Playwright
   toolchain plus `git`, because the driver seeds, builds, and load-checks each
   run's implementation. The dispatcher, artifacts, repos and arena images
   ship no browser.

The backend image also bakes gg's reference documents at `/opt/gg-reference`,
fetched from gg's release container at the version the driver pins, and sets
`TCAB_GG_REFERENCE` to point at them. Those are the files the backend serves at
`GET /gg/reference`, projected by the same `gg` binary the `tcab-driver` image
ships and the run images are self-checked against. A backend deployed from the
release tarballs instead needs gg's `v<version>/gg-reference.tar.gz` unpacked
and the variable pointed at it; otherwise the console's gg Reference section
answers `503` and the rest of the backend works normally.

The backend `Service` is `ClusterIP` with no `Ingress`. The dispatcher, the
driver and publisher `Job`s, the artifacts and repos services and the arena
reach it in-cluster, and the edge reaches it at the origin's `/api/` path. Its
outbound calls are to OpenRouter, for list prices and model probes; the public
dataset is written through the artifacts service, over the cluster network.

### Wiring variables

Beyond the store and checkout paths, these values wire the backend into the
rest of the deployment.

| Variable                     | Purpose                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_BACKEND_SERVICE_TOKEN` | The shared service token the dispatcher's claim is verified against, and the one the backend presents to the artifacts and repos services. It must equal the dispatcher's copy, or the queue never drains     |
| `TCAB_ARTIFACTS_URL`         | The in-cluster artifacts base URL (`http://tcab-artifacts:8790`) the backend prunes and [sweeps](/components/backend/overview/#artifact-reclamation) run trees through and writes the public snapshot through |
| `TCAB_REPOS_URL`             | The in-cluster repos base URL (`http://tcab-repos:8792`) the backend prunes a deleted run's bundle through                                                                                                    |
| `TCAB_ACCESS_TEAM_DOMAIN`    | The Access team domain whose certificates sign the edge's assertion; see [Identity](/components/auth/overview/#configuration)                                                                                 |
| `TCAB_ACCESS_AUDIENCE`       | The audience tag of the Access application that protects the environment's origin                                                                                                                             |

The console is same-origin with the backend, the artifacts service and the
arena, so the backend advertises no service URL: the console calls `/api/`,
resolves a run's media under `/artifacts/` and the arena under `/arena/` of its
own origin. Published reference frames and the rest of the public dataset are
read from the public bucket's hostname, `snapshot.testcabinet.ai` in prod.

Constraints 1 and 2 above are properties of the SQLite store. Point
`TCAB_BACKEND_DATABASE_URL` at a managed PostgreSQL instance and the backend
becomes a plain `Deployment` with no database volume, the shape of both remote
environments; see [PostgreSQL](/deployment/kubernetes/postgres/). The browser
image still applies, and each replica keeps its definition store and checkout
on an ephemeral volume of its own. That shape runs two replicas; see
[Planned disruption](#planned-disruption).

### Ingesting definitions

The backend serves the catalog from the checkout at `TCAB_BACKEND_CHECKOUT`:
the `test-suites` repository at the branch the environment ingests
(`TCAB_INGEST_BRANCH`, `staging` for staging and `master` for prod), with a
shallow clone of `cold-storage` beside it. `POST /ingest` populates the store
from it. There are two shapes for driving that, and an overlay uses
one of them.

Ingest reads the definitions, the test suites and the cold-storage media from
`TCAB_DEFINITIONS_ROOT`, `TCAB_SUITES_ROOT` and `TCAB_COLD_STORAGE_ROOT`. The
overlays leave all three unset, so each resolves to its default: the checkout's
root, its `test-suites/` tree and the `cold-storage/` clone beside the checkout.
An overlay that clones those trees as separate checkouts sets each one to the
directory its clone is written to, and the [prune
guard](/components/backend/overview/#test-case-definitions) keeps the store
intact when a variable names a directory the clone has not filled.

- A `CronJob` (`deployments/k8s/base/ingest-cronjob.yaml`) that clones the
  repository and calls `POST /ingest` over the cluster network with the service
  token. It fits a deployment whose backend serves its checkout from a shared
  volume the job can mount.
- An ingest sidecar in the backend pod, which the `staging` and `prod` overlays
  patch in (`patch-backend-ingest.yaml`). It shares the backend's `state`
  volume, writes the checkout the backend reads, and calls `POST /ingest` over
  localhost, so intra-pod traffic bypasses the `NetworkPolicy`. It presents the
  backend's shared service token, which the ingest route takes. Each refresh
  fetches the `test-suites` branch tip, authenticated with the read-only
  credential in the
  [`tcab-test-suites-credential` Secret](/deployment/overview/#secrets), and
  `cold-storage` shallowly. It runs one forced ingest of the branch tip on
  backend start, then idles. Those overlays suspend the base `CronJob`.

A pipeline deploy that moves the backend's pin restarts the backend pod, and
the sidecar re-ingests the catalog at the branch tip. It ingests once rather
than on a schedule: a periodic forced re-ingest
rewrites every version and briefly leaves each one without a manifest, which
fails any run resolving that version mid-cycle. Publish catalog changes between
deploys with `tcab ingest --env <env>`, which calls `POST /ingest` through the
edge with the Access service token; the backend refreshes its checkout to the
tip of the branch the environment ingests and scans it. The backend swaps each
version into place atomically, so it is safe to run while runs execute. Both
paths treat the suites' own update as the one step allowed to fail: when the
credential is absent, expired or refused, the refresh prints
`ingest: test suites update failed; ingesting without them` and ingests the
test cases and the reference-build lockfile the checkout already holds. Every
other step of `tcab ingest --env <env>` fails it before anything is ingested.

## Planned disruption

A node drain, a node-image upgrade and a deploy each restart service pods. A
planned restart of any always-on service causes no outage a driver notices and
cuts no request in flight. Three mechanisms provide that: a second replica
where the service can run one, a `PodDisruptionBudget` over those replicas, and
graceful termination in every service.

| Workload           | Replicas | Update strategy              | Budget            | Grace  |
| ------------------ | -------- | ---------------------------- | ----------------- | ------ |
| backend            | 2        | `RollingUpdate`, surge 1     | `minAvailable: 1` | `60s`  |
| `tcab-artifacts`   | 2        | `RollingUpdate`, surge 1     | `minAvailable: 1` | `300s` |
| `tcab-repos`       | 2        | `RollingUpdate`, surge 1     | `minAvailable: 1` | `300s` |
| `tcab-web`         | 2        | `RollingUpdate`, surge 1     | `minAvailable: 1` | `30s`  |
| `tcab-cloudflared` | 2        | `RollingUpdate`, surge 1     | `minAvailable: 1` | `30s`  |
| `tcab-dispatcher`  | 1        | `Recreate`                   | none              | `60s`  |
| `tcab-arena`       | 1        | `Recreate`                   | none              | `60s`  |
| `tcab-lgtm`        | 1        | `StatefulSet` rolling update | none              | `60s`  |

### Two replicas and a budget

A service that holds no state in its process runs two replicas. Its update
strategy is `RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0`, so a
deploy starts the new pod and waits for it to be `Ready` before terminating an
old one. Its `PodDisruptionBudget` selects the service's
`app.kubernetes.io/name` label with `minAvailable: 1`, so a drain evicts one
replica, waits for its replacement to be `Ready` on another node, and only then
evicts the other. Every budget's selector is the service's own name label, so
no service budget reaches a run pod.

### One replica

The dispatcher, the arena and the observability stack each run one replica,
and none carries a budget: a budget that refuses the eviction of a service's
only pod holds its node out of every upgrade. No driver call reaches any of
them, so their restart is made safe by graceful termination alone.

- The dispatcher holds no inbound connection, so its restart only pauses
  admission.
- The arena's tournament registry is in-memory and per-pod.
- The observability stack is outside the run path, and telemetry export is
  best effort.

### Graceful termination

Every service handles `SIGTERM` the same way:

1. It fails its readiness probe at once, so its endpoint leaves the `Service`.
2. A `preStop` hook of `sleep: {seconds: 5}` holds the pod while that removal
   propagates, and the service keeps accepting requests meanwhile.
3. It stops accepting connections and finishes every request in flight.
   Long-lived streams, such as the console's event streams, are closed so the
   client reconnects to a ready pod.
4. It exits with status 0 before `terminationGracePeriodSeconds` ends.

The grace is sized to the longest request the service answers. The artifacts
and repos services take `300s` so a run-tree or bundle upload in progress
completes on the terminating replica. The dispatcher spends its grace finishing
the tick in progress, so a run it has claimed always receives its `Job`.

## Identity

The backend holds no accounts. Every request that reaches it through the edge
carries the `Cf-Access-Jwt-Assertion` header, which it verifies with the two
`TCAB_ACCESS_*` variables above, and the identity a review records is the
assertion's `email`, or a service token's `common_name`. In-cluster callers
present the shared service token or a per-job token and never cross the edge.
The contract is [Identity](/components/auth/overview/); the edge that enforces
it is [Edge](/deployment/kubernetes/edge/).
