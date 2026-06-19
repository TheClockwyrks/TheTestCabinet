# Deployment assets

Copy-pasteable templates for deploying The Test Cabinet's two long-running
services — the **backend** (`tcab-backend`) and the **worker** (`tcab-worker`).

This folder holds the *assets*; the authoritative, narrative documentation is the
**Deployment** section of the docs site, which explains what these files are for
and how they fit together:

- Overview — `apps/docs/src/content/docs/deployment/overview.md`
- Azure (staging & prod) — `apps/docs/src/content/docs/deployment/azure.md`

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
│   └── compose.yml            # backend in a container; worker runs on the host
├── azure/
│   ├── backend.Dockerfile     # tcab-backend + headless Chromium, for Azure Container Apps
│   ├── containerapp.yaml      # example Container App: 1 replica, state volume, env refs
│   ├── worker-cloud-init.yaml # VM/VMSS first-boot: Docker + harness images + worker unit + Tailscale
│   └── az-provision.sh        # annotated `az` CLI walkthrough for one environment
├── systemd/
│   ├── tcab-backend.service   # for the VM fallback (backend on a VM instead of Container Apps)
│   └── tcab-worker.service    # worker on a VM
├── backups/
│   └── litestream.yml         # example Litestream config: stream the SQLite DB to object storage
├── telemetry/
│   └── otel-collector.yaml    # example OTel Collector config for the Azure Monitor path
└── env/
    ├── backend.staging.env.example
    ├── backend.prod.env.example
    ├── worker.staging.env.example
    └── worker.prod.env.example
```

See the docs' [Backups](apps/docs/src/content/docs/deployment/backups.md) and
[Telemetry](apps/docs/src/content/docs/deployment/telemetry.md) pages for what
`backups/` and `telemetry/` are for.

## Secrets

Every file here is a **template with placeholder values only** — never commit a
real secret. The per-environment files under `env/` are deliberately thin; the
repo-root [`.env.backend.example`](../.env.backend.example) and
[`.env.worker.example`](../.env.worker.example) remain the authoritative
reference for every variable each service reads. Supply real values through your
platform's secret store (Container Apps secrets, a VM's `/etc/test-cabinet/*.env`
populated from a secret manager, etc.).
