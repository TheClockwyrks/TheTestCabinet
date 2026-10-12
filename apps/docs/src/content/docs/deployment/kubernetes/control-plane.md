---
title: Control plane
---

The control plane is the always-on half of a deployment: the
[backend](/components/backend/overview/), which owns the run queue and the
published record, and the [auth service](/components/auth/overview/), which owns
the accounts.

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
3. An image with a browser. The published `tcab-backend` image
   (`deployments/images/services.Dockerfile`, `--target backend`) layers the
   binary over Node, the bundled Playwright driver, and a Playwright-managed
   Chromium with the fonts it needs, and points the render path at them. Set
   `TCAB_REFERENCE_BROWSER` only to override that baked Chromium with an explicit
   binary. The `tcab-driver` image carries the same Node and Playwright
   toolchain plus `git`, because the driver seeds, builds, and load-checks each
   run's implementation. The auth, dispatcher, and artifact images ship no
   browser.

The backend image also bakes gg's reference documents at `/opt/gg-reference` and
sets `TCAB_GG_REFERENCE` to point at them. Those are the files the backend serves
at `GET /gg/reference`, projected by the same `gg` binary the `tcab-driver` image
ships and the run images are self-checked against. A backend deployed from the
release tarballs instead needs gg's `v<version>/gg-reference.tar.gz` unpacked and
the variable pointed at it; otherwise the console's gg Reference section answers
`503` and the rest of the backend works normally.

The backend `Service` is `ClusterIP` with no `Ingress`. The dispatcher, the
artifact service, the arena, and operators reach it in-cluster, and its outbound
R2 and deploy-hook calls need no inbound exposure.

### Wiring variables

Beyond the store and checkout paths, five values wire the backend into the rest
of the deployment.

