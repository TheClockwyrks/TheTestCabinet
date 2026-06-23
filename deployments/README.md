# Deployment assets

Copy-pasteable templates for deploying The Test Cabinet's three long-running
services — the **backend** (`tcab-backend`), the **worker** (`tcab-worker`), and
the **auth service** (`tcab-auth-service`) — to **Kubernetes**, where the worker
spawns each run as a separate pod via the Kubernetes API.

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
│   └── compose.yml            # backend + auth service in containers; worker runs on the host
├── images/                    # service images, published to GHCR by CI (see below)
│   ├── backend.Dockerfile     # tcab-backend + headless Chromium
│   ├── auth.Dockerfile        # tcab-auth-service, slimmer runtime (no Chromium/fonts)
│   └── worker.Dockerfile      # tcab-worker + publish CLIs (git/gh/wrangler); no container engine
├── k8s/
│   ├── namespace.yaml         # per-environment namespace
│   ├── rbac.yaml              # tcab-worker ServiceAccount + Role to manage run pods
│   ├── secrets.example.yaml   # Secret templates (placeholders only)
│   ├── backend.yaml           # backend StatefulSet (1 replica) + PVC + Service
│   ├── auth.yaml              # auth StatefulSet (1 replica) + PVC + Service
│   ├── worker.yaml            # worker StatefulSet + headless Service
│   ├── ingest-cronjob.yaml    # periodic POST /ingest to refresh the catalog
│   ├── networkpolicy.yaml     # optional default-deny-ingress + allows
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
    ├── worker.staging.env.example
    └── worker.prod.env.example
```

See the docs' [Backups](../apps/docs/src/content/docs/deployment/backups.md) and
[Telemetry](../apps/docs/src/content/docs/deployment/telemetry.md) pages for what
`backups/` and `telemetry/` are for. The `env/` files mirror the values the
`k8s/` manifests set as container env vars; they are a convenient single-file view
of each service's configuration.

## Service images

The three service images under `images/` are published to GHCR by the
[`build-service-images.yml`](../.github/workflows/build-service-images.yml) GitHub
Actions workflow on every push to `master` that touches the crates or a
Dockerfile, as `ghcr.io/<owner>/tcab-backend`, `…/tcab-auth-service`, and
`…/tcab-worker` (each tagged `:latest` and the immutable `:<git-sha>`). Point the
`k8s/` manifests' `image:` fields (the `REPLACE_REGISTRY` placeholder) at that
namespace, pinning the `:<git-sha>` tag in a real deployment. To build and push
them by hand instead, see the build instructions in each Dockerfile's header.

These are the long-running **service** images, distinct from the **run-container**
images a run executes inside ([`containers/`](../containers/README.md)), which are
published separately by [`build-containers.yml`](../.github/workflows/build-containers.yml).

## Secrets

Every file here is a **template with placeholder values only** — never commit a
real secret. The per-environment files under `env/` are deliberately thin; the
repo-root [`.env.backend.example`](../.env.backend.example),
[`.env.auth.example`](../.env.auth.example), and
[`.env.worker.example`](../.env.worker.example) remain the authoritative
reference for every variable each service reads. Supply real values through
Kubernetes `Secret`s populated from your secret manager (External Secrets, Sealed
Secrets, `kubectl create secret`, …).
