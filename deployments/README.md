# Deployment assets

Copy-pasteable templates for deploying The Test Cabinet's long-running services —
the **backend** (`tcab-backend`), the **auth service** (`tcab-auth-service`), the
**dispatcher** (`tcab-dispatcher`), and the **artifact service** (`tcab-artifacts`)
— to **Kubernetes**, where a run is a **per-run Kubernetes Job**: the dispatcher
creates one **driver** (`tcab-driver`) Job per queued run, and each driver spawns a
separate **sandbox pod** via the Kubernetes API. There is no worker pool and no
headless Service.

This folder holds the *assets*; the authoritative, narrative documentation is the
**Deployment** section of the docs site, which explains what these files are for
and how they fit together:

- Overview — `apps/docs/src/content/docs/deployment/overview.md`
- Kubernetes (staging & prod) — `apps/docs/src/content/docs/deployment/kubernetes.md`

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
├── images/                    # service images, published to GHCR by CI (see below)
│   ├── backend.Dockerfile     # tcab-backend + headless Chromium
│   ├── auth.Dockerfile        # tcab-auth-service, slim runtime (no Chromium/fonts)
│   ├── dispatcher.Dockerfile  # tcab-dispatcher, slim controller; no container engine
│   ├── driver.Dockerfile      # tcab-driver, the per-run executor; no container engine
│   └── artifacts.Dockerfile   # tcab-artifacts, slim run-tree server
├── k8s/
│   ├── kustomization.yaml     # the kustomize BASE (the flat manifests below)
│   ├── namespace.yaml         # per-environment namespace
│   ├── rbac.yaml              # tcab-driver SA/Role (sandbox pods) + tcab-dispatcher SA/Role (Jobs)
│   ├── secrets.example.yaml   # Secret templates (placeholders only)
│   ├── backend.yaml           # backend StatefulSet (1 replica) + PVC + Service
│   ├── auth.yaml              # auth StatefulSet (1 replica) + PVC + Service
│   ├── dispatcher.yaml        # dispatcher Deployment (1 replica), no Service
│   ├── artifacts.yaml         # artifact StatefulSet (1 replica) + PVC + Service + SA
│   ├── ingest-cronjob.yaml    # periodic POST /ingest to refresh the catalog
│   ├── networkpolicy.yaml     # optional default-deny-ingress + allows
│   ├── overlays/
│   │   ├── prod/              # production overlay (registry pinned)
│   │   ├── staging/           # staging overlay (tcab-staging, TCAB_ENV=staging)
│   │   └── local/             # k3d development mirror (driven by ../local/Makefile)
│   └── README.md              # apply order + per-environment notes
├── backups/
│   └── litestream.yml         # example Litestream config: stream the SQLite DB to object storage
├── telemetry/
│   └── otel-collector.yaml    # example OTel Collector config
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

The service images under `images/` are published to GHCR by the
[`build-service-images.yml`](../.github/workflows/build-service-images.yml) GitHub
Actions workflow on every push to `master` that touches the crates or a
Dockerfile, as `ghcr.io/<owner>/tcab-backend`, `…/tcab-auth-service`,
`…/tcab-dispatcher`, `…/tcab-driver`, and `…/tcab-artifacts` (each tagged `:latest`
and the immutable `:<git-sha>`). The kustomize overlays' `images:` blocks point
each at that namespace, pinning the `:<git-sha>` tag in a real deployment. To build
and push them by hand instead, see the build instructions in each Dockerfile's
header.

These are the long-running **service** images, distinct from the **run-container**
images a run executes inside ([`containers/`](../containers/README.md)), which are
published separately by [`build-containers.yml`](../.github/workflows/build-containers.yml).

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
