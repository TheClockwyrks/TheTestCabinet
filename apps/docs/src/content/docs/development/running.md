---
title: Running
---

Every run is enqueued at the backend by the
[console](/components/web/overview/) and executed in a cluster; the
[CLI](/components/cli/overview/) (`tcab`) ingests, validates and publishes
references against the same backend. Nothing executes a test case on the
machine that asked for it. Running The Test Cabinet locally therefore means
standing up the service stack that drains the queue.

Execution is a cluster concern. The console enqueues a run at the
[backend](/components/backend/overview/); an in-cluster
[dispatcher](/components/dispatcher/overview/) claims it and creates a per-run
Kubernetes `Job` running the [driver](/components/driver/overview/), which
executes that one run. The local stack runs on a k3d cluster (k3s-in-Docker)
from the same manifests a [deployment](/deployment/overview/) applies, so what
runs locally and what runs in staging or production differ only in the
namespace they live in and the edge in front of them.

## Prerequisites

- A container runtime (Docker or Podman), needed by k3d, which runs the cluster
  as containers. In the dev container this is the host's runtime, reached the
  way the host's `.devcontainer/.env` says (see
  [The dev container](#the-dev-container)); on a bare host it is the local one.
- [`k3d`](https://k3d.io) and `kubectl`. Both ship in the devcontainer; install
  them yourself on a bare host.
- The repositories the stack builds checked out under the superrepo: every
  `microservice-*`, with `contracts` and `engines` they build against, the
  `tool-*` repositories the run images copy from, and `test-suites`, which the
  backend ingests; see
  [Cloning](/development/building/#cloning).
- A harness API key for the harness you will run, for example
  `ANTHROPIC_API_KEY` for `claude`.
- For the bare-process path below, the backend built per
  [Building](/development/building/): `cargo build -p test-cabinet-backend` in
  `microservice-backend/`.

The console is a Vite app in `console.testcabinet.ai/` and does not run in the
local k3d cluster. You run its dev server from source, so a UI edit hot-reloads
instead of forcing an image rebuild. The dev server proxies `/api`,
`/artifacts` and `/arena` to the forwarded services, so the page is
same-origin with them exactly as a deployed console is behind the
[edge](/deployment/kubernetes/edge/). Only staging and production serve it
in-cluster as the `tcab-web` image.

## The dev container

Everything on this page runs inside the dev container, declared under
`.devcontainer/` (see its `README.md`). It drives the host's container
runtime rather than running its own, and what differs per host is in
`.devcontainer/.env`, which compose reads beside `docker-compose.yml`. **Copy
the host's file there before the first start.**

| Host | `.devcontainer/.env` |
| --- | --- |
| macOS, Podman | `cp .devcontainer/.env.macos .devcontainer/.env`. Start `.devcontainer/tools/macos-host-runtime.sh` and the launchd `socat` agent on port 17385 on the Mac first: the runtime and the SSH agent arrive over the Mac's loopback. `.env.macos` describes both |
| Linux, Podman | `cp .devcontainer/.env.podman .devcontainer/.env`, and set `DEVCONTAINER_SSH_AUTH_SOCK=/run/user/1000/ssh-agent` (or the agent's path) |
| NixOS, Podman | As Linux Podman. `DEVCONTAINER_USERNS` keeps the image's `keep-id:uid=1000,gid=1000`, which maps the host account onto the image's whatever its group is |
| Ubuntu, Docker | No `.env` at all, or one setting only `DEVCONTAINER_SSH_AUTH_SOCK=…` and `DEVCONTAINER_RUNTIME_SOCKET=…`; the defaults bind `/var/run/docker.sock` |

The container user is `dev`. The image carries both the `docker` and the
`podman` client, and its `podman` is a remote client, which cannot drive a
Docker daemon. So `tcab` and `deployments/local/Makefile` pick `podman` only
when `podman version` answers, and `docker` otherwise; `TCAB_CONTAINER_RUNTIME`
and `CONTAINER_TOOL=…` override the choice.

### What the image carries

The image is built from the superrepo root and bakes in everything a build of
any repository needs: the pinned Rust and Node toolchains, the browser engines,
the cluster tooling, the Android SDK and Tauri's build tools, the apt packages
the project's tools need (`ruby`, `libicu-dev`, `ffmpeg`, `cmake`, `iproute2`,
`lsof`, `procps`), `wrangler`, and gg's eleven program-language toolchains
with the build toolchains of its C# guest (see
[gg and its eleven toolchains](/development/building/#gg-and-its-eleven-toolchains)).
The gg toolchains are the image's last layer. Most are the template's language
images, which `.devcontainer/languages/gg/install.sh` links at the homes gg
looks in, and the rest are installed there by the same two installers gg's
pipeline and the run images use, against the `gg` checkout, so a pin moving
under gg's `packages/` rebuilds that layer alone.

When the container is created, `.devcontainer/post-create.sh` installs the git
hooks, initializes `contracts`, `engines`, `gg`, `microservice-repos`,
`tool-model-core`, `tool-paint`, `tool-particle`, `tool-sprite` and
`test-suites`, runs `npm ci`
(and gg's own in the `gg` checkout) and links the
checked-out repositories' packages, and nothing runs in the background
afterwards. In a container built before a gg pin moved, the two installers
reconcile it by hand without a rebuild, from the `gg` checkout:

```sh
scripts/ci/install-gg-toolchains.sh
scripts/ci/install-gg-build-toolchains.sh
```

### Where cargo builds

cargo builds into `target/` in each repository's checkout, where that
repository's `make clean` reaches it, so a locally built gg is at
`gg/target/debug/gg`. A `CARGO_TARGET_DIR` set in the environment moves it,
and the scripts that look for a built binary honour the variable.

## The whole stack on k3d

`deployments/local/Makefile` drives the whole stack. It is meant to run inside
the dev container, which ships the `docker` and `podman` clients, `k3d` and
`kubectl` and reaches the host's runtime; it also works on a bare host with a
runtime, `k3d` and `kubectl` installed. The cluster is named `tcab`, so one
machine runs one local stack. For a
task-oriented walkthrough see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
or its [quickstart](/quickstarts/development/run-the-local-service-stack/).

Export the harness provider API key the run needs before bringing the stack up.
The Makefile reads it from your environment, or from the gitignored
superrepo-root `.env`, and creates the cluster Secret from it, so no key is
written to a tracked file:

```sh
export ANTHROPIC_API_KEY=…   # for the `claude` harness (or OPENAI_API_KEY for
                             # codex, OPENROUTER_API_KEY for cline/goose/kilo/…)
```

```sh
make -C deployments/local local-up        # cluster, images, overlay, ingest
make -C deployments/local local-forward   # hold the data plane open on localhost
# … develop …
make -C deployments/local local-rebuild   # rebuild the service images + restart
make -C deployments/local local-status    # pods, services, and volumes
make -C deployments/local local-ingest    # refresh the whole catalog
make -C deployments/local secrets         # re-create the Secrets after a rotation
make -C deployments/local local-down      # delete the cluster and everything in it
```

`local-up` creates a throwaway k3d cluster, builds the backend, dispatcher,
driver, artifacts, repos, publisher and arena images from each
`microservice-*` checkout's Dockerfile, with the sibling checkouts as their
build context's sources, builds the run-container images from
`microservice-driver`'s `containers/`, loads both sets with
`k3d image import`, creates the cluster Secrets from your environment, applies
the `deployments/k8s/overlays/local` kustomize overlay, and force-ingests the
catalog from a read-only mount of the `test-suites` checkout.

The local overlay runs an [Azurite](https://github.com/Azure/Azurite) blob
emulator in the cluster as the object store of the artifacts and repos
services: the private run-tree and bundle containers, and the public bucket the
snapshot is written to, are containers of it, so nothing local reaches Azure or
Cloudflare. The overlay sets no Access audience, so the services verify no
assertion and record the identity the local console and `tcab` send in
`Cf-Access-Authenticated-User-Email`, `dev@local` by default.

After editing a test case or suite, run `tcab ingest --changed` against the
forwarded backend. `local-ingest` force-ingests the whole catalog. See
[Starting the backend](#starting-the-backend) for the `tcab ingest` forms.

`local-rebuild` rebuilds the long-lived service images only. Tooling baked into
a run image, such as `voxel-anim`, `draw`, the core modeling library, or the
Foray/Lattice tooling, is rebuilt separately with
`make -C deployments/local run-images`, or with one of the narrower targets:
`run-images-e2e`, `run-images-full-stack`, `run-images-game-jam`,
`run-images-asset`, `run-images-adversarial`, `run-images-performance`,
`run-images-gg`, or `run-image-<name>` for a single image. A run image copies
its tool binaries from the `tool-*` images, which `run-images` builds from the
checked-out `tool-*` repositories first.

### Waiting for a rollout

`local-up` and `local-rebuild` wait for each workload to finish rolling out,
allowing each one `ROLLOUT_TIMEOUT`, which defaults to 600s. Both wait on every
workload before reporting, so a failure names all of the workloads that timed
out rather than only the first.

A timeout reported alongside pods still in `Terminating` means the node's
container runtime has yet to reap the outgoing pods, which holds their
replacements back. The wait prints those pods and the runtime's `FailedKillPod`
events, identifying the stall as a property of the node rather than of the
images just built. Retry once the node settles, or allow more time:

```sh
make -C deployments/local local-rebuild ROLLOUT_TIMEOUT=1800s
```

### Reaching the stack from the host

`make local-forward` holds the backend on `127.0.0.1:8787`, the artifacts
service on `127.0.0.1:8790`, the arena service on `127.0.0.1:8791`, the repos
service on `127.0.0.1:8792`, and Grafana on `127.0.0.1:3000`. The forwards are
required because the browser runs outside the cluster: the console's dev
server proxies `/api`, `/artifacts` and `/arena` to them.

Start the console from source in a separate terminal and open
<http://127.0.0.1:1430>:

```sh
npm run dev   # in console.testcabinet.ai/
```

Its proxy targets are the forwarded addresses, set in the committed
`vite.config.ts`, so there is nothing to configure; `TCAB_PROXY_BACKEND` and
its siblings in a gitignored `.env.development.local` aim it elsewhere.

`tcab ingest` targets the same forwarded backend: point `tcab` at it with
`TCAB_BACKEND_URL=http://127.0.0.1:8787`.

### Clearing stale forwards

`local-forward` backgrounds one `kubectl port-forward` per service, so a Ctrl-C
that reaches only the foreground process can leave children holding the ports. A
later `local-forward` then fails to bind, or leaves one service reachable and
another not. Clear them with:

```sh
scripts/free-local-forward.sh              # stop local forwarding
scripts/free-local-forward.sh --dry-run    # show what would be stopped
```

It touches only forwards into the local namespace that target this project's
own services, so a forward held open against staging or production survives. It
reports each forwarded port as free or still held and exits non-zero if any is
still held. A port held by something other than one of our forwards is reported
and left alone; in a devcontainer that is usually the editor auto-forwarding the
port, which you stop in its PORTS panel.

## Pointing `tcab` at a deployment

`tcab` is a thin client, so a remote staging or production deployment differs
only in the URL you point it at and the credential it presents. There are two
routes to a remote backend.

Through the edge is the production path. A deployment is reachable at one
origin per environment, `console.testcabinet.ai` for prod and
`console.staging.testcabinet.ai` for staging, with the backend under `/api/`;
see [The edge](/deployment/kubernetes/edge/). Every request through it carries
an Access assertion. `tcab` earns one with a person's token from
`cloudflared access login`, read from `TCAB_ACCESS_TOKEN`, or with an Access
service token for automation, whose id and secret it reads from
`TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET` and sends as the
`CF-Access-Client-Id` and `CF-Access-Client-Secret` headers; see
[Sign In](/quickstarts/setup/sign-in/):

```sh
export TCAB_BACKEND_URL=https://console.testcabinet.ai/api
export TCAB_ACCESS_CLIENT_ID=…
export TCAB_ACCESS_CLIENT_SECRET=…
tcab ingest --env prod --changed
```

`kubectl port-forward` is the fallback for debugging, or for before the tunnel
is up. Forward the backend's `ClusterIP` service and point `tcab` at the
forwarded port; a request that never crosses the edge carries no assertion, so
`tcab` presents the backend's shared service token instead, as an in-cluster
caller does:

```sh
kubectl -n tcab-prod port-forward svc/tcab-backend 8787:8787 &
export TCAB_BACKEND_URL=http://127.0.0.1:8787
export TCAB_BACKEND_SERVICE_TOKEN=…
tcab ingest --env prod --changed
```

## Iterating on the backend as a bare process

The backend runs as an ordinary host process, which is the quickest way to
iterate on that binary. Run execution still requires the dispatcher and driver,
so launching a run needs a backend whose queue an in-cluster dispatcher is
draining. The path below stands up the backend and the console for read and
review work.

### Service configuration

Copy the example env file at the `microservice-backend` root and fill it in.
Each microservice's `.env.<service>.example` at its root is the authoritative
list of every variable that service reads.

```sh
cp .env.backend.example .env.backend   # in microservice-backend/
```

The only required value in `.env.backend` is the checkout the backend ingests
definitions from:

```sh
TCAB_BACKEND_CHECKOUT=/absolute/path/to/the-test-cabinet/test-suites
# TCAB_BACKEND_BIND defaults to 127.0.0.1:8787.
# TCAB_BACKEND_DATABASE_URL unset uses the default local SQLite file.
# TCAB_DEFINITIONS_ROOT and TCAB_SUITES_ROOT default to the checkout's root and
# its test-suites/ tree; TCAB_COLD_STORAGE_ROOT to the cold-storage/ checkout
# beside it.
TCAB_GG_REFERENCE=/absolute/path/to/the-test-cabinet/gg/target/gg-reference
# TCAB_ARTIFACTS_URL names the artifacts service the snapshot is written through;
# with it blank, the backend still records to its database.
```

To serve the console's gg Reference section, project gg's reference documents
once, in the `gg` checkout:

```sh
scripts/gg-reference.sh
```

That writes `gg/target/gg-reference/`, the directory `TCAB_GG_REFERENCE` names
in `.env.backend`. Skipping it
costs only that section: `GET /gg/reference` answers `503` with a message
naming this script, the backend logs one warning at boot, and runs, reviews,
and the catalog are unaffected. The script builds gg, so it needs gg's
program-language toolchains, which the devcontainer has (see
[Building](/development/building/#gg-and-its-eleven-toolchains)).

The dispatcher, the artifacts, repos and publisher services read their own
env, listed in the example file at each repository's root. Each assumes the
cluster context the k3d overlay wires up, covering the dispatcher's Kubernetes
API access, the driver ServiceAccount and the object store, so the k3d stack is
the supported way to run them.

### Starting the backend

Run the binary from a directory containing `.env.backend`, then ingest the
`test-suites` checkout so the catalog is populated. The ingest route takes the
backend's service token:

```sh
./target/debug/tcab-backend
curl -X POST http://127.0.0.1:8787/ingest \
  -H "authorization: Bearer $TCAB_BACKEND_SERVICE_TOKEN"
```

Confirm it is serving with `curl http://127.0.0.1:8787/healthz` and
`curl http://127.0.0.1:8787/test-cases`.

The baseline validation media a reviewer compares a run's media against comes
from the `cold-storage` submodule. Fetch it before ingesting to review runs with
their baselines:

```sh
git submodule update --init --depth 1 cold-storage
```

Without it every version ingests with no baseline media, and a review shows only
the build's half of each side-by-side. `TCAB_COLD_STORAGE_ROOT` in `.env.backend`
points the backend at a copy kept elsewhere; when it is unset the backend reads
`TCAB_COLD_STORAGE_DIR`, the override the capture commands also read. The same
applies to the k3d stack, which ingests the checkout it mounts.

Re-ingest after editing a test case, so the backend serves the change. A plain
scan skips any version it already holds, because the store is immutable per
`(slug, version)`.

`tcab ingest --changed` brings the backend in line with the checkout from the
command line. It reads `TCAB_BACKEND_URL` and the service token, ingests
exactly the versions whose content differs from what the store holds, and
prints the endpoint's streamed per-version progress, naming the reason for
each skip. It closes with the ingested and skipped counts:

```sh
tcab ingest --changed             # every version whose content changed
tcab ingest carom --changed       # one case or suite, when it changed
tcab ingest carom --force         # one case or suite, overwriting what is stored
tcab ingest carom@v1.2.0 --force  # exactly one version
```

It wraps the endpoint's streamed (`Accept: application/x-ndjson`) progress
feed; the raw call is:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H "authorization: Bearer $TCAB_BACKEND_SERVICE_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"testCases": ["carom"], "mode": "changed"}'
```

Backend-driven runs resolve their definition from the backend, so until a
re-ingest they keep running the previous definition: a new spec, proof, or prompt
change does not reach the model, and new manifest fields read back empty.
`tcab validate` against a local checkout reads the repository directly and is
unaffected.

Forced re-ingest overwrites the stored version in place and is a
development-only convenience for iterating on a version no run has been published
against. Once a published run references a version, revise the case by creating a
new version (see [Frozen Versions](/development/frozen-versions/)).

### Starting the console

```sh
npm run dev   # in console.testcabinet.ai/
```

The dev server proxies `/api` to `http://127.0.0.1:8787` and `/artifacts` and
`/arena` to the forwarded services, set in the committed `vite.config.ts`. To
aim it elsewhere, override `TCAB_PROXY_BACKEND`, `TCAB_PROXY_ARTIFACTS` or
`TCAB_PROXY_ARENA` in a gitignored `.env.development.local`, which Vite loads
after the committed configuration. The console enqueues a run by posting it to
the backend's queue; the in-cluster dispatcher claims it, the driver Job
executes it, and the console watches its
[event stream](/components/driver/events/) live and reads the produced build
and media under `/artifacts`, from the
[artifacts service](/components/artifacts/overview/).

## Telemetry

The Grafana LGTM stack runs in the cluster as the local overlay's
`components/observability`, so `local-up` wires every in-cluster service to it
and `local-forward` exposes Grafana at <http://127.0.0.1:3000>.
`make -C deployments/local local-grafana` additionally forwards the OTLP
collector ports, which a process run outside the cluster exports to. Leaving
`OTEL_EXPORTER_OTLP_ENDPOINT` unset keeps everything on stdout logging. See
[Observability](/development/observability/), in particular its endpoint-duality
rule for processes inside and outside the cluster.

## Next steps

The same service images deploy unchanged to
[staging and production on Kubernetes](/deployment/kubernetes/overview/). A run is a
per-run `Job` everywhere: the dispatcher claims a queued run and creates a Job
running the driver, which under the Kubernetes runtime creates one ephemeral
sandbox pod per run. See [Deployment](/deployment/overview/) for the remote
build.
