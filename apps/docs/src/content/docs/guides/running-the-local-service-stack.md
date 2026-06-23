---
title: Running the Local Service Stack
---

This guide stands up the **whole Test Cabinet as a deployment runs it** — on your
own machine, on a throwaway Kubernetes cluster — so you can drive runs the way the
[web console](/components/web/overview/) does in the cloud rather than one at a
time from the [CLI](/components/cli/overview/).

It is the service-driven counterpart to [First Time Setup](/guides/first-time-setup/).
Where that guide gets you to a single CLI run (the CLI embeds the
[core](/components/core/overview/) runner directly, so it needs no backend or
cluster), this one brings up the **backend** (which owns the run queue), the
[auth service](/components/auth/overview/), the [dispatcher](/components/dispatcher/overview/),
the [artifact service](/components/artifacts/overview/), and the web console, and
runs them exactly as staging and prod do.

[Running](/development/running/) is the developer reference this guide sits on top
of — it holds the authoritative list of every variable each service reads. Reach
for it when you need a value this guide doesn't spell out.

## How the service-driven flow differs

A single CLI or [Tauri desktop](/components/tauri/overview/) run executes
in-process: the binary builds a [`RunEngine`](/components/core/execution/) and runs
the container itself. There is no queue and no second process.

The service-driven flow splits that apart so it can scale across a cluster:

1. A console **enqueues** a run by posting it to the **backend's** queue — the one
   URL a console talks to.
2. The in-cluster **dispatcher** claims the queued run and creates **one
   Kubernetes Job** running the [driver](/components/driver/overview/).
3. The **driver** executes that single run — under the Kubernetes runtime it
   creates one ephemeral, untrusted **sandbox pod** — streams its
   [event timeline](/components/core/events/) and asset preview back to the
   backend (which relays them to the console live), then uploads the produced
   source, build, and media to the **artifact service** and reports terminal
   status with the run record.
4. The console reads the live stream from the backend and the produced build and
   media from the artifact service (the backend reports the artifact service's URL
   via `GET /config`).

