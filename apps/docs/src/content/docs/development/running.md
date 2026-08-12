---
title: Running
---

Every launcher enqueues a run at the backend and watches it: the
[CLI](/components/cli/overview/) (`tcab`), the
[Tauri desktop app](/components/tauri/overview/), and the
[web console](/components/web/overview/). None of them executes a test case on
its own machine. Running The Test Cabinet locally therefore means standing up the
service stack that drains that queue.

Execution is a cluster concern. A launcher enqueues a run at the
[backend](/components/backend/overview/); an in-cluster
[dispatcher](/components/dispatcher/overview/) claims it and creates a per-run
Kubernetes `Job` running the [driver](/components/driver/overview/), which
executes that one run. The local stack runs on a k3d cluster (k3s-in-Docker)
from the same manifests a [deployment](/deployment/overview/) applies, so what
runs locally and what runs in staging or production differ only in the namespace
they live in.

`tcab run` and the desktop app are thin enqueue-and-watch clients. They need a
reachable backend (`TCAB_BACKEND_URL`) and an account, and no container runtime
of their own. Left with `TCAB_BACKEND_URL` unset, the shipped desktop app stands
up its own bundled k3d cluster from the published images (see
[Self-contained cluster](/components/tauri/overview/#self-contained-cluster)),
which ingests the bundled catalog; during development, point it at a backend you
can re-ingest at will.

## Prerequisites

- A container runtime (Docker), needed by k3d, which runs the cluster as
  containers. In the devcontainer this is the host's daemon, reached over a bound
  socket; on a bare host it is the local daemon.
- [`k3d`](https://k3d.io) and `kubectl`. Both ship in the devcontainer; install
  them yourself on a bare host.
- The run-container images (`containers/README.md`) built or pullable for the
  test types you intend to run; a harness installs into them at run time.
- A harness API key for the harness you will run, for example
  `ANTHROPIC_API_KEY` for `claude`.
- For the bare-process path below, the service binaries built per
  [Building](/development/building/): `cargo build -p test-cabinet-backend` and
  `cargo build -p test-cabinet-auth-service`.

The web console is a Vite app under `apps/web` and does not run in the local k3d
cluster. You run its dev server from source against the forwarded backend, so a
UI edit hot-reloads instead of forcing an image rebuild. Only staging and
production serve it in-cluster as the `tcab-web` image.

## The whole stack on k3d

`deployments/local/Makefile` drives the whole stack. It is meant to run inside
the devcontainer, which ships `docker`, `k3d`, and `kubectl` and binds the host
daemon socket in; it also works on a bare host with those three installed. For a
task-oriented walkthrough see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
or its [quickstart](/quickstarts/development/run-the-local-service-stack/).

Export the harness provider API key the run needs before bringing the stack up.
The Makefile reads it from your environment, or from the gitignored repo-root
`.env`, and creates the cluster Secret from it, so no key is written to a tracked
file:

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
make -C deployments/local local-ingest    # re-ingest after editing a case
make -C deployments/local secrets         # re-create the Secrets after a rotation
make -C deployments/local local-down      # delete the cluster and everything in it
```

`local-up` creates a throwaway k3d cluster, builds the backend, auth,
dispatcher, driver, artifact, and arena images from `deployments/images/`, builds
the run-container images from `containers/`, loads both sets with
`k3d image import`, creates the cluster Secrets from your environment, applies
the `deployments/k8s/overlays/local` kustomize overlay, and force-ingests the
catalog from a read-only mount of this repository.

`local-rebuild` rebuilds the long-lived service images only. Tooling baked into
a run image, such as `voxel-anim`, `draw`, the core modeling library, or the
Foray/Lattice tooling, is rebuilt separately with
`make -C deployments/local run-images`, or with one of the narrower targets:
`run-images-e2e`, `run-images-full-stack`, `run-images-game-jam`,
`run-images-asset`, `run-images-adversarial`, `run-images-performance`,
`run-images-gg`, or `run-image-<name>` for a single image.

### Reaching the stack from the host

`make local-forward` holds the backend on `127.0.0.1:8787`, the auth service on
`127.0.0.1:8789`, the artifact service on `127.0.0.1:8790`, the arena service on
`127.0.0.1:8791`, and Grafana on `127.0.0.1:3000`. The forwards are required
because the browser runs outside the cluster: it loads the console and reaches
the backend, the artifact service (each run's build and proof/asset media, as
`<img>`/`<iframe>` requests), and the arena (adversarial matches and tournaments,
whose URL the backend reports at `GET /config`) over them.

Start the console from source in a separate terminal and open
<http://127.0.0.1:1430>:

```sh
npm run -w apps/web dev
```

Its backend and auth URLs are pre-set to the forwarded addresses by the committed
`apps/web/.env.development`, so there is nothing to configure. The backend and
auth CORS layers accept the dev server's cross-origin requests.

`tcab run` and the desktop app target the same forwarded backend. Point `tcab` at
it with `TCAB_BACKEND_URL=http://127.0.0.1:8787` after `tcab login`; the desktop
app takes the same URL in its Connections settings.

### Clearing stale forwards

`local-forward` backgrounds one `kubectl port-forward` per service, so a Ctrl-C
that reaches only the foreground process can leave children holding the ports. A
later `local-forward` then fails to bind, or leaves one service reachable and
another not. Clear them with:

```sh
scripts/free-local-forward.sh              # stop local forwarding
scripts/free-local-forward.sh --dry-run    # show what would be stopped
```

It touches only forwards into the local namespace that target this repository's
own services, so a forward held open against staging or production survives. It
reports each forwarded port as free or still held and exits non-zero if any is
still held. A port held by something other than one of our forwards is reported
and left alone; in a devcontainer that is usually the editor auto-forwarding the
port, which you stop in its PORTS panel.

## Pointing `tcab` at a deployment

`tcab` is a thin enqueue-and-watch client, so a remote staging or production
deployment differs only in the URL you point it at and the account you log in
with. There are two routes to a remote backend.

Over the VPN, at the private hostnames, is the production path. A deployment with
the [internal ingress](/deployment/kubernetes/internal-ingress/) serves the
backend and auth service at private `*.testcabinet.ai` hostnames that resolve
only on the VPN, via the cloud's private DNS:

```sh
export TCAB_BACKEND_URL=https://api.tcab.testcabinet.ai
export TCAB_AUTH_URL=https://auth.tcab.testcabinet.ai
tcab login --username <name>
tcab run --test-case carom --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

The backend reports the artifact and arena URLs at `GET /config`, so media and
arena views resolve over the same VPN.

`kubectl port-forward` is the fallback for off-VPN debugging, or for before the
ingress is up. Forward the backend and auth `ClusterIP` services and point `tcab`
at the forwarded ports:

```sh
kubectl -n tcab-prod port-forward svc/tcab-backend 8787:8787 &
kubectl -n tcab-prod port-forward svc/tcab-auth    8789:8789 &
export TCAB_BACKEND_URL=http://127.0.0.1:8787
export TCAB_AUTH_URL=http://127.0.0.1:8789
tcab login --username <name>
tcab run --test-case carom --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

Artifact and arena media still resolve to whatever the backend advertises at
`GET /config`, so where those `TCAB_*_PUBLIC_URL`s name the private ingress
hostnames, media needs the VPN or matching forwards as well.

## Iterating on the backend and auth services as bare processes

The backend and auth service run as ordinary host processes, which is the
quickest way to iterate on those two binaries. Run execution still requires the
dispatcher and driver, so launching a run needs a backend whose queue an
in-cluster dispatcher is draining. The path below stands up the two stateful
services and the console for read and review work.

### Service configuration

Copy the repo-root example env files and fill them in. They are the authoritative
list of every variable each service reads.

```sh
cp .env.backend.example .env.backend
```

The only required value in `.env.backend` is the checkout the backend ingests
definitions from:

```sh
TCAB_BACKEND_CHECKOUT=/absolute/path/to/the-test-cabinet
# TCAB_BACKEND_BIND defaults to 127.0.0.1:8787.
# TCAB_BACKEND_DATABASE_URL unset uses the default local SQLite file.
# TCAB_BACKEND_AUTH_URL defaults to http://127.0.0.1:8789, the local auth service.
# With the R2 and deploy-hook variables blank, the backend still records to its
# database and regenerates the snapshot on disk.
```

To serve the console's gg Reference section, project gg's reference documents
once:

```sh
scripts/gg-reference.sh
```

That writes `target/gg-reference/`, which is where an unset `TCAB_GG_REFERENCE`
resolves relative to `TCAB_BACKEND_CHECKOUT`. Skipping it costs only that
section: `GET /gg/reference` answers `503` with a message naming this script, the
backend logs one warning at boot, and runs, reviews, and the catalog are
unaffected. The script builds gg, so it needs gg's program-language toolchains,
which the devcontainer has (see
[Building](/development/building/#gg-and-its-eleven-toolchains)).

The dispatcher and artifact service read their own env, listed in
`.env.dispatcher.example` and `.env.artifacts.example`. Both assume the cluster
context the k3d overlay wires up, covering the dispatcher's Kubernetes API
access, the driver ServiceAccount, and the artifact volume, so the k3d stack is
the supported way to run them.

### Starting the backend

Run the binary from a directory containing `.env.backend`, then ingest the
repository so the catalog is populated:

```sh
./target/debug/tcab-backend
curl -X POST http://127.0.0.1:8787/ingest
```

Confirm it is serving with `curl http://127.0.0.1:8787/healthz` and
`curl http://127.0.0.1:8787/test-cases`.

Re-ingest after editing a test case, so the backend serves the change. A plain
scan skips any version it already holds, because the store is immutable per
`(slug, version)`, so the re-ingest forces the overwrite. `scripts/reingest.sh`
forces it and streams the endpoint's per-case progress. By default it re-ingests
only the versions whose files changed since its last successful run, recorded in
a gitignored `.reingest-timestamp` marker:

```sh
scripts/reingest.sh             # only versions changed since the last run
scripts/reingest.sh carom       # scope to one case (still skipped if unchanged)
scripts/reingest.sh --force     # re-ingest every case, ignoring change detection
```

The first run, or one after `rm .reingest-timestamp`, has no baseline and
re-ingests everything. The script wraps the endpoint's streamed
(`Accept: application/x-ndjson`) progress feed; the raw call is:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["carom"], "force": true}'
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

### Starting the auth service

The auth service holds its own bind address and database, separate from the
backend's, and both have defaults:

```sh
./target/debug/tcab-auth-service
```

```sh
TCAB_AUTH_BIND=127.0.0.1:8789 \
TCAB_AUTH_DATABASE_URL=sqlite://./tcab-auth.sqlite?mode=rwc \
  ./target/debug/tcab-auth-service
```

Confirm it with `curl http://127.0.0.1:8789/healthz`, then create an account and
log in:

```sh
tcab register --username dev --display-name "Dev"
```

The backend, pointed at it by `TCAB_BACKEND_AUTH_URL`, verifies the token the CLI
stored, so mutations are accepted. With the auth service down, reads still work
and review and publish are rejected `401`.

### Starting the web console

```sh
npm run -w apps/web dev
```

The console defaults its backend to `http://127.0.0.1:8787` and its auth service
to `http://127.0.0.1:8789`, pre-set in the committed `apps/web/.env.development`.
To aim it elsewhere, set the backend in the UI or override `VITE_BACKEND_URL` in
a gitignored `.env.development.local`, which Vite loads after the committed
`.env.development`. It enqueues a run by posting it to the backend's
queue; the in-cluster dispatcher claims it, the driver Job executes it, and the
console watches its [event stream](/components/core/events/) live and reads the
produced build and media from the
[artifact service](/components/artifacts/overview/).

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
