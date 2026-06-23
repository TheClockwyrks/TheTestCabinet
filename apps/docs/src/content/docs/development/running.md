---
title: Running
---

This page covers running The Test Cabinet **locally** — on your own machine, for
development or to exercise the whole flow end to end. Two shapes of "running" are
worth separating, because they need very different amounts of setup:

- **A single run**, driven by the [CLI](/components/cli/overview/) (`tcab`) or the
  [Tauri desktop app](/components/tauri/overview/). Both embed the
  [core](/components/core/overview/) runner directly, so they need **no backend or
  cluster** — just a container runtime and a harness API key. This is the fastest
  way to launch one run; the [quickstarts](/quickstarts/overview/) walk through it
  and [Building](/development/building/) covers producing the binaries.
- **The full service-driven flow** — the [backend](/components/backend/overview/)
  (which now owns the **run queue**), the [auth service](/components/auth/overview/),
  the [dispatcher](/components/dispatcher/overview/), the
  [artifact service](/components/artifacts/overview/), and the
  [web console](/components/web/overview/), running exactly as a deployed
  environment runs them. A console no longer talks to a worker: it **enqueues** a
  run at the backend, and an in-cluster dispatcher claims it and creates a per-run
  Kubernetes **Job** running the [driver](/components/driver/overview/), which
  executes that one run. Because execution is now a cluster concern, the local
  service-driven story runs on a **k3d** cluster (k3s-in-Docker) from the same
  manifests a deployment uses. (The auth service is what lets you register, log
  in, and push/review/publish; without it the read-only flow still works, but
  mutations are rejected `401`.)

Running the services on one machine is the local mirror of a real
[deployment](/deployment/overview/): the same images and the same configuration,
only on a throwaway local cluster. When you are ready to put them on real hosts —
staging and prod — see [Deployment](/deployment/overview/).

## Prerequisites

- A **container runtime** (Docker) on the host. k3d runs the cluster as
  containers, and a single CLI/desktop run needs a runtime to execute the run
  container. See [Execution](/components/core/execution/) and
  [first-time setup](/guides/first-time-setup/).
