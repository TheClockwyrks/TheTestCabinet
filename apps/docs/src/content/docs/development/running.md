---
title: Running
---

This page covers running The Test Cabinet **locally** — on your own machine, for
development or to exercise the whole flow end to end. Two shapes of "running" are
worth separating, because they need very different amounts of setup:

- **A single run**, driven by the [CLI](/components/cli/overview/) (`tcab`) or the
  [Tauri desktop app](/components/tauri/overview/). Both embed the
  [core](/components/core/overview/) runner directly, so they need **no backend or
  worker process** — just a container runtime and a harness API key. This is the
  fastest way to launch one run; the [quickstarts](/quickstarts/overview/) walk
  through it and [Building](/development/building/) covers producing the binaries.
- **The full service-driven flow** — the [backend](/components/backend/overview/),
  the [auth service](/components/auth/overview/), a
  [worker](/components/worker/overview/), and the
  [web console](/components/web/overview/) running as their own processes, exactly
  as a deployed environment runs them, just all on `localhost`. This is the
  environment to reach for when developing or debugging the services themselves,
  and it is what the rest of this page sets up. (The auth service is what lets you
  register, log in, and push/review/publish; without it the read-only flow still
  works, but mutations are rejected `401`.)

Running the services on one machine is the local mirror of a real
[deployment](/deployment/overview/): the same binaries and the same configuration,
only bound to `localhost`. When you are ready to put them on real hosts — staging
and prod — see [Deployment](/deployment/overview/).

## Prerequisites

- A **container runtime** (Docker or Podman) on the host — the worker needs it to
  execute runs. See [Execution](/components/core/execution/) and
  [first-time setup](/guides/first-time-setup/).
- The harness [container images](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md)
  built or pullable for whichever harness you intend to run.
- The service binaries, built per [Building](/development/building/):
  `cargo build -p test-cabinet-backend`, `cargo build -p test-cabinet-worker`, and
  `cargo build -p tcab-auth-service` (or the `build-portable-*` aliases for static
  binaries). The web console is a Vite app under `apps/web`.
- A harness API key for the harness you will run (for example
  `ANTHROPIC_API_KEY` for `claude`).

## Why the worker runs on the host

A natural instinct is to put everything in one `docker compose` stack. The
backend is happy in a container, but the worker starts a **container per run**,
so containerizing it means giving it access to the host's container runtime
(bind-mounting the Docker socket) and ensuring the run's
[work directory](/components/worker/overview/) is a path the host shares — the
nested run containers are started by the host's daemon, so `TCAB_WORK_DIR` must
resolve to the *same* path on the host, not just inside the worker container.
That is the same caveat the
[`.env.worker.example`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.env.worker.example)
flags for macOS/Windows.

To keep the moving parts obvious, **run the worker directly on the host** and
only optionally containerize the backend. The
[`deployments/local/compose.yml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/local/compose.yml)
template brings the backend up in a container with a local volume for its state;
the worker stays a host process throughout.

## 1. Configure the services

Copy the repo-root example env files and fill them in. These remain the
authoritative list of every variable each service reads.

```sh
cp .env.backend.example .env.backend
cp .env.worker.example  .env.worker
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

In `.env.worker`, point the worker at the local backend and provide the harness
key for whatever you will run:

```sh
TCAB_BACKEND_URL=http://127.0.0.1:8787
# Leave TCAB_WORKER_BIND at its default 127.0.0.1:8788.
# Leave TCAB_AUTH_URL at its default http://127.0.0.1:8789 so the worker proxies
# register/login to, and forwards bearer tokens against, the auth service.
ANTHROPIC_API_KEY=sk-ant-...
```

## 2. Start the backend

Either run the binary directly from a directory containing `.env.backend`:

```sh
./target/debug/tcab-backend
```

or bring it up with the compose template, which mounts a local volume for the
default SQLite database and the definition store so they survive a restart:

```sh
docker compose -f deployments/local/compose.yml up backend
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

## 3. Start the auth service

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

## 4. Start the worker

From a directory containing `.env.worker`, on the host:

```sh
./target/debug/tcab-worker
```

It reads `TCAB_BACKEND_URL`, resolves definitions from the backend you just
started, and binds `127.0.0.1:8788`. Check `curl http://127.0.0.1:8788/healthz` —
the response reports the worker's identity and the backend it is bound to, which
is a quick way to confirm the two agree.

## 5. Start the web console

Run the console's dev server and open it in a browser:

```sh
npm run dev -w @test-cabinet/web
```

In the UI, set the backend to `http://127.0.0.1:8787` and add the worker at
`http://127.0.0.1:8788`. The console verifies the worker is bound to the same
backend before it will launch runs on it. From there you can launch a run on the
local worker, watch its [event stream](/components/core/events/) live, and review
the result exactly as you would against a remote environment.

## Telemetry (optional)

To watch traces across `tcab-backend` → `tcab-worker` locally, enable the
bundled Grafana LGTM stack and point each process at it. That is fully described
under [Observability](/development/observability/) — note the
[endpoint-duality rule](/development/observability/#endpoint-duality-host-vs-container):
a backend running inside the devcontainer uses `http://lgtm:4318`, while a worker
on the host uses `http://localhost:4318`. Leaving `OTEL_EXPORTER_OTLP_ENDPOINT`
unset keeps both on plain stdout logging.

## Next

When this works end to end, the same service binaries deploy unchanged to
[staging and prod on Azure](/deployment/azure/) — what changes is where they bind
and how they are supervised, not how they are configured. See
[Deployment](/deployment/overview/) for the remote build.
