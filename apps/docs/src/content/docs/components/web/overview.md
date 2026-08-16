---
title: Overview
---

The web console is The Test Cabinet's runner and reporter GUI, delivered as a
static browser bundle. It is the same console as the [Tauri
app](/components/tauri/overview/): both mount the `GalleryApp` component from
the [UI library](/components/ui/overview/) and differ only in how they are
delivered and in where their service URLs come from.

From the console a person signs in, configures and launches a run, watches its
live [event](/components/core/events/) stream, returns to a run still in
progress, kills a run from its live monitor, reads the
[specification](/testing/end-to-end/overview/) a run was built from,
[reviews](/components/core/results/#reviews) a finished run, and
[publishes](/components/core/results/#publish) it. The console executes no test
case itself. It enqueues the run at the backend, where a
[dispatcher](/components/dispatcher/overview/) claims it and a per-run
[driver](/components/driver/overview/) `Job` runs it. The driver stores the
finished record on the backend, so the console has no push step.

## Service dependencies

The console is bound to exactly one [backend](/components/backend/overview/) at
a time. That backend is the source of truth for the test-case catalog, the run
queue, produced and published runs, and the completion notification stream, all
reached over the [backend HTTP API](/components/backend/api/).

Three further services are called directly, and the backend reports the base URL
of each from `GET /config`:

- The [auth service](/components/auth/overview/) serves register, log in, and
  account profile pictures. The console posts credentials to it and carries the
  returned bearer token when it reviews or publishes.
- The [artifact service](/components/artifacts/overview/) serves a produced
  run's build, proof media, and asset-generation media before it is published.
- The [arena service](/components/arena/overview/) runs
  [adversarial](/testing/adversarial/overview/) matches and tournaments.

Run execution is the backend's queue, presented to the shared app as one fixed
execution handle bound to the active backend.

## Configuration

The backend URL is resolved from the first of three sources that supplies one: a
value the operator stored through Settings → Connections, the deployment's
runtime `/config.js` (read as `window.__TCAB_CONFIG__`), and the build-time
`VITE_BACKEND_URL`. The auth service URL resolves the same way and falls back to
the backend URL, which is what a single-host development stack wants. With no
backend URL the console reports itself unconfigured.

Browser tracing is gated on `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`. When that
variable is set the console exports spans over OTLP/HTTP and injects a
`traceparent` header on every outbound fetch; when it is unset the whole
pipeline is inert. See [Observability](/development/observability/).

## Bounded run loading

The run and model list pages are server-paged. Each page issues a
[`GET /runs?fields=summary`](/components/backend/api/#get-runs) query in
numbered-offset mode (`offset` plus `limit`) and sizes its pager from the
returned `total`. Search, the page-scoped filter, and column-header sort travel
as query parameters, so filtering and sorting happen in the backend; changing
any of them re-queries and returns to page 0. Produced and in-progress runs are
pinned ahead of the first page.

The home page fetches a recent window, and the case-scoped leaderboard and
metrics views fetch one bounded, case-scoped summary set. Only a run's detail
page loads that run's full [record](/components/core/run-records/) and its
reviews, [one run at a time](/components/backend/api/#get-runsid). Lightweight
`RunSummary` cards back
every list, card, leaderboard, and metric.

## Deployment

`vite build` emits a fully static bundle, packaged as the `tcab-web` image:
nginx serving that bundle, with an entrypoint that renders `/config.js` from the
container's environment. One image therefore serves every environment, because
the service URLs are injected at start rather than baked at build.

The console is an operator tool. It reads from and writes to the private
backend, so it is served on the same private network as the services it talks
to. In a cluster deployment it is the in-cluster `tcab-web` workload, reached at
a private hostname through the [internal
ingress](/deployment/kubernetes/internal-ingress/).
