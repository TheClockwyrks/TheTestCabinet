---
title: Running the Local Service Stack
---

## Overview

This guide stands the whole Test Cabinet up on a throwaway local Kubernetes
cluster, from the same manifests staging and production apply. The cluster is
[k3d](https://k3d.io), k3s-in-Docker. Runs enqueued against it schedule as Jobs
inside the cluster exactly as they do in the cloud.

The [console](/components/web/overview/) is the one piece that runs from
source rather than in-cluster: a Vite dev server, so UI edits hot-reload
without an image rebuild.

[Running](/development/running/) is the developer reference this guide sits on
top of, and holds the authoritative list of every variable each service reads.

## The service-driven flow

1. The console enqueues a run by posting it to the backend's queue, under
   `/api` of its own origin. The backend is the one URL the console talks to
   for control.
2. The in-cluster dispatcher claims the queued run and creates one Kubernetes Job
   running the [driver](/components/driver/overview/).
3. The driver executes that single run, creating one ephemeral, untrusted sandbox
   pod for the model's work. It streams the
   [event timeline](/components/driver/events/) and asset preview back to the
   backend, uploads the produced tree to the
   [artifacts service](/components/artifacts/overview/) and the
   implementation's bundle to the [repos service](/components/repos/overview/),
   and reports terminal status with the run record.
4. The console reads the live stream from the backend, and the produced build
   and media from the artifacts service under `/artifacts`.

## Prerequisites

The bring-up builds every service image itself, so there are no service binaries
to build by hand. In the
[devcontainer](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.devcontainer/README.md)
the container runtime, `k3d`, and `kubectl` are already provided; on a bare host,
install them yourself. Either way you need:

- A container runtime. k3d runs the cluster nodes as containers, and the bring-up
  builds images through this runtime. It prefers `podman` when `podman version`
  answers and falls back to `docker` (the devcontainer's `podman` is a remote
  client, which cannot drive a Docker daemon); override with
  `CONTAINER_TOOL=… make …`.
- [`k3d`](https://k3d.io) and `kubectl` on `PATH`.
- `make`.
- The repositories the stack builds, checked out under the superrepo: every
  `microservice-*`, `contracts`, `engines`, the `tool-*` repositories the run
  images copy from, and `test-suites`; see
  [Cloning](/development/building/#cloning).
- A harness API key, exported in your shell or set in the gitignored
  superrepo-root `.env`. At least one of:

  | Harness                                          | Variable             |
  | ------------------------------------------------ | -------------------- |
  | `claude`                                         | `ANTHROPIC_API_KEY`  |
  | `codex`                                          | `OPENAI_API_KEY`     |
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

The Makefile resolves the superrepo root itself, so run this from anywhere in
the checkout:

```sh
make -C deployments/local local-up
```

This creates the k3d cluster, builds the backend, dispatcher, driver,
artifacts, repos, publisher and arena images from their checkouts plus every
[run-container image](/guides/setup/first-time-setup/#3-run-container-images)
and imports them with `k3d image import`, creates the cluster Secrets from your
environment, applies the
[`deployments/k8s/overlays/local`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/local)
kustomize overlay, and force-ingests the catalog from a read-only mount of the
`test-suites` checkout. It finishes once every service is rolled out.

The local overlay stands an Azurite blob emulator up as the artifacts and
repos services' object store, the private containers and the public bucket
alike.

With no harness key in the environment or `.env`, the bring-up stops before
applying and names the variables it accepts.

Every image the cluster runs is a local import with no registry behind it, so
the node's kubelet must keep them: the cluster is created with image garbage
collection disabled (`image-gc-high-threshold=100`), and `cluster` applies the
same setting to a cluster that already exists, restarting its node once; the
backend reports any run in flight at that restart as interrupted, and it must
be launched again. The kubelet's default otherwise deletes every image no
running pod uses whenever the node's filesystem (the host disk, under k3d)
passes 85% full, and the next run then waits in `queued` while its driver pod
sits in `ImagePullBackOff` on the driver image.

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

Ctrl-C stops it. It forwards the data plane the console's dev server proxies
to: the backend on `:8787` (live run stream), the artifacts service on `:8790`
(each run's playable build and proof/asset media, fetched as ordinary
`<img>`/`<iframe>` requests), the arena on `:8791`, the repos service on
`:8792`, and Grafana on `:3000`.

`make -C deployments/local local-grafana` forwards Grafana together with the OTLP
collector ports (`:4318` HTTP, `:4317` gRPC), for exporting telemetry from a
binary running outside the cluster.

## 3. Start the console

The console runs from source, in its own terminal, from the
`console.testcabinet.ai` checkout:

```sh
npm run dev   # in console.testcabinet.ai/
```

Then open <http://127.0.0.1:1430>. The dev server proxies `/api`, `/artifacts`
and `/arena` to the forwarded `127.0.0.1` ports, set in the committed
`vite.config.ts`, so the catalog loads on first visit and the page is
same-origin with its services exactly as a deployed console is. Override a
target with `TCAB_PROXY_BACKEND`, `TCAB_PROXY_ARTIFACTS` or `TCAB_PROXY_ARENA`
in a gitignored `.env.development.local`, to point at a different stack.

There is no sign-in locally. A deployed console sits behind Cloudflare Access
and the services attribute every mutation to the identity its assertion
carries; the local overlay configures no Access application, so the services
verify no assertion and record the identity the local console and `tcab` send
in `Cf-Access-Authenticated-User-Email`, `dev@local` by default.

## 4. Enqueue a run and watch it execute

From the console, start a run: pick a test case, a model, and the harness
whose key you exported. The console posts it to the backend's queue and begins
streaming.

Watch it schedule in the cluster:

```sh
kubectl -n tcab-local get jobs,pods -w
```

A driver Job appears, and the driver creates a sandbox pod for the model's work.
In the console the [event stream](/components/driver/events/) flows live. An
[asset-generation](/testing/asset-generation/overview/) case also shows the live
drawing preview, forwarded from the sandbox through the driver and backend.

When the run finishes, the driver uploads its tree and its bundle and reports
terminal status. The run becomes reviewable in the console, and its playable
build loads from the artifacts service. Each enqueued run schedules as its own
Job with no per-worker registration, so several runs proceed in parallel. A
completed validator-rated run publishes itself: the backend enqueues a publish
Job, the dispatcher creates a `tcab-publisher` Job, and the snapshot it writes
lands in the local emulator's public bucket.

## 5. Iterate and tear down

```sh
make -C deployments/local local-rebuild   # service code or manifest change
make -C deployments/local run-images      # tooling baked into a run image changed
make -C deployments/local local-reapply   # manifest-only change: re-apply, no rebuild
make -C deployments/local local-ingest    # a test case was edited: force re-ingest
make -C deployments/local local-import    # the node lost its images: re-import, no rebuild
make -C deployments/local secrets         # a key was rotated: re-create the Secrets
make -C deployments/local local-down      # delete the cluster and everything in it
```

`local-rebuild` covers the long-lived service images only, each built from its
repository's checkout. Tooling baked into a run-container image (`draw`,
`voxel-anim`, the Foray and Lattice binaries) reaches run pods only through
`run-images` and its per-type and per-image variants, which build the `tool-*`
images from their checkouts first.

`local-rebuild` re-ingests once the restarted backend is up, because a rebuilt
backend can read the definition store differently from the build that wrote it
and holds itself unready until an ingest rewrites the store (see
[the backend's test case definitions](/components/backend/overview/#test-case-definitions)).
The ingest is the incremental one, so a store the rebuild left readable costs
nothing.

`local-import` saves the service and run images already built in the container
runtime and imports them into the node again. It is the recovery for a node
whose images were deleted (a cluster created before image garbage collection was
disabled, for example). A driver Job stuck in `ImagePullBackOff` proceeds on its
own once the image is back, unless the node had to restart for the setting above.

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
`local-forward` exposes it at `127.0.0.1:8791`, which the console's dev server
proxies under `/arena` for its match and tournament actions. The backend
serves arena reads: published tournaments and stored replays.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run the stack produced.
- [Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/)
  releases a reviewed legacy run.
- [Deployment](/deployment/overview/) puts the same images on real staging and
  production hosts.