Because execution is now a cluster concern, the local mirror of it runs on a real
(local) Kubernetes cluster — [**k3d**](https://k3d.io), k3s-in-Docker — from the
**same manifests** a deployment uses. There is no worker process on the host; a
run you enqueue schedules as a Job inside the cluster, exactly as in the cloud.

## Prerequisites

You do **not** need to build the service binaries by hand — the bring-up builds
each service's container image from `deployments/images/`. You need:

- A **container runtime** (Docker, or a Docker-compatible one such as Podman). k3d
  runs the cluster nodes as containers, and the bring-up builds the images through
  this runtime — it uses `podman` when present and falls back to `docker`
  automatically (override with `CONTAINER_TOOL=… make …`).
- [`k3d`](https://k3d.io) and `kubectl` on `PATH`.
- `make` (the bring-up is driven by a Makefile).
- A **harness API key** exported in your shell — the run injects it into the
  sandbox. At least one of:

  | Harness | Variable |
  | --- | --- |
  | `claude` | `ANTHROPIC_API_KEY` |
  | `codex` | `OPENAI_API_KEY` |
  | `cline`, `goose`, `kilo`, `opencode`, `pi` | `OPENROUTER_API_KEY` |

  ```sh
  export ANTHROPIC_API_KEY=…    # the harness you intend to run
  ```

  The Makefile reads this from your environment and creates the cluster Secret
  from it, so **no key is ever written to a tracked file**.

- *(Optional)* **Subscription auth.** The `secrets` target also wires subscription
  mode into the local stack: if your host has signed-in harness CLI credential
  files — `~/.claude/.credentials.json` (+ `~/.claude.json`),
  `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), and/or the Antigravity
  OAuth token at `~/.gemini/antigravity-cli/antigravity-oauth-token` — it builds a
  `tcab-driver-subscription` Secret from whichever exist and the dispatcher mounts
  it (read-only, `optional`) into each driver Job. This is opt-in and never errors
  when the files are absent, so an API-key-only setup is unaffected. It is the only
  way to run the subscription-only [Antigravity](/harnesses/antigravity/overview/)
  harness locally. With the creds present and no API key, the engine prefers
  subscription on its own; lock it with `TCAB_AUTH_MODE` or the dispatcher's
  `TCAB_DISPATCHER_DRIVER_AUTH_MODE` if needed. See
  [Set Up Authentication](/quickstarts/set-up-authentication/#subscription-in-the-service-flow-the-cluster-path).

The harness [run-container image](/guides/first-time-setup/#3-the-run-container-image)
is pulled from the registry the first time a run needs it, so there is nothing to
pre-build for it.

:::caution[k3d and Podman]
k3d's first-class runtime is **Docker**. It often works on **Podman**, but needs
**rootful** Podman and the Docker-compatible socket; if `k3d cluster create` fails,
exporting `DOCKER_HOST=unix:///run/podman/podman.sock` (rootful) is the usual fix.
(Image loading is unaffected: the Makefile builds with the detected runtime and
hands k3d a saved tarball rather than an image name, so Podman's `localhost/`
naming doesn't trip up the import.) If Podman keeps fighting the cluster bring-up,
enable real Docker for this flow.
:::

## 1. Bring the stack up

From anywhere in the checkout (the Makefile resolves the repository root itself):

```sh
make -C deployments/local local-up
```

This creates a throwaway k3d cluster, builds the **backend**, **auth**,
**dispatcher**, **driver**, and **artifact** images and loads them into the
cluster with `k3d image import` (no registry needed), creates the cluster Secrets
from your environment (the harness key above, plus a fixed dev service token the
dispatcher claims jobs with), applies the
[`deployments/k8s/overlays/local`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/local)
kustomize overlay, and force-ingests the test-case catalog from a read-only mount
of the repository. It finishes once every service is rolled out.

If you forgot to export a harness key, the bring-up stops before applying with a
message naming the variables it accepts — export one and re-run.

Check what came up:

```sh
make -C deployments/local local-status      # pods, services, and volumes in the namespace
```

## 2. Expose the backend and auth service

The console needs the backend and the auth service reachable on localhost. Hold
them open in their own terminal:

```sh
make -C deployments/local local-forward     # backend → 127.0.0.1:8787, auth → 127.0.0.1:8789, arena → 127.0.0.1:8791
```

Leave this running (Ctrl-C stops it). Everything else the console needs — the live
stream, the artifact URLs — it learns from the backend.

## 3. Start the web console

In another terminal, run the console's dev server, pointing it at the forwarded
services:

```sh
VITE_BACKEND_URL=http://127.0.0.1:8787 \
VITE_AUTH_URL=http://127.0.0.1:8789 \
  npm run dev -w @test-cabinet/web
```

You can also set the backend URL in the UI instead of `VITE_BACKEND_URL`; the
console derives the auth URL from `VITE_AUTH_URL`, falling back to the backend URL
if it is unset. Either way the backend is the **one** URL the console talks to for
runs — there is no worker to register.

Open the console and **register an account**. Sign-in is required to **launch a
run** as well as to push, review, and publish — the backend gates `POST /jobs`
on the launching account and attributes the run to it, so every mutation
(enqueue included) needs a token. Reads still work signed-out, but those
mutations are rejected `401`. You can register in the UI, or with the CLI against
the forwarded auth service:

```sh
tcab register --username dev --display-name "Dev"
```

## 4. Enqueue a run and watch it execute

From the console — **signed in** (see step 3; the launch button stays disabled
with a sign-in prompt otherwise) — start a run: pick a test case, a model, and
the harness whose key you exported. The console posts it to the backend's queue,
authenticated as your account, and immediately begins streaming.

Watch it schedule as a Job in the cluster:

```sh
kubectl -n tcab-local get jobs,pods -w
```

You should see a **driver Job** appear, and — for the Kubernetes runtime — the
driver create a **sandbox pod** for the model's work. In the console, the
[event stream](/components/core/events/) flows live; for an
[asset-generation](/testing/asset-generation/overview/) case you also see the
live drawing preview, forwarded from the sandbox through the driver and backend.

When the run finishes, the driver uploads its artifacts and reports terminal
status. The run becomes reviewable in the console, and its playable build loads
**from the artifact service** — the control-plane backend never carries the
artifact bytes. Enqueue several runs at once and each schedules as its own Job,
with no per-worker registration — that is the scaling property the whole topology
is built for.

## 5. Iterate and tear down

```sh
make -C deployments/local local-rebuild     # after a code change: rebuild images + restart services
make -C deployments/local local-ingest      # after editing a test case: force re-ingest the catalog
make -C deployments/local secrets           # after rotating a key: re-create the Secrets from the environment
make -C deployments/local local-down        # delete the cluster and everything in it
```

Driver Jobs are created fresh per run, so they pick up a rebuilt `tcab-driver`
image (or a rotated key) on the next run with no restart. A re-ingest is required
after editing a case for the same reason it is for the bare backend: the store is
immutable per `(slug, version)`, so a backend-driven run keeps serving the
previous definition until you force the overwrite (see
[Running → re-ingest](/development/running/#start-the-backend)).

## Adversarial arena

**Adversarial-arena execution** (quick matches and tournaments) runs on the
**`tcab-arena`** service in the stack — the dedicated, CPU-bound execution host for
head-to-head controller matches. The local overlay brings it up alongside the other
services; reach it locally via `make -C deployments/local local-forward`, which adds
`arena → 127.0.0.1:8791`. The backend reports the arena's URL at `GET /config`
(`TCAB_ARENA_PUBLIC_URL`), and the console fetches it for its match/tournament run
actions; arena **reads** (published tournaments + stored replays) stay on the
backend. See the [adversarial](/testing/adversarial/overview/) type for what the
arena covers.

## Next steps

- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run
  the stack produced.
- [Publishing a Test Run Result](/guides/publishing-a-test-run-result/) — release
  a reviewed run.
- [Deployment](/deployment/overview/) — put the **same** images on real staging
  and prod hosts; what changes is the namespace, not how the flow is wired.
