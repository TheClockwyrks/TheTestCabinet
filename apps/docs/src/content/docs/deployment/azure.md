---
title: Azure (staging & prod)
---

This page builds a **staging** and a **production** environment for the
[backend](/components/backend/overview/) and
[workers](/components/worker/overview/) on Azure. Read the
[Overview](/deployment/overview/) first — in particular the
[two runtime shapes](/deployment/overview/#two-runtime-shapes) and the
[no-app-level-auth access model](/deployment/overview/#access-there-is-no-app-level-auth),
which are what make the backend a managed service and each worker a VM.

Azure is the worked example here because it is what this project's environments
run on, but nothing about the design is Azure-specific: the backend is "a managed
container with a volume and a single replica" and a worker is "a VM with a
container runtime on the private network." Any provider offering those works the
same way.

The example assets referenced below live under
[`deployments/azure/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/azure)
and
[`deployments/env/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env).
They are copy-pasteable starting points with placeholder values, not a managed
IaC pipeline — adapt them rather than running them blind.

## Topology

```
                 private network (Tailscale tailnet or Azure VNet)
   ┌─────────────────────────────────────────────────────────────────────┐
   │                                                                     │
   │   Azure Container App            VM / VM Scale Set                  │
   │   ┌───────────────────┐          ┌──────────────┐ ┌──────────────┐  │
   │   │  tcab-backend     │◀─────────│ tcab-worker  │ │ tcab-worker  │  │
   │   │  1 replica        │          │  + Docker    │ │  + Docker    │  │
   │   │  + volume (state) │          └──────────────┘ └──────────────┘  │
   │   └─────────┬─────────┘            each individually addressable    │
   │             │                                                       │
   │        web console (operator browser, joins the same network)       │
   └─────────────┼───────────────────────────────────────────────────────┘
                 │ outbound only
                 ▼
        Cloudflare R2 (snapshot) + Pages deploy hook  ──▶  public gallery
```

Everything sits on one private network per environment. The backend's only
inbound traffic is from workers and operators on that network; its only outbound
traffic is the snapshot upload to Cloudflare R2 and the deploy-hook call that
rebuilds the [public gallery](/components/site/overview/). Workers reach the
backend over the same network and reach model APIs and package registries from
inside their run containers.

One environment is one **resource group** — `rg-tcab-staging` and
`rg-tcab-prod` — so the two are fully isolated and tearing one down is a single
operation. Build staging first, confirm the flow, then repeat for prod with
prod's own secrets and a `TCAB_ENV=prod` tag.

## Prerequisites

- An Azure subscription and the `az` CLI, logged in (`az login`).
- An **Azure Container Registry** (or another registry the Container App can pull
  from) to hold the backend image.
- A private network. The default here is a [Tailscale](https://tailscale.com/)
  tailnet with an auth key per environment; the
  [Azure-native alternative](#alternative-an-azure-native-private-network) is at
  the end.
- The publishing credentials a worker needs if it will publish runs: a
  `GITHUB_TOKEN` and a Cloudflare API token, plus the backend's R2 credentials
  and site deploy-hook URL. See
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example)
  and
  [`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example)
  for the full list; treat all of them as secrets.

The example
[`deployments/azure/az-provision.sh`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/azure/az-provision.sh)
collects the commands below into one annotated script you can step through.

## Backend on Azure Container Apps

The backend is [stateful](/deployment/overview/#two-runtime-shapes): it owns a
SQLite database, an on-disk definition store, a checkout it ingests from, and a
headless browser for rendering references. Hosting it on Container Apps works,
but three things are non-negotiable and follow directly from that:

1. **A single replica.** SQLite is single-writer and the store is local, so the
   app must be pinned `minReplicas = maxReplicas = 1`. This service coordinates
   publishes and serves a low-traffic API; it is not something you scale out.
2. **A persistent volume.** Mount an Azure Files share at the paths
   `TCAB_BACKEND_DB`, `TCAB_BACKEND_STORE`, and `TCAB_BACKEND_CHECKOUT` point to,
   so the database, store, and checkout survive a revision or restart. Prefer an
   **NFS** Azure Files share for the SQLite file — SMB file locking interacts
   poorly with SQLite. A volume survives restarts but is **not** a backup; see
   [Backups](/deployment/backups/).
3. **An image with a browser.** The stock binary has no Chromium. Build the
   backend image from
   [`deployments/azure/backend.Dockerfile`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/azure/backend.Dockerfile),
   which layers the `tcab-backend` binary and a headless Chromium; set
   `TCAB_REFERENCE_BROWSER` to that browser if it is not auto-detected.

Internal ingress only — the Container App must not have a public FQDN. Workers
and operators reach it over the private network, and its outbound R2 and
deploy-hook calls do not require inbound exposure.

Steps:

```sh
# Build and push the backend image (includes Chromium).
az acr build -r <registry> -t tcab-backend:<tag> \
  -f deployments/azure/backend.Dockerfile .

# Create the Container Apps environment and an Azure Files volume for state,
# then deploy the app pinned to one replica with internal-only ingress.
# deployments/azure/containerapp.yaml is an example app definition; fill in the
# image, the mounted volume, and the env values from
# deployments/env/backend.<env>.env.example.
az containerapp create -g rg-tcab-<env> -n tcab-backend \
  --yaml deployments/azure/containerapp.yaml
```

Provide the backend's secrets (R2 keys, deploy-hook URL) as Container Apps
secrets referenced by the env vars, not as plain values in the YAML. The
non-secret settings — bind address, the volume paths, `TCAB_ENV` — come from
[`deployments/env/backend.<env>.env.example`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env).

### Ingesting definitions

The backend serves the catalog from the checkout at `TCAB_BACKEND_CHECKOUT`,
populated by calling `POST /ingest` (see the
[backend API](/components/backend/overview/#responsibilities)). Put the
repository on the mounted volume and refresh it when test cases change — for
example a small scheduled job that pulls the repo into the volume and then calls
`POST /ingest`. Because the volume is persistent, this is a periodic update, not
something that happens on every restart.

> **Simpler alternative.** If running a stateful service on Container Apps feels
> like more than you want, the backend also runs cleanly as a `tcab-backend`
> systemd service on a VM — the same VM you already run workers on, or its own.
> The example
> [`deployments/systemd/tcab-backend.service`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/systemd/tcab-backend.service)
> unit and a local Chromium make this a one-box deployment with no Azure Files or
> custom image. The managed path above is the default; this is a valid, simpler
> trade.

## Workers on VMs

A worker [must run on a host with a container runtime](/deployment/overview/#two-runtime-shapes),
so each worker is a VM. Provision identical nodes — one to start for staging, a
small pool for prod — with the cloud-init in
[`deployments/azure/worker-cloud-init.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/azure/worker-cloud-init.yaml),
which on first boot:

- installs Docker and pulls the harness [container images](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md);
- installs the `tcab-worker` binary and a
  [`tcab-worker.service`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/systemd/tcab-worker.service)
  systemd unit that reads `/etc/test-cabinet/worker.env`;
- joins the private network (a Tailscale auth key is passed in as cloud-init
  data) so the node comes up with its own stable private address.

```sh
az vm create -g rg-tcab-<env> -n tcab-worker-1 \
  --image Ubuntu2404 --size <size> \
  --custom-data deployments/azure/worker-cloud-init.yaml
# Repeat per node, or use a VM Scale Set with the same custom-data.
```

Each worker's `/etc/test-cabinet/worker.env` is built from
[`deployments/env/worker.<env>.env.example`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env):
it sets `TCAB_BACKEND_URL` to the backend's private address, `TCAB_ENV`, and the
harness API keys (and, if the worker publishes, the GitHub and Cloudflare
credentials). Inject the secret values from your secret store; the committed
template carries placeholders only.

### A "pool" is individually-addressed nodes

Because [worker jobs are per-instance](/deployment/overview/#access-there-is-no-app-level-auth),
do **not** put workers behind a single load balancer — a run submitted through
one address must be polled on that same node, and a round-robin LB would scatter
the follow-up requests. Scale by adding nodes, each registered in the
[web console](/components/web/overview/) by its own private URL. A mesh VPN makes
this painless: every node has its own `100.x` address the moment it joins. A VM
Scale Set is fine for *provisioning* identical nodes, but address them
individually, not through the scale set's load balancer.

## Per-environment differences

Staging and prod are the same topology; keep them that way so staging actually
rehearses prod. Only these differ:

| | Staging | Prod |
| --- | --- | --- |
| Resource group | `rg-tcab-staging` | `rg-tcab-prod` |
| `TCAB_ENV` | `staging` | `prod` |
| Workers | one node is enough | a pool sized to demand |
| Private network | its own tailnet tag / VNet | its own tailnet tag / VNet |
| Secrets | staging keys & tokens | prod keys & tokens |

Use separate Cloudflare R2 buckets (and deploy hooks) per environment if you want
staging publishes to land in a separate gallery dataset from prod; point each
backend's `TCAB_R2_*` and `TCAB_SITE_DEPLOY_HOOK_URL` at the right one.

## Alternative: an Azure-native private network

If you would rather not depend on a third-party mesh VPN, replace Tailscale with
an Azure VNet:

- Put the worker VMs and the Container Apps environment on private subnets of one
  VNet per environment, with NSGs restricting traffic to within the VNet.
- Give the backend internal ingress on the VNet so workers resolve it by its
  private address.
- Reach the environment as an operator through an **Azure VPN Gateway** or
  **Azure Bastion** rather than any public endpoint.

The trade is more Azure-specific networking to stand up and maintain, and per-VM
private addressing to manage for the individually-addressed worker requirement,
versus Tailscale handing each node a stable address for free. The service
configuration is otherwise unchanged — only how hosts find each other differs.

## Operating these environments

Two cross-cutting concerns have their own pages:

- **[Backups](/deployment/backups/)** — the only irreplaceable data is the
  backend's database, so backups reduce to protecting that one store. The
  strategy is tied to the backend-hosting choice above: a SQLite backend on a VM
  streams to object storage with Litestream, while managed PostgreSQL hands you
  provider-managed point-in-time restore.
- **[Telemetry](/deployment/telemetry/)** — choosing and wiring an OTLP collector
  for staging and prod, tagged by `TCAB_ENV`. Enable it in both environments.
