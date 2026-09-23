# Deployment assets

Copy-pasteable templates for deploying The Test Cabinet's long-running services —
the **backend** (`tcab-backend`), the **auth service** (`tcab-auth-service`), the
**dispatcher** (`tcab-dispatcher`), and the **artifact service** (`tcab-artifacts`)
— to **Kubernetes**, where a run is a **per-run Kubernetes Job**: the dispatcher
creates one **driver** (`tcab-driver`) Job per queued run, and each driver spawns a
separate **sandbox pod** via the Kubernetes API. There is no worker pool and no
headless Service.

This folder holds the _assets_; the authoritative, narrative documentation is the
**Deployment** section of the docs site, which explains what these files are for
and how they fit together:

- Overview — `apps/docs/src/content/docs/deployment/overview.md`
- Kubernetes (staging & prod) — `apps/docs/src/content/docs/deployment/kubernetes/overview.md`

Running the same services locally on one machine (the `local/` template below) is
documented in the Development section, not here:
`apps/docs/src/content/docs/development/running.md`.

(Published at <https://docs.testcabinet.ai/deployment/overview/>.)

Read the docs first. As with [`containers/`](../containers/README.md), the prose
lives on the docs site and this README is just a map.

## Layout

```
deployments/
├── local/
│   ├── compose.yml            # backend + auth service in containers (a minimal stack)
│   └── Makefile               # the full stack on a local k3d cluster (`make local-up`)
├── images/                    # service images, built into the ACR by the Azure pipeline (see below)
│   ├── services.Dockerfile    # EVERY Rust service, one `--target` each, over one
│   │                          #   shared cargo build stage: backend (+ headless
│   │                          #   Chromium), auth, dispatcher, driver, artifacts,
│   │                          #   arena, publisher
│   └── web.Dockerfile         # tcab-web, the console SPA behind nginx (no crate)
├── k8s/
│   ├── base/                  # the kustomize BASE, namespaced objects only
│   │   ├── kustomization.yaml
│   │   ├── rbac.yaml          # tcab-driver SA/Role (sandbox pods) + tcab-dispatcher SA/Role (Jobs)
│   │   ├── secrets.example.yaml # Secret templates (placeholders only)
│   │   ├── backend.yaml       # backend StatefulSet (1 replica) + PVC + Service
│   │   ├── auth.yaml          # auth StatefulSet (1 replica) + PVC + Service
│   │   ├── dispatcher.yaml    # dispatcher Deployment (1 replica), no Service
│   │   ├── artifacts.yaml     # artifact StatefulSet (1 replica) + PVC + Service + SA
│   │   ├── arena.yaml         # arena Deployment (1 replica) + Service + SA
│   │   ├── ingest-cronjob.yaml # periodic POST /ingest to refresh the catalog
│   │   └── networkpolicy.yaml # optional default-deny-ingress + allows
│   ├── components/            # observability, postgres, postgres-azure-ad, keyvault-csi, web, internal-ingress
│   ├── cluster/               # cluster-scoped objects, applied by hand by a cluster administrator
│   │   ├── namespace/         # the environment's Namespace
│   │   ├── observability/     # the LGTM stack's node-metrics ClusterRole + binding
│   │   ├── internal-ingress/  # the cert-manager ClusterIssuer
│   │   ├── azure-staging/     # the bootstrap for tcab-staging
│   │   └── azure-prod/        # the bootstrap for tcab-prod
│   ├── overlays/
│   │   ├── prod/              # production overlay (placeholder registry pinned)
│   │   ├── staging/           # staging overlay (tcab-staging, TCAB_ENV=staging)
│   │   ├── azure-prod/        # prod on managed PostgreSQL, deployed by the Azure pipeline from master
│   │   ├── azure-staging/     # staging on managed PostgreSQL, deployed by the Azure pipeline from staging
│   │   └── local/             # k3d development mirror (driven by ../local/Makefile)
│   └── README.md              # cluster prerequisites, apply, per-environment notes
├── backups/
│   └── litestream.yml         # example Litestream config: stream the SQLite DB to object storage
├── telemetry/
│   └── otel-collector.yaml    # example OTel Collector config (external-collector path; the default is in-cluster LGTM — see k8s/components/observability)
└── env/
    ├── backend.staging.env.example
    ├── backend.prod.env.example
    ├── auth.staging.env.example
    ├── auth.prod.env.example
    ├── dispatcher.staging.env.example
    └── dispatcher.prod.env.example
```

See the docs' [Backups](../apps/docs/src/content/docs/deployment/backups.md) and
[Telemetry](../apps/docs/src/content/docs/deployment/telemetry.md) pages for what
`backups/` and `telemetry/` are for. The `env/` files mirror the values the
`k8s/` manifests set as container env vars; they are a convenient single-file view
of each service's configuration.

## Service images

The Azure pipeline ([`azure-pipelines.yml`](../azure-pipelines.yml)) builds the
service images under `images/` on every push to `master` and `staging`, natively
for `amd64` and `arm64`, and pushes each to the Test Cabinet Azure Container
Registry as `testcabinet.azurecr.io/tcab-backend:<sha>`, `…/tcab-auth-service`,
`…/tcab-dispatcher`, `…/tcab-driver`, `…/tcab-artifacts`, `…/tcab-arena`,
`…/tcab-publisher`, and `…/tcab-web`. Its deploy then sets every image of the
`azure-*` overlays to that sha; the overlays carry no image tags of their own. To
build and push them by hand instead, see the build instructions in each
Dockerfile's header.

These are the long-running **service** images, distinct from the **run-container**
images a run executes inside ([`containers/`](../containers/README.md)), which the
same pipeline run builds and pushes at the same sha.

The `tcab-driver` stage carries the [audio store](../containers/README.md#the-audio-store)
at `/opt/tcab-audio`, resolved through the `AUDIO_STORE_IMAGE` build arg, so the
build itself reads no audio credential. The driver stages each run's declared packs
out of that store, so it and `TCAB_CONTAINER_TAG` move to the same commit; see
[Pinning images](../apps/docs/src/content/docs/deployment/kubernetes/overview.md#pinning-images).

Where that store comes from depends on who is building:

- **A pipeline build** passes the `test-cabinet-audio-store:<sha>` the same run
  pushed to the registry, so the driver bakes the store of its own commit.
- **Any other driver build** passes the arg itself, naming a
  `testcabinet.azurecr.io/test-cabinet-audio-store:<sha>` the pipeline pushed or a
  store built from the checkout. The arg defaults to `scratch`, so a driver build
  without it fails rather than baking an empty store.
- **A local build does not pull anything.** `local/Makefile`'s `audio-store` target
  builds the store from the checkout (staging it out of the audio object store with
  the read-scoped `CLOUDFLARE_AUDIO_R2_PRESIGN` credentials) and `make images` passes
  that ref in as `AUDIO_STORE_IMAGE`. So an audio change can be published to the
  object store and exercised locally without pushing a container image anywhere. See
  that target for what happens on a machine with no audio credentials.

## Secrets

Every file here is a **template with placeholder values only** — never commit a
real secret. The per-environment files under `env/` are deliberately thin; the
repo-root [`.env.backend.example`](../.env.backend.example),
[`.env.auth.example`](../.env.auth.example),
[`.env.dispatcher.example`](../.env.dispatcher.example), and
[`.env.artifacts.example`](../.env.artifacts.example) remain the authoritative
reference for every variable each service reads. Supply real values through
Kubernetes `Secret`s populated from your secret manager (External Secrets, Sealed
Secrets, `kubectl create secret`, …).
