---
title: Running the Local Service Stack
---

## Overview

This guide stands the whole Test Cabinet up on a throwaway local Kubernetes
cluster, from the same manifests staging and production apply. The cluster is
[k3d](https://k3d.io), k3s-in-Docker. Runs enqueued against it schedule as Jobs
inside the cluster exactly as they do in the cloud.

The [web console](/components/web/overview/) is the one piece that runs from
source rather than in-cluster: a Vite dev server, so UI edits hot-reload without
an image rebuild.

[Running](/development/running/) is the developer reference this guide sits on
top of, and holds the authoritative list of every variable each service reads.

## The service-driven flow

1. A console or the [CLI](/components/cli/overview/) enqueues a run by posting it
   to the backend's queue. The backend is the one URL a console talks to.
2. The in-cluster dispatcher claims the queued run and creates one Kubernetes Job
   running the [driver](/components/driver/overview/).
3. The driver executes that single run, creating one ephemeral, untrusted sandbox
   pod for the model's work. It streams the
   [event timeline](/components/core/events/) and asset preview back to the
   backend, uploads the produced source, build, and media to the
   [artifact service](/components/artifacts/overview/), and reports terminal
   status with the run record.
4. The console reads the live stream from the backend, and the produced build and
   media from the artifact service. The backend reports the artifact service's
   URL at `GET /config`.

## Prerequisites

The bring-up builds every service image itself, so there are no service binaries
to build by hand. In the
[devcontainer](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.devcontainer/README.md)
the container runtime, `k3d`, and `kubectl` are already provided; on a bare host,
install them yourself. Either way you need:

- A container runtime. k3d runs the cluster nodes as containers, and the bring-up
  builds images through this runtime. It prefers `podman` when present and falls
  back to `docker`; override with `CONTAINER_TOOL=… make …`.
- [`k3d`](https://k3d.io) and `kubectl` on `PATH`.
- `make`.
- A harness API key, exported in your shell or set in the gitignored repo-root
  `.env`. At least one of:

  | Harness | Variable |
  | --- | --- |
  | `claude` | `ANTHROPIC_API_KEY` |
  | `codex` | `OPENAI_API_KEY` |
  | `cline`, `goose`, `kilo`, `opencode`, `pi`, `gg` | `OPENROUTER_API_KEY` |

  ```sh
  export ANTHROPIC_API_KEY=…    # the harness you intend to run
  ```

  The `secrets` target creates the cluster Secret from this, so the key stays out
  of every tracked file.

- Subscription credentials, optionally. The `secrets` target also builds a
  `tcab-driver-subscription` Secret from whichever signed-in harness credential
  files exist on the host: `~/.claude/.credentials.json`, `~/.claude.json`,
  `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), and
  `~/.gemini/antigravity-cli/antigravity-oauth-token`. The dispatcher mounts it
  read-only into each driver Job. This is how the subscription-only
  [Antigravity](/harnesses/antigravity/overview/) harness runs locally. With the
  credentials present and no API key the engine prefers subscription on its own.
  Pin it with `TCAB_AUTH_MODE` or the dispatcher's
  `TCAB_DISPATCHER_DRIVER_AUTH_MODE`. See
  [Set Up Authentication](/quickstarts/setup/set-up-authentication/#subscription).

:::caution[k3d and Podman]
k3d's first-class runtime is Docker. On Podman it needs rootful Podman and the
Docker-compatible socket; when `k3d cluster create` fails, exporting
`DOCKER_HOST=unix:///run/podman/podman.sock` is the usual fix. Image loading is
unaffected either way: the Makefile builds with the detected runtime and hands
k3d a saved tarball rather than an image name.
:::

## 1. Bring the stack up

The Makefile resolves the repository root itself, so run this from anywhere in
the checkout:

```sh
make -C deployments/local local-up
```

This creates the k3d cluster, builds the backend, auth, dispatcher, driver,
artifact, and arena images plus every
[run-container image](/guides/setup/first-time-setup/#3-run-container-images) and
imports them with `k3d image import`, creates the cluster Secrets from your
environment, applies the
[`deployments/k8s/overlays/local`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/local)
kustomize overlay, and force-ingests the catalog from a read-only mount of the
repository. It finishes once every service is rolled out.

With no harness key in the environment or `.env`, the bring-up stops before
applying and names the variables it accepts.

Check what came up:

```sh
make -C deployments/local local-status      # pods, services, and volumes in the namespace
```

## 2. Expose the stack on localhost

The browser runs outside the cluster, so reach the in-cluster services over a
port-forward. Hold it open in its own terminal:

```sh
make -C deployments/local local-forward
```

Ctrl-C stops it. It forwards the data plane the browser talks to directly: the
backend on `:8787` (live run stream), the auth service on `:8789`, the artifact
service on `:8790` (each run's playable build and proof/asset media, fetched as
ordinary `<img>`/`<iframe>` requests), the arena on `:8791`, and Grafana on
`:3000`. The local overlay points the artifact and arena URLs the backend
advertises at these forwarded `127.0.0.1` ports.

`make -C deployments/local local-grafana` forwards Grafana together with the OTLP
collector ports (`:4318` HTTP, `:4317` gRPC), for exporting telemetry from a
binary running outside the cluster.

## 3. Start the web console

The console runs from source. In its own terminal:

```sh
npm run -w apps/web dev
```

Then open <http://127.0.0.1:1430>. Its backend and auth URLs are pre-set to the
forwarded `127.0.0.1:8787` and `:8789` in the committed
`apps/web/.env.development`, so the catalog loads on first visit. Override the
backend URL in the UI's settings, or with `VITE_BACKEND_URL` in a gitignored
`.env.development.local`, to point at a different stack.

Then register an account. Sign-in is required to launch a run as well as to
review and publish: the backend gates `POST /jobs` on the launching account and
attributes the run to it. Reads work signed-out; mutations are rejected `401`.
Register in the UI, or with the CLI against the forwarded auth service:

```sh
tcab register --username dev --display-name "Dev"
```

## 4. Enqueue a run and watch it execute

From the console, signed in, start a run: pick a test case, a model, and the
harness whose key you exported. The console posts it to the backend's queue and
begins streaming.

Watch it schedule in the cluster:

```sh
kubectl -n tcab-local get jobs,pods -w
```

A driver Job appears, and the driver creates a sandbox pod for the model's work.
In the console the [event stream](/components/core/events/) flows live. An
[asset-generation](/testing/asset-generation/overview/) case also shows the live
drawing preview, forwarded from the sandbox through the driver and backend.

When the run finishes, the driver uploads its artifacts and reports terminal
status. The run becomes reviewable in the console, and its playable build loads
from the artifact service. Each enqueued run schedules as its own Job with no
per-worker registration, so several runs proceed in parallel.

## 5. Iterate and tear down

```sh
make -C deployments/local local-rebuild   # service code or manifest change
make -C deployments/local run-images      # tooling baked into a run image changed
make -C deployments/local local-reapply   # manifest-only change: re-apply, no rebuild
make -C deployments/local local-ingest    # a test case was edited: force re-ingest
make -C deployments/local secrets         # a key was rotated: re-create the Secrets
make -C deployments/local local-down      # delete the cluster and everything in it
```

`local-rebuild` covers the long-lived service images only. Tooling baked into a
run-container image (`draw`, `voxel-anim`, the Foray and Lattice binaries)
reaches run pods only through `run-images` and its per-type and per-image
variants.

Driver Jobs are created fresh per run, so a rebuilt `tcab-driver` image or a
rotated key takes effect on the next run with no restart. A re-ingest is required
after editing a case because the definition store is immutable per
`(slug, version)`: the backend keeps serving the previous definition until the
overwrite is forced. See
[Running → starting the backend](/development/running/#starting-the-backend).

## Adversarial arena

Quick matches and tournaments for the
[adversarial](/testing/adversarial/overview/) type run on the `tcab-arena`
service, the dedicated CPU-bound execution host for head-to-head controller
matches. The local overlay brings it up alongside the other services and
`local-forward` exposes it at `127.0.0.1:8791`. The backend reports the arena's
URL at `GET /config` (`TCAB_ARENA_PUBLIC_URL`) and the console fetches it for its
match and tournament actions. The backend serves arena reads: published
tournaments and stored replays.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run the stack produced.
- [Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/)
  releases a reviewed run.
- [Deployment](/deployment/overview/) puts the same images on real staging and
  production hosts.
