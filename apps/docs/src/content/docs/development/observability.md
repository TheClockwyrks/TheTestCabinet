---
title: Observability
---

The Test Cabinet emits [OpenTelemetry](https://opentelemetry.io/) traces,
metrics, and logs over OTLP. Export is **opt-in and vendor-neutral**: with no
collector endpoint configured every binary behaves exactly as it did before —
structured logs to stdout, nothing exported, no collector required, and never a
panic if a collector is unreachable. Pointing the standard `OTEL_*` environment
variables at any OTLP/HTTP collector turns export on.

This page covers what is instrumented and how the spans nest, the configuration
variables and their per-process notes, running the bundled local stack, and
production guidance. For building and releasing the binaries see
[Building](/development/building/) and [Releasing](/development/releasing/); for
running the services locally see [Running](/development/running/).

## Opt-in by design

Telemetry is wired through the shared `test-cabinet-telemetry` crate
(`crates/telemetry`). Every long-lived binary calls its `init()` once at
startup; the browser [web console](/components/web/overview/) calls the
equivalent `initTelemetry()` before its first fetch. The master switch is
`OTEL_EXPORTER_OTLP_ENDPOINT` (`VITE_OTEL_EXPORTER_OTLP_ENDPOINT` in the
browser):

- **Unset or blank** — the binary installs only its stdout logging layer with
  the usual `RUST_LOG` / default filter. No exporter is built, no global
  providers or propagator are installed, and the process logs a single line
  noting that OTLP export is disabled. This is the default and it is identical to
  the pre-telemetry behavior.
- **Set** — the binary additionally installs OTLP trace, metric, and log
  pipelines, sets the global W3C trace-context propagator, and exports to the
  configured collector. A missing or unreachable collector is still never fatal;
  export simply fails in the background.

Because the switch is a single standard environment variable, enabling
observability never requires a code change or a rebuild.

## What is instrumented

| Process | Service name | Instrumentation |
| ------- | ------------ | --------------- |
| [Core](/components/core/overview/) (in-process in every runner) | — | Orchestration spans for the run lifecycle (seeding, container execution, harness invocation, validation, publish), outbound context propagation on its HTTP calls, and `TRACEPARENT` on the subprocesses it shells out to. |
| [Dispatcher](/components/dispatcher/overview/) | `tcab-dispatcher` | Control-loop spans for claiming queued runs and creating per-run driver `Job`s. |
| [Driver](/components/driver/overview/) | `tcab-driver` | Run-execution spans, inbound trace-context extraction from the enqueued request, outbound context propagation to the backend, and publisher spans. |
| [Backend](/components/backend/overview/) | `tcab-backend` | Axum server spans, inbound trace-context extraction, and request metrics. |
| [CLI](/components/cli/overview/) (`tcab`) | `tcab` | Init plus a span per command, driving the core's run spans. |
| [Tauri app](/components/tauri/overview/) | `tcab-desktop` | Init plus command spans, driving the core's run spans. |
| [Web console](/components/web/overview/) | `tcab-web` | Browser **traces** only (no metrics/logs): a span per `fetch`, with a `traceparent` header injected on every outbound request. |

The core has no service name of its own because it is a library that runs
in-process inside whichever runner launched it (the CLI, the desktop app, or the
driver); its spans are emitted under that host's service name.

## Trace topology

A single user action produces one distributed trace that threads through every
process it touches. Spans nest from the surface that initiated the work down
into the core and out to the backend:

- **CLI / desktop run.** The command span (under `tcab` or `tcab-desktop`) is the
  root. The core's orchestration spans nest beneath it: seeding the repository,
  executing the container, invoking the harness, validation, and — if the run is
  published — the publish/publisher spans. The core's outbound HTTP calls to the
  [backend](/components/backend/overview/) carry the trace context, so the
  backend's request spans (`tcab-backend`) join the same trace as children.

- **Web-console run.** The browser's `fetch` span is the root. It injects a
  `traceparent` header on the enqueue request to the backend, which carries the
  context into the [driver](/components/driver/overview/) the dispatcher creates
  for the run, so the driver's run span (`tcab-driver`) becomes a descendant of
  the browser span. The core then runs inside the driver exactly as above, and the
  driver's own outbound calls to the backend continue the trace into
  `tcab-backend`. The end-to-end path is therefore
  **browser → backend → driver → backend**, with the core's run spans nested
  inside the driver leg.

- **Driver → backend** and **runner → backend** propagation both use the
  standard W3C `traceparent` header. The propagation helpers are no-ops unless
  the process opted in (they need the global propagator that `init()` installs),
  so in stdout-only mode no headers are added.

### Subprocess trace gaps

The core shells out to several external processes — the container runtime, `gh`
and `wrangler` during a publish, and the Playwright
[browser driver](/components/core/validation/) during validation. For these the
core sets the W3C `TRACEPARENT` environment variable on the child process, so the
trace context *is* carried across the process boundary. Whether the child
actually emits a child span depends on that tool: the agent
[harness](/components/core/harnesses/) and the third-party CLIs are not
OpenTelemetry-instrumented, so today they appear as a **gap** — the parent span
records the time spent in the subprocess, but there are no spans from inside it.
The `TRACEPARENT` is set regardless so that any future instrumented child, or an
instrumented harness, would slot into the trace without further work.

## Configuration

All of the binaries read the standard `OTEL_*` variables, consumed directly by
the OpenTelemetry SDK, plus one custom variable. Export is over **OTLP
HTTP/protobuf** to the collector's `:4318` port.

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Master switch and collector base URL. Unset/blank disables export. | HTTP/protobuf base, e.g. `http://localhost:4318`. See the endpoint-duality note below. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Protocol selection. | The binaries always export over HTTP/protobuf, the SDK default for the `:4318` endpoint, so this rarely needs setting. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Extra export headers (e.g. an auth token for a hosted collector). | Comma-separated `key=value` pairs. |
| `OTEL_SERVICE_NAME` | Overrides the seeded `service.name`. | Defaults to the per-binary name in the table above; override only if needed. |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra/override resource attributes. | Standard SDK variable. |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sampler configuration. | Standard SDK variables. |
| `TCAB_ENV` | Sets the `deployment.environment.name` resource attribute. | Custom to this project. Default `local`; set to `dev`, `staging`, or `prod`. |
| `RUST_LOG` | Stdout log filter. | Unchanged from before; falls back to each binary's existing default when unset. |

The web console uses the same names with a `VITE_` prefix
(`VITE_OTEL_EXPORTER_OTLP_ENDPOINT`, `VITE_OTEL_SERVICE_NAME`, `VITE_TCAB_ENV`);
see `apps/web/.env.example`. The browser exports traces only and can only use the
HTTP `:4318` port. Its `service.version` is taken from the package version at
build time, not from an environment variable.

### Endpoint duality: host vs. container

The right value for `OTEL_EXPORTER_OTLP_ENDPOINT` depends on **where the process
runs**, because the local collector is reachable under two different names:

| Process | Runs | Local endpoint |
| ------- | ---- | -------------- |
| Backend, web console | inside the devcontainer | `http://lgtm:4318` (compose service DNS) |
| Worker, `tcab` CLI, desktop app, browser | on the host | `http://localhost:4318` (published port) |

Each per-process example env file at the repo root (`.env.backend.example`,
`.env.worker.example`, `.env.runner.example` for the CLI and desktop, and
`apps/web/.env.example`) ships the correct default for that process, commented
out. Copy the relevant file to its real `.env.*` and uncomment the endpoint to
enable export.

## Local stack (Grafana LGTM)

The devcontainer ships an opt-in `lgtm` service running the
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one
image — an OpenTelemetry collector plus Tempo (traces), Mimir (metrics), Loki
(logs), and Grafana to view them. It is dormant until you enable it and points at
nothing by default, so the workspace's behavior is unchanged for anyone who does
not opt in.

To bring it up and view telemetry:

1. **Rebuild the devcontainer** — *Dev Containers: Rebuild Container* in VS Code.
   This is what first starts the `lgtm` service; it is not running otherwise. See
   [`.devcontainer/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/.devcontainer/README.md)
   for the container setup.
2. **Enable export** on the processes you want to observe: copy the relevant
   `.env.*.example` to its real `.env.*` (and `apps/web/.env.example` to
   `apps/web/.env.local`), uncomment `OTEL_EXPORTER_OTLP_ENDPOINT`, choosing the
   address by where the process runs (see the duality table above), and restart
   the process so it re-reads its env file.
3. **Open Grafana at <http://localhost:3000>** (anonymous admin, no login). Use
   *Explore* with the Tempo data source to find traces (search by service name,
   e.g. `tcab-driver`, then open a trace to see the cross-service span tree),
   Mimir for the request metrics, and Loki for the exported logs.

The image publishes both the HTTP (`:4318`) and gRPC (`:4317`) OTLP ports to the
host; the binaries and browser use HTTP/protobuf. The Grafana state lives in a
named volume so dashboards and saved queries survive a rebuild.

## Production and staging

Telemetry is off until configured, so a deployed environment opts in the same
way local development does — by setting the standard variables on each process:

- **Point each service at your collector.** Set `OTEL_EXPORTER_OTLP_ENDPOINT` to
  your OTLP/HTTP collector's base URL on every process you want to observe
  (backend, workers, and any CLI/desktop hosts). The export is vendor-neutral, so
  the collector can be Grafana, an OpenTelemetry Collector forwarding to any
  backend, or a hosted OTLP endpoint.
- **Set `TCAB_ENV`** to `prod` or `staging` so traces, metrics, and logs are
  tagged with the right `deployment.environment.name` and can be filtered apart
  from local and from each other.
- **Authenticate the export** with `OTEL_EXPORTER_OTLP_HEADERS` when the
  collector requires it (for example
  `OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <token>`). Treat these as
  secrets and inject them through your secret store, not a committed file.
- **Sample if volume warrants it** with `OTEL_TRACES_SAMPLER` /
  `OTEL_TRACES_SAMPLER_ARG`; the default is to export everything.

Leaving `OTEL_EXPORTER_OTLP_ENDPOINT` unset in any environment keeps that process
on stdout-only logging with zero exporter overhead, which remains a valid
configuration in production.
