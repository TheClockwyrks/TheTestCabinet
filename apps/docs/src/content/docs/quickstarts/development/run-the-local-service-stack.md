---
title: Run the Local Service Stack
---

## Overview

Bring the service-driven flow up on a local [k3d](https://k3d.io) cluster:
backend, dispatcher, artifacts, repos, publisher and arena services. Runs are
enqueued at the backend, and an in-cluster
[dispatcher](/components/dispatcher/overview/) schedules each one as a per-run
[driver](/components/driver/overview/) Job. The console runs from source
against the forwarded services.

The full walkthrough is
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/);
every service variable is in [Running](/development/running/).

## Prerequisites

- Docker (or a Docker-compatible runtime), [`k3d`](https://k3d.io), `kubectl`,
  and `make` on `PATH`. k3d's first-class runtime is Docker; Podman must be
  rootful and expose the Docker socket.
- The `microservice-*`, `contracts`, `engines`, `tool-*` and `test-suites`
  repositories checked out under the superrepo
  ([Cloning](/development/building/#cloning)).
- A harness API key exported, or set in the superrepo's `.env`:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`. The Makefile
  reads it into the cluster Secret. See
  [Set Up Authentication](/quickstarts/setup/set-up-authentication/).

## Steps

```sh
export OPENROUTER_API_KEY=…                   # the harness you'll run

make -C deployments/local local-up            # cluster + images + secrets + overlay + ingest
make -C deployments/local local-forward       # hold the forwards open (its own terminal)
npm run dev                                   # in console.testcabinet.ai/ (its own terminal)
```

`local-forward` exposes the backend on `:8787`, artifacts on `:8790`, arena on
`:8791`, repos on `:8792`, and Grafana on `:3000`. The console's dev server
proxies `/api`, `/artifacts` and `/arena` to them, so open
<http://127.0.0.1:1430> and the catalog loads. The local overlay verifies no
Access assertion, so there is nothing to sign in to: every mutation is recorded
under the identity the console sends in `Cf-Access-Authenticated-User-Email`,
`dev@local` by default. Then, in the console:

1. Enqueue a run: pick a case, a model, and the harness whose key you exported.
   The console streams its [events](/components/driver/events/) live.
2. Watch it schedule with `kubectl -n tcab-local get jobs,pods -w`. The finished
   run is reviewable, its build served from the
   [artifacts service](/components/artifacts/overview/).

## Manage

```sh
make -C deployments/local local-status        # pods, services, volumes
make -C deployments/local local-rebuild       # after a code change: rebuild + restart
make -C deployments/local run-images          # after changing run-container tooling
make -C deployments/local local-ingest        # after editing a case: force re-ingest
make -C deployments/local local-down          # delete the cluster and everything in it
```

`local-rebuild` rebuilds the long-lived service images from their checkouts.
Changes to the tooling baked into the run-container images need `run-images`.

## Next steps

- [Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
  is the full guide, including topology and troubleshooting.
- [Review a Run](/quickstarts/development/review-a-run/) and
  [Publish a Run](/quickstarts/devops/publish-a-run/).
