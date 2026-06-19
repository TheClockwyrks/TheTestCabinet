---
title: Overview
---

This section covers standing up The Test Cabinet's two long-running **services**
— the [backend](/components/backend/overview/) (`tcab-backend`) and the
[worker](/components/worker/overview/) (`tcab-worker`) — as **remote**
environments: a [staging and a production](/deployment/azure/) environment on
Azure. The guidance is written to be reproducible by anyone running their own
instance; there is nothing here that is specific to a private deployment.

To run the same services **entirely on one machine** for development — the local
mirror of everything below — see [Running](/development/running/) in the
Development section. This section mentions the local shape where it helps explain
the remote one, but its emphasis is the real, remote build.

For the **static** surfaces — the public [gallery](/components/site/overview/),
this [docs site](/components/docs/overview/), and the per-run playable builds —
see [Releasing](/development/releasing/) instead. Those are built in CI and need
no servers. This section is only about the services that do.

## What gets deployed

| Thing | Deployed as | Covered by |
| ----- | ----------- | ---------- |
| [Backend](/components/backend/overview/) (`tcab-backend`) | A long-running HTTP service | This section |
| [Worker](/components/worker/overview/) (`tcab-worker`) | A long-running HTTP service on a host with a container runtime | This section |
| [Web console](/components/web/overview/) (`apps/web`) | A static bundle served to operators on the private network | This section |
| [Gallery](/components/site/overview/), [docs](/components/docs/overview/), per-run builds | Static sites built in CI | [Releasing](/development/releasing/) |
| [CLI](/components/cli/overview/) (`tcab`), [Tauri app](/components/tauri/overview/) | Local tools an operator installs | Not deployed — see [Building](/development/building/) |

The [CLI](/components/cli/overview/) and [Tauri app](/components/tauri/overview/)
are runner/reporter tools that an individual operator runs on their own machine;
they are not part of a deployment. The web console *is* part of one, but it is
just a static bundle — the only stateful, always-on processes to operate are the
backend and the workers.

## Environments

The same two binaries run in every environment; what changes is where they bind,
what they talk to, and how they are kept up. The custom `TCAB_ENV` variable tags
each one (`local`, `staging`, `prod`) so [telemetry](/development/observability/)
and logs from each can be told apart.

| Environment | Purpose | Backend | Workers |
| ----------- | ------- | ------- | ------- |
| **Local** | Exercise the whole flow on one machine (development) | A process (or container) on `localhost` | A process on the host, using the host's container runtime |
| **Staging** | A production-shaped environment to validate changes | Managed (Azure Container Apps) | One or more VM nodes |
| **Prod** | The environment operators actually use | Managed (Azure Container Apps) | A pool of VM nodes |

The **local** environment is a development convenience and is documented under
[Running](/development/running/), not here. This section is about the two
**remote** environments: staging and prod are the *same* topology — keep them
identical so staging is a faithful rehearsal — differing only in scale, their own
secrets, and their `TCAB_ENV` tag. See [Azure: staging & prod](/deployment/azure/).

## Two runtime shapes

The backend and the worker have very different hosting needs, and that
difference drives every choice in this section.

- **A worker host needs a real container runtime.** Each run executes inside a
  fresh container the worker starts itself (see
  [Execution](/components/core/execution/) and
  [Run Containers](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)).
  Running a worker therefore means running Docker- or Podman-in-a-container, so a
  worker belongs on a **VM** (or any host with a normal container runtime), not
  on a serverless container platform that forbids nested/privileged containers.
- **The backend is a (mostly) stateful service with no container runtime.** It
  keeps a database, an on-disk definition store, and a repository checkout it
  ingests from, and it renders reference screenshots with a headless browser at
  ingest. With its default embedded **SQLite** store it runs on a managed
  container platform provided it is pinned to a **single replica** (SQLite is
  single-writer) with a **persistent volume** and an image that includes a
  browser. Pointing `TCAB_BACKEND_DATABASE_URL` at a managed **PostgreSQL**
  instead lifts the single-replica and database-volume constraints. The details
  are in [Azure: staging & prod](/deployment/azure/#backend-on-azure-container-apps).

| Service | Container runtime on host? | Persistent storage | External egress |
| ------- | ------------------------- | ------------------ | --------------- |
| Worker | **Yes** — runs each test case in a container | Scratch only (`TCAB_WORKER_OUT_DIR`, `TCAB_WORK_DIR`) | Model APIs + package registries (from inside run containers); GitHub & Cloudflare when it publishes |
| Backend | No | **Yes** — database (SQLite, or external PostgreSQL), definition store, ingest checkout | Cloudflare R2 (snapshot upload) + the site's deploy hook |

## Access: there is no app-level auth

Neither service has accounts, tokens, or a login. As described under
[Backend authentication](/components/backend/overview/#authentication), the model
is that **reachability is the access control**: both services bind to a private
address and are never exposed to the public internet, so only machines and people
who can already reach them on a private network can use them.

That has one consequence worth stating up front, because it shapes the worker
topology: a [worker's jobs are held per-instance](/components/worker/overview/) —
`POST /runs` returns a job id you then poll on the *same* worker, and the
[web console](/components/web/overview/) adds workers **by URL, one at a time**. A
worker "pool" is therefore a set of **individually addressable** hosts, never a
single load-balanced endpoint. Giving each worker its own stable private address
is exactly what a mesh VPN does for free.

Two ways to provide that private network are documented, and you can pick either:

- **Tailscale (or a comparable mesh VPN)** — the simple, portable default. Each
  service gets its own stable `100.x` address on your tailnet, which suits the
  per-worker addressing above and is identical whether a host is on Azure, on
  another cloud, or under your desk. This is what the
  [`.env` examples](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example)
  already assume.
- **An Azure-native private network** — a VNet with the services on private
  subnets, reached through a VPN gateway or Azure Bastion. No third-party
  dependency, at the cost of more setup and being Azure-specific. Covered as an
  alternative in [Azure: staging & prod](/deployment/azure/#alternative-an-azure-native-private-network).

## Secrets and telemetry

- **Secrets** — harness API keys, the `GITHUB_TOKEN` and Cloudflare token used
  when a worker publishes, and the backend's R2 credentials and deploy-hook URL —
  are supplied through the environment or your platform's secret store and are
  **never committed**. Every file under
  [`deployments/`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments)
  is an `.example`/placeholder template, matching the repo-root
  [`.env.backend.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.backend.example)
  and
  [`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example),
  which remain the authoritative reference for every variable each service reads.
- **Telemetry** is opt-in and vendor-neutral and is configured the same way in
  every environment — by pointing the standard `OTEL_*` variables at a collector.
  The variables themselves are documented under
  [Observability](/development/observability/); choosing and wiring a collector
  for a deployment is covered in [Telemetry](/deployment/telemetry/).

Two operational concerns get their own pages because they apply across every
environment: keeping published runs safe ([Backups](/deployment/backups/)) and
seeing what the services are doing ([Telemetry](/deployment/telemetry/)).

## Where to go next

- [Azure: staging & prod](/deployment/azure/) — the managed-backend +
  worker-VM build, for both environments.
- [Running](/development/running/) — the local mirror: the backend, a worker, and
  the web console together on one machine, for development.
- [Backups](/deployment/backups/) — what's actually at risk (just the backend's
  database) and how to protect it.
- [Telemetry](/deployment/telemetry/) — choosing and wiring a collector for
  staging and prod.