| Variable                     | Purpose                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_BACKEND_AUTH_URL`      | The auth service the backend verifies every bearer token against, in-cluster (`http://tcab-auth:8789`)                                                                |
| `TCAB_BACKEND_SERVICE_TOKEN` | The shared service token the dispatcher's claim is verified against. It must equal the dispatcher's copy, or the queue never drains                                   |
| `TCAB_ARTIFACTS_PUBLIC_URL`  | The console-facing artifact base URL, reported through `GET /config`                                                                                                  |
| `TCAB_ARTIFACTS_URL`         | The in-cluster artifact base URL (`http://tcab-artifacts:8790`) the backend prunes and [sweeps](/components/backend/overview/#artifact-reclamation) run trees through |
| `TCAB_ARENA_PUBLIC_URL`      | The console-facing arena base URL, reported through `GET /config`                                                                                                     |

`TCAB_SNAPSHOT_PUBLIC_URL` is the public read base of the snapshot bucket,
reported through the same `GET /config` so the console can load an
asset-generation case's published
[reference frames](/components/core/results/#script-references-asset-generation).
It carries the CDN hostname those objects are served from, which is the value the
static site is built with as `TCAB_SNAPSHOT_URL`. `TCAB_R2_ENDPOINT` is a
different thing: the S3 write endpoint the backend uploads the snapshot through.
The snapshot bucket is public-read, which is what lets the public gallery work.
With `TCAB_SNAPSHOT_PUBLIC_URL` unset the console shows no Reference tab for
asset-generation cases.

Constraints 1 and 2 above are properties of the SQLite store. Point
`TCAB_BACKEND_DATABASE_URL` at a managed PostgreSQL instance and the backend
becomes a plain `Deployment` with no database volume and no single-replica pin;
see [PostgreSQL](/deployment/kubernetes/postgres/). The browser image and a
volume for the definition store and checkout still apply, since those stay on
local disk.

### Ingesting definitions

The backend serves the catalog from the checkout at `TCAB_BACKEND_CHECKOUT`,
populated by `POST /ingest`. There are two shapes for driving that, and an
overlay uses one of them.

- A `CronJob` (`deployments/k8s/base/ingest-cronjob.yaml`) that clones the
  repository and calls `POST /ingest` over the cluster network. It fits a
  deployment whose backend serves its checkout from a shared volume the job can
  mount.
- An ingest sidecar in the backend pod, which the `staging` and `prod` overlays
  include as `deployments/k8s/components/catalog-ingest`, each setting its
  catalog branch in `patch-backend-ingest.yaml`. It shares the backend's `state`
  volume, writes the checkout the backend reads, and calls `POST /ingest` over
  localhost, so intra-pod traffic bypasses the `NetworkPolicy` and no service
  token is needed. Those overlays suspend the base `CronJob`.

Every pipeline deploy changes the backend's image tag, so every deploy restarts
the backend pod, and the sidecar re-ingests the catalog that shipped with the
commit. It ingests once rather than on a schedule: a periodic forced re-ingest
rewrites every version and briefly leaves each one without a manifest, which
fails any run resolving that version mid-cycle. Publish catalog changes between
deploys with `scripts/reingest-cluster.sh --env <env>`, which fetches the branch
tip into the live checkout and forces one re-ingest. The backend swaps each
version into place atomically, so it is safe to run while runs execute.

#### The ingest sidecar

The sidecar runs one script, the component's `ingest.sh`, once per start of the
backend pod. Its steps run in order, and each is named in the result it records:

| Step           | What it does                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tools`        | Installs `git` and `curl`.                                                                                         |
| `checkout`     | Brings `/state/checkout` to the tip of the catalog branch on the GitHub mirror, cloning it onto an empty volume.   |
| `cold-storage` | Brings the `cold-storage` submodule to the commit that tip pins, then checks it sits at that commit with its tree. |
| `backend`      | Waits for the backend's `/healthz`.                                                                                |
| `ingest`       | Sends `POST /ingest` with `{"force": true}`.                                                                       |

The sidecar asks for an ingest only from a checkout that is at the branch tip
with its cold storage at the pinned commit. A step that fails ends the run before
the `POST`, so the definition store, every version's baselines and the public
snapshot stay as they were. A network step is tried three times and the `POST`
ten times before it counts as failed.

The sidecar records its outcome in `/tmp/ingest-result` in its own container: a
`status` of `running`, `ok` or `failed`, the `step`, the `branch`, the checkout's
`commit`, and on a failure a message. The message names what failed, quotes the
failing command's last output, and reports the free space on `/state`, since a
full volume is what a fetch that cannot write looks like. The same lines go to
the container's log.

The container never exits and has no probe. An exited container is restarted by
the kubelet, which marks the pod not ready while it waits out the restart
back-off, and the backend's Deployment is `Recreate` with one replica, so a pod
that is not ready is a backend out of its Service. Success and failure both end
with the container idle.

What a failed sidecar means for the backend depends on the store it started with:

- A populated store the running build can read, the normal case on the
  persistent `state` volume. [`/readyz`](/components/backend/api/#get-readyz) is
  `200` from the start, so the backend serves the catalog it had while the
  sidecar works and keeps serving it when the sidecar fails.
- An empty store, on a first deploy or a replaced disk, or a store stamped with
  another record format. `/readyz` is `503` until an ingest lands, so the
  backend was out of its Service before the sidecar ran and stays out. The
  rollout never becomes ready, and the deploy undoes it. For a changed record
  format the undo restores the build that reads the store.

#### Deploys and the catalog

A deploy that cannot ingest its catalog fails, on one side of the rollout or the
other, through `scripts/ci/catalog-ingest.sh`:

- `preflight <env>` runs on the deploying machine before anything in the cluster
  changes. It checks that the catalog branch has a tip on the GitHub mirror, that
  the tip pins a `cold-storage` commit, and that the commit can be fetched from
  the repository `.gitmodules` names. It fetches the tip without its files and
  the pinned commit without its tree, so it downloads none of the media. It
  then reads the free space on the running backend's `state` volume, which the
  new pod's sidecar fetches onto, and fails when that is under
  `TCAB_INGEST_MIN_FREE_MB` (1024), or under that plus
  `TCAB_INGEST_COLD_STORAGE_MB` (2560) when the volume's cold storage is at
  another commit than the tip pins and has to be fetched. A failure leaves the
  cluster exactly as it was.
- `verify <env>` runs once the rollout is ready. It reads the sidecar's result
  inside the cluster, waits up to `TCAB_INGEST_WAIT_SECONDS` (600) for a sidecar
  still working, and fails unless the status is `ok`, printing the failing step
  and the sidecar's message. It undoes nothing, because a sidecar that failed
  left the backend serving what it served before.

Only a volume reading that is too low fails the preflight. An environment with
no backend has no volume to read, and a volume that cannot be read is noted and
left to `verify`, since the deploy may be what repairs the backend. A fetch that
fails inside the cluster for any other reason is caught by `verify`.

Once the cause of a failed ingest is fixed, `scripts/reingest-cluster.sh --env
<env>` ingests without a deploy. It exits non-zero when a fetch, the pin check or
the ingest fails. A whole-catalog ingest that succeeds records the sidecar's
result as `ok`, so `verify` passes when it is run again.

A sidecar killed part-way through an attempt, which running out of memory during
a cold-storage checkout does, is restarted by the kubelet in the same pod. The
restarted sidecar finds the marker its earlier start left on the volume
(`/state/.ingest-in-progress`, naming the pod), records a `failed` result at the
step that was killed and idles, so the pod stays ready and `verify` fails with
the cause instead of the backend leaving its Service on every restart.

#### Restoring baselines

A version's [baselines](/components/core/validation/#where-baselines-live) reach
the store from cold storage at ingest, so an environment that has lost them gets
them back from one whole-catalog forced ingest of a checkout whose cold storage
is checked out.

1. Read the free space on the `state` volume, and make room if it is short. The
   volume holds the checkout, the cold-storage media (about 2 GB) and the
   definition store.

   ```sh
   pod=deploy/the-test-cabinet-backend
   az aks command invoke --resource-group testcabinet-<env>-westus2-rg \
     --name testcabinet-<env>-westus2-aks \
     --command "kubectl -n tcab-<env> exec $pod -c ingest -- df -h /state"
   ```

2. Run `scripts/reingest-cluster.sh --env <env>` with no slug. It brings the
   checkout to the branch tip and cold storage to its pinned commit, stops
   before the ingest if either fails, printing the free space on `/state`, and
   otherwise forces a whole-catalog ingest. Checked-out cold storage is
   authoritative, so every version's baselines are stored again.
3. Confirm it from the public snapshot. The ingest queues a snapshot refresh;
   once it has been uploaded, the case file of a version with captured baselines
   lists them in `validationBaselines`. The snapshot holds a case file for each
   version a published run built, so pick one of those:

   ```sh
   base=https://snapshot.testcabinet.ai # prod
   # base=https://snapshot.staging.testcabinet.ai
   prefix="$(curl -fsS "$base/index.json" | jq -r .casesPrefix)"
   curl -fsS "$base/${prefix}<slug>/<version>.json" | jq '.validationBaselines | length'
   ```

   A count above zero is a restored version. `generatedAt` in `index.json` says
   whether the snapshot read is the one generated after the ingest.

## Auth service

The auth service hosts the user
[accounts](/components/backend/overview/#authentication) the backend verifies tokens
against. It keeps its own SQLite database, so it takes the same single-replica
`StatefulSet` plus `PersistentVolumeClaim` shape as the backend, or runs as a
plain `Deployment` when `TCAB_AUTH_DATABASE_URL` points at a managed database.
It renders nothing, holds no third-party secret, and stores only Argon2id
password hashes. The example is `deployments/k8s/base/auth.yaml`; point the
backend at it with `TCAB_BACKEND_AUTH_URL=http://tcab-auth:8789`.
