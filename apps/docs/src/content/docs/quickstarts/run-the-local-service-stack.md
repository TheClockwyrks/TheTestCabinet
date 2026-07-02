---
title: Run the Local Service Stack
---

Bring up the whole service-driven flow — backend (run queue), auth, dispatcher,
and artifact service — on a local [k3d](https://k3d.io) cluster (the web console
runs from source, not in-cluster), and
drive runs the way the [web console](/components/web/overview/) does in the cloud:
enqueue a run, and an in-cluster [dispatcher](/components/dispatcher/overview/)
schedules it as a per-run [driver](/components/driver/overview/) Job. This is the
service-driven alternative to the single CLI [Run a Test Case](/quickstarts/run-a-test-case/).

For the full walkthrough and the *why*, see
[Running the Local Service Stack](/guides/running-the-local-service-stack/); for
every service variable, [Running](/development/running/).

## Prerequisites

- Docker (or a Docker-compatible runtime), [`k3d`](https://k3d.io), `kubectl`, and
  `make` on `PATH`. (k3d's first-class runtime is Docker; on Podman it needs
  rootful + the Docker socket.)
- A harness API key exported — `ANTHROPIC_API_KEY` (`claude`), `OPENAI_API_KEY`
  (`codex`), or `OPENROUTER_API_KEY` (`cline`/`goose`/`kilo`/`opencode`/`pi`). The
  Makefile reads it from the environment into the cluster Secret; nothing is
  written to a tracked file.

## Steps

```sh
export OPENROUTER_API_KEY=…                   # the harness you'll run

make -C deployments/local local-up            # cluster + images (backend/auth/dispatcher/driver/artifact/arena) + secrets + overlay + ingest
make -C deployments/local local-forward       # backend → :8787, auth → :8789, artifacts → :8790, arena → :8791 (leave running)
npm run -w apps/web dev                        # the web console, from source → :1430 (its own terminal)
```

The web console runs **from source** (not in-cluster), pre-pointed at the forwarded
backend/auth via the committed `apps/web/.env.development` — no `VITE_BACKEND_URL` to
set. Open it at <http://127.0.0.1:1430> and the catalog loads on first visit. Then,
in the console:

1. **Register / log in** (or `tcab register --username dev --display-name "Dev"`)
   so push/review/publish are attributed to you.
2. **Enqueue a run** — pick a case, a model, and the harness whose key you
   exported. The console streams its [events](/components/core/events/) live.
3. Watch it schedule as a Job: `kubectl -n tcab-local get jobs,pods -w` shows a
   driver Job and (Kubernetes runtime) a sandbox pod. The finished run is
   reviewable, its build served from the [artifact service](/components/artifacts/overview/).

## Manage

```sh
make -C deployments/local local-status        # pods, services, volumes
make -C deployments/local local-rebuild       # after a code change: rebuild + restart
make -C deployments/local local-ingest        # after editing a case: force re-ingest
make -C deployments/local local-down          # delete the cluster and everything in it
```

## Next steps

- [Running the Local Service Stack](/guides/running-the-local-service-stack/) — the
  full guide, including the topology and troubleshooting.
- [Review a Run](/quickstarts/review-a-run/) · [Publish a Run](/quickstarts/publish-a-run/)
  — what to do with the run you produced.
