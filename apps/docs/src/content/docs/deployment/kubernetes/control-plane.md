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
ships. A backend deployed from the release tarballs instead needs
`gg-reference-<version>.tar.gz` unpacked and the variable pointed at it;
otherwise the console's gg Reference section answers `503` and the rest of the
backend works normally.

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
- An ingest sidecar in the backend pod, which the `azure-*` overlays patch in.
  It shares the backend's `state` volume, writes the checkout the backend
  reads, and calls `POST /ingest` over localhost, so intra-pod traffic bypasses
  the `NetworkPolicy` and no service token is needed. It runs one ingest on
  backend start to repopulate an ephemeral store after a reschedule, then idles.
  Those overlays suspend the base `CronJob`.

The sidecar shape ingests once rather than on a schedule: a periodic forced
re-ingest rewrites every version and briefly leaves each one without a manifest,
which fails any run resolving that version mid-cycle. Publish catalog changes on
demand with `scripts/reingest-cluster.sh --env <env>`, which fetches the branch
tip into the live checkout and forces one re-ingest. The backend swaps each
version into place atomically, so it is safe to run while runs execute.

## Auth service

The auth service hosts the user
[accounts](/components/backend/overview/#authentication) the backend verifies tokens
against. It keeps its own SQLite database, so it takes the same single-replica
`StatefulSet` plus `PersistentVolumeClaim` shape as the backend, or runs as a
plain `Deployment` when `TCAB_AUTH_DATABASE_URL` points at a managed database.
It renders nothing, holds no third-party secret, and stores only Argon2id
password hashes. The example is `deployments/k8s/base/auth.yaml`; point the
backend at it with `TCAB_BACKEND_AUTH_URL=http://tcab-auth:8789`.