- [`k3d`](https://k3d.io) and `kubectl` on the host, for the service-driven flow.
- The harness [container images](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)
  built or pullable for whichever harness you intend to run.
- The service binaries, built per [Building](/development/building/):
  `cargo build -p test-cabinet-backend`, `cargo build -p tcab-auth-service`,
  `cargo build -p test-cabinet-dispatcher`, `cargo build -p test-cabinet-driver`,
  and `cargo build -p test-cabinet-artifacts` (or the `build-portable-*` aliases
  for static binaries). The web console is a Vite app under `apps/web`.
- A harness API key for the harness you will run (for example
  `ANTHROPIC_API_KEY` for `claude`).

## The whole stack on k3d (deployment parity)

For a task-oriented walkthrough of this — bringing the stack up, connecting the
console, and enqueuing a run — see the guide
[Running the Local Service Stack](/guides/running-the-local-service-stack/) (or the
[quickstart](/quickstarts/run-the-local-service-stack/) for just the steps). This
section is the reference the guide sits on top of.

Run execution is now a cluster concern: a run schedules as a per-run **Job**, so
the service-driven flow runs the services **the way a
[deployment](/deployment/kubernetes/) runs them** — in a real (local) Kubernetes
cluster, from the same manifests. The
[`deployments/local/Makefile`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/local/Makefile)
drives the whole thing; it needs only `docker`, [`k3d`](https://k3d.io), and
`kubectl` on the host:

Before bringing the stack up, **export the harness provider API key** the run
needs — the Makefile reads it from your environment and creates the cluster
Secret from it, so no key is ever written to a tracked file:

```sh
export ANTHROPIC_API_KEY=…   # for the `claude` harness (or OPENAI_API_KEY for
                             # codex, OPENROUTER_API_KEY for cline/goose/kilo/…)
```

```sh
make -C deployments/local local-up        # create cluster, build+load images, apply secrets+overlay, ingest
make -C deployments/local local-forward   # hold backend→:8787 and auth→:8789 open on localhost
# … develop …
make -C deployments/local local-rebuild   # after a code change: rebuild images + restart
make -C deployments/local local-status    # show the namespace's pods, Jobs, and services
make -C deployments/local local-ingest    # force re-ingest the catalog after editing a case
make -C deployments/local secrets         # re-create the Secrets from the environment (after rotating a key)
make -C deployments/local local-down      # delete the cluster and everything in it
```

`local-up` creates a throwaway k3d cluster, builds the **backend**, **auth**,
**dispatcher**, **driver**, and **artifact** images from
[`deployments/images/`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/images),
loads them with `k3d image import` (no registry needed), creates the cluster
Secrets from your environment (the harness key above plus a dev service token),
applies the `deployments/k8s/overlays/local` kustomize overlay, and force-ingests
the catalog from a read-only mount of this repository. The dispatcher and driver run
in-cluster under their own ServiceAccounts, so a run you enqueue at the backend
**schedules as a Job in this same cluster** — exactly as a cloud deployment runs
it. The host no longer runs any worker process.

`make local-forward` holds the backend open on `127.0.0.1:8787` and the auth
service on `127.0.0.1:8789`, which is all the web console needs: it enqueues runs
against the one backend URL, and the in-cluster dispatcher and driver execute
them. After editing a test case, re-ingest with
`make -C deployments/local local-ingest`.

## Iterating on the backend and auth services as bare processes

You can run the **backend and auth** services as ordinary host processes — the
quickest way to iterate on those two binaries — but note that **run execution
still requires the dispatcher and driver**, i.e. a cluster (the k3d stack above
or a remote one). The bare-process path below stands up the two stateful services
and the console for read/review work; to actually launch a run, point the console
at a backend whose queue an in-cluster dispatcher is draining.

### Configure the services

Copy the repo-root example env files and fill them in. These remain the
authoritative list of every variable each service reads.

```sh
cp .env.backend.example .env.backend
```

In `.env.backend`, the only required value is the checkout the backend ingests
definitions from — point it at this repository:

```sh
TCAB_BACKEND_CHECKOUT=/absolute/path/to/the-test-cabinet
# Leave TCAB_BACKEND_BIND at its default 127.0.0.1:8787 for local use.
# Leave TCAB_BACKEND_DATABASE_URL unset to use the default local SQLite file.
# Leave TCAB_BACKEND_AUTH_URL at its default http://127.0.0.1:8789 so the backend
# verifies bearer tokens against the local auth service.
# R2 + deploy-hook variables can stay blank: with them unset the backend still
# records to its database and regenerates the snapshot on disk (a dev-only mode).
```

The dispatcher and artifact service take their own env — see
[`.env.dispatcher.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.dispatcher.example)
and
[`.env.artifacts.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.artifacts.example)
for the full lists — but they assume the cluster context the k3d overlay wires up
(the dispatcher's Kubernetes API access, the driver ServiceAccount, the artifact
volume), so the k3d stack is the supported way to run them.

### Start the backend

Run the binary directly from a directory containing `.env.backend`:

```sh
./target/debug/tcab-backend
```

Once it is up, ingest the repository so the catalog is populated:

```sh
curl -X POST http://127.0.0.1:8787/ingest
```

Confirm it is serving with `curl http://127.0.0.1:8787/healthz` and
`curl http://127.0.0.1:8787/test-cases`.

After you **edit a test case**, re-ingest so the backend serves the change.
A plain scan skips any version it already holds (the store is immutable per
`(slug, version)`), so force the overwrite — optionally scoping it to the case
you touched:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["pong"], "force": true}'
```

Backend-driven runs (the desktop and web consoles) resolve their definition from
the backend, so **without a re-ingest they keep running the previous
definition** — a newly added spec, proof, or prompt change silently does not
reach the model, and new manifest fields read back empty. (`tcab validate`
against a local checkout reads the repository directly and is not affected.)

Forced re-ingest overwrites the stored version in place and is a
**development-only** convenience for iterating on a version no run has been
published against. Once a published run references a version it is immutable —
revise by creating a **new version** instead, never by editing and re-ingesting
the published one (see [Test Cases](/testing/end-to-end/overview/)).

### Start the auth service

So you can register, log in, and push/review/publish, start the auth service. It
takes its own bind address and its own database, separate from the backend's:

```sh
TCAB_AUTH_BIND=127.0.0.1:8789 \
TCAB_AUTH_DATABASE_URL=sqlite://./tcab-auth.db?mode=rwc \
  ./target/debug/tcab-auth-service
```

Both default to the values shown, so a bare `./target/debug/tcab-auth-service`
works too. Confirm it with `curl http://127.0.0.1:8789/healthz`, then create an
account and log in:

```sh
tcab register --username dev --display-name "Dev"
```

The backend (pointed at it by `TCAB_BACKEND_AUTH_URL`) now verifies the token the
CLI stored, so mutations are accepted. Without the auth service running, reads
still work but push/review/publish are rejected `401`.

### Start the web console

Run the console's dev server and open it in a browser:

```sh
npm run dev -w @test-cabinet/web
```

In the UI, set the backend to `http://127.0.0.1:8787` — the **one** URL the
console needs. The console enqueues a run by posting it to the backend's queue;
the in-cluster dispatcher claims it, the driver Job executes it, and the console
watches its [event stream](/components/core/events/) live and reads the produced
build and media from the [artifact service](/components/artifacts/overview/) (the
backend reports its public URL to the console via `GET /config`). There is no
worker to register.

## Telemetry (optional)

To watch traces across `tcab-backend` → `tcab-dispatcher` → `tcab-driver`
locally, enable the bundled Grafana LGTM stack and point each process at it. That
is fully described under [Observability](/development/observability/) — in
particular the
[endpoint-duality rule](/development/observability/#endpoint-duality-host-vs-container):
in-cluster pods use the collector's in-cluster endpoint, while a host process
uses `http://localhost:4318`. Leaving `OTEL_EXPORTER_OTLP_ENDPOINT` unset keeps
everything on plain stdout logging.

## Next

When this works end to end, the same service images deploy unchanged to
[staging and prod on Kubernetes](/deployment/kubernetes/) — what changes is the
namespace they live in, not how the flow is wired. A run is a per-run **Job**
everywhere: the dispatcher claims a queued run and creates a Job running the
driver, which (under the Kubernetes runtime) creates one ephemeral sandbox pod
per run. See [Deployment](/deployment/overview/) for the remote build.
