---
title: Observability
---

The Test Cabinet emits [OpenTelemetry](https://opentelemetry.io/) traces,
metrics, and logs over OTLP. Export is opt-in and vendor-neutral: pointing the
standard `OTEL_*` environment variables at any OTLP/HTTP collector turns it on.

This page covers what is instrumented and how the spans nest, the configuration
variables, the local stack, and deployed environments.

## Opt-in export

Telemetry is wired through the shared `test-cabinet-telemetry` crate
(`crates/telemetry`). Every long-lived binary calls its `init()` once at startup;
the browser [web console](/components/web/overview/) calls the equivalent
`initTelemetry()` before its first fetch. The switch is
`OTEL_EXPORTER_OTLP_ENDPOINT`, or `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` in the
browser:

- Unset or blank. The binary installs only its stdout logging layer with the
  usual `RUST_LOG` or default filter, builds no exporter, installs no global
  providers or propagator, and logs a single line noting that OTLP export is
  disabled.
- Set. The binary additionally installs OTLP trace, metric, and log pipelines,
  sets the global W3C trace-context propagator, and exports to the configured
  collector. An unreachable collector is never fatal; export fails in the
  background.

Because the switch is a single standard environment variable, enabling
observability requires no code change and no rebuild.

## Instrumented processes

| Process                                                         | Service name          | Instrumentation                                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Core](/components/core/overview/) (in-process in every runner) | —                     | Orchestration spans for the run lifecycle (seeding, container execution, harness invocation, validation, publish), outbound context propagation on its HTTP calls, and `TRACEPARENT` on the subprocesses it shells out to. |
| [Dispatcher](/components/dispatcher/overview/)                  | `tcab-dispatcher`     | Control-loop spans for claiming queued runs and creating per-run driver `Job`s.                                                                                                                                            |
| [Driver](/components/driver/overview/)                          | `tcab-driver`         | Run-execution spans, inbound trace-context extraction from the enqueued request, outbound context propagation to the backend, and publisher spans.                                                                         |
| [Backend](/components/backend/overview/)                        | `tcab-backend`        | Axum server spans, inbound trace-context extraction, and request metrics.                                                                                                                                                  |
| [Auth service](/components/auth/overview/)                      | `tcab-auth-service`   | Axum server spans and inbound trace-context extraction.                                                                                                                                                                    |
| [Artifact service](/components/artifacts/overview/)             | `tcab-artifacts`      | Axum server spans and inbound trace-context extraction.                                                                                                                                                                    |
| [Arena service](/components/arena/overview/)                    | `tcab-arena`          | Axum server spans and inbound trace-context extraction.                                                                                                                                                                    |
| [CLI](/components/cli/overview/) (`tcab`)                       | `tcab-cli`            | Init plus a span per command, driving the core's run spans.                                                                                                                                                                |
| [Agent harness](/harnesses/overview/) (in the run container)    | `tcab-harness-<slug>` | Per harness, where the vendor supports it; see [harness telemetry](#harness-telemetry).                                                                                                                                    |
| [Tauri app](/components/tauri/overview/)                        | `tcab-desktop`        | Init plus command spans, driving the core's run spans.                                                                                                                                                                     |
| [Web console](/components/web/overview/)                        | `tcab-web`            | Browser traces only: a span per `fetch`, with a `traceparent` header injected on every outbound request.                                                                                                                   |

The core has no service name of its own. It is a library that runs in-process
inside whichever runner launched it, so its spans are emitted under that host's
service name: the CLI, the desktop app, or the driver.

## Cluster resource metrics

Everything in the table above is telemetry our own processes _push_. It says
nothing about what a container actually consumed — and that is the data needed to
size a run pod's memory request to its real peak (run pods carry no memory limit;
see [memory ceilings](/deployment/kubernetes/overview/#memory-ceilings)) and to
check that a service's limit is a safe ceiling rather than a scheduled OOM kill.

So in a Kubernetes deployment the LGTM stack's Prometheus also **scrapes** each
node's kubelet cAdvisor endpoint. This is configured in
[`components/observability/prometheus.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/components/observability/prometheus.yaml),
mounted over the image's own copy the same way `loki-config.yaml` is (the
`grafana/otel-lgtm` image ships Prometheus as a pure OTLP sink with no scrape jobs
at all). It is the reason the LGTM ServiceAccount holds one narrow cluster-scoped
grant — `nodes` list/watch and `nodes/metrics` get, and deliberately **not**
`nodes/proxy`, which would also expose `/exec` on every node.

Only nine series per container are kept; cAdvisor exposes several hundred, and
per-run pods churn their names constantly, so the rest would be TSDB weight nobody
queries. What is kept, and why:

| Series                                                                  | Answers                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container_memory_max_usage_bytes`                                      | The **cgroup's own high-water mark**, maintained continuously by the kernel — so it catches a spike that happened between two scrapes. This is the sizing number.                                                      |
| `container_memory_working_set_bytes`                                    | What the kubelet actually evicts on.                                                                                                                                                                                   |
| `container_spec_memory_limit_bytes`                                     | The configured limit, so a service's peaks can be compared to its ceiling without cross-referencing manifests. Run pods have no limit, so for them this series reports the cgroup's `max` sentinel and is meaningless. |
| `container_cpu_usage_seconds_total`                                     | Real CPU draw.                                                                                                                                                                                                         |
| `container_cpu_cfs_{periods,throttled_periods,throttled_seconds}_total` | Whether CPU oversubscription is actually costing anything.                                                                                                                                                             |
| `container_spec_cpu_{quota,shares}`                                     | The configured CPU limit and request.                                                                                                                                                                                  |

Read the first two together rather than picking one. `max_usage` includes
reclaimable page cache, which the kernel drops under pressure instead of
OOM-killing for, so it overstates the footprint that actually decides a kill and
is a safe upper bound. `working_set` is the quantity eviction and the OOM killer
act on, but it is sampled only each scrape, so a spike between two scrapes is
invisible to it and it is a lower bound. A ceiling picked above the `max_usage`
peak is certainly safe; one picked from the `working_set` peak alone is not.
Where the two diverge sharply the gap is page cache, which is normal for a
container that has just written a build tree to disk.

Prod keeps metrics for **30 days** while logs and traces keep 3
([`patch-lgtm-retention.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/k8s/overlays/azure-prod/patch-lgtm-retention.yaml)).
The windows differ because the questions do: a trace answers "what happened in this
run" and is read within days, whereas a peak-memory figure is only trustworthy over
a window wide enough to contain the rare heavy test case.

Useful queries, in Grafana _Explore_ against the Prometheus datasource:

```promql
# The largest memory any run pod has ever reached — what the sandbox memory
# REQUEST (TCAB_K8S_RUN_MEMORY_REQUEST) must cover.
max_over_time(container_memory_max_usage_bytes{container="run"}[30d])

# The distribution of per-run peaks, to see how far the tail really goes.
quantile(0.99, max_over_time(container_memory_max_usage_bytes{container="run"}[30d]))

# How far past its request a run has gone. The request is not among the scraped
# series, so substitute the configured value (4Gi here); above 1.0 the run was
# using memory the node had not reserved for it.
max_over_time(container_memory_working_set_bytes{container="run"}[30d]) / (4 * 1024^3)

# How close a SERVICE comes to its ceiling (1.0 would be an OOM kill).
max_over_time(container_memory_working_set_bytes{container="backend"}[30d])
  / on(pod) container_spec_memory_limit_bytes{container="backend"}

# Whether CPU oversubscription is actually throttling runs.
  rate(container_cpu_cfs_throttled_periods_total{container="run"}[5m])
/ rate(container_cpu_cfs_periods_total{container="run"}[5m])
```

One limit worth knowing: cAdvisor labels series with `pod`, `namespace` and
`container` only — never a pod's own labels. So these group by _pod_, not by test
case, and a run pod's name carries no case identity. Global figures (the queries
above) are exactly right for sizing one cluster-wide limit; per-case sizing would
need `kube-state-metrics` deployed to join `kube_pod_labels` against the run's
`tcab.dev/job-id`.

## Trace topology

A single user action produces one distributed trace threading through every
process it touches. Spans nest from the surface that initiated the work down into
the core and out to the backend.

### CLI and desktop runs

The command span, under `tcab-cli` or `tcab-desktop`, is the root. The core's
orchestration spans nest beneath it: seeding the repository, executing the
container, invoking the harness, validation, and the publisher spans for a
published run. The core's outbound HTTP calls to the
[backend](/components/backend/overview/) carry the trace context, so the
backend's request spans join the same trace as children.

### Web console runs

The browser's `fetch` span is the root. It injects a `traceparent` header on the
enqueue request to the backend, which carries the context into the
[driver](/components/driver/overview/) the dispatcher creates for the run, so
the driver's run span becomes a descendant of the browser span.
The core then runs inside the driver as above, and the driver's own outbound
calls continue the trace into `tcab-backend`. The end-to-end path is browser →
backend → driver → backend, with the core's run spans nested inside the driver
leg.

Both driver-to-backend and runner-to-backend propagation use the standard W3C
`traceparent` header. The propagation helpers need the global propagator that
`init()` installs, so in stdout-only mode they add no headers.

### Subprocess trace gaps

The core shells out to several external processes: the container runtime, `gh`
and `wrangler` during a publish, and the Playwright
[browser driver](/components/core/validation/) during validation. For these the
core sets the W3C `TRACEPARENT` environment variable on the child, so the trace
context crosses the process boundary. Whether the child emits a span depends on
that tool, and none of these is OpenTelemetry-instrumented, so each appears as a
gap: the parent span records the time spent in the subprocess with no spans from
inside it. `TRACEPARENT` is set regardless, so an instrumented child slots into
the trace with no further work.

The agent [harness](/components/core/harnesses/) runs inside the run container
rather than as a child process on the host. Setting `TRACEPARENT` on the
`docker exec` client would not reach it, because the runtime does not forward the
client's environment across the daemon and the Kubernetes exec API carries no
environment at all. The harness's trace context is therefore set on the
container, at start, alongside the rest of its telemetry configuration.

## Harness telemetry

The harness is a third-party CLI, so it is instrumented the way its vendor
documents, which differs per harness. When a deployment exports telemetry, a run
configures its harness to export using the same `OTEL_EXPORTER_OTLP_ENDPOINT`
switch.

The support matrix, the exact variables and config files written, and the reasons
for the gaps live with each harness, on its Telemetry page; start at
[Harnesses](/harnesses/overview/). In summary:

| Harness                                          | Exports               | Joins the run's trace                        |
| ------------------------------------------------ | --------------------- | -------------------------------------------- |
| [Claude Code](/harnesses/claude/telemetry/)      | traces, metrics, logs | Yes, reads the standard `TRACEPARENT`        |
| [OpenCode](/harnesses/opencode/telemetry/)       | traces, metrics, logs | Yes, via the plugin's `OPENCODE_TRACEPARENT` |
| [Codex](/harnesses/codex/telemetry/)             | traces, logs          | No, correlate by resource attribute          |
| [Goose](/harnesses/goose/telemetry/)             | traces, metrics, logs | No, correlate by resource attribute          |
| [Kilo Code](/harnesses/kilo/telemetry/)          | traces, logs          | No, correlate by resource attribute          |
| [Cline](/harnesses/cline/telemetry/)             | —                     | —                                            |
| [Pi](/harnesses/pi/telemetry/)                   | —                     | —                                            |
| [Antigravity](/harnesses/antigravity/telemetry/) | —                     | —                                            |

Every exporting harness reports under the service name `tcab-harness-<slug>` and
carries `tcab.harness`, `tcab.test_case`, `tcab.variant`, `tcab.model`, and
`tcab.run_id` resource attributes. Those attributes are what makes a harness that
cannot join the run's trace still correlatable to the run that produced it.

`tcab.run_id` identifies a specific run rather than a class of them. The harness
is told the ID before it starts, so the run's ID is minted at the top of
`run_resolved` rather than when its record is assembled at the end. The other
four attributes narrow a search; this one attributes a span to one run.

The endpoint is resolved from the container's point of view. In a cluster that is
the collector's Service DNS name. On a developer machine the local endpoint is a
loopback address, which inside the container would mean the container itself, so
it is rewritten to `host.docker.internal` and the container is given the matching
host-gateway mapping.

The trace context carries the sampling decision, so a harness that joins the
run's trace suppresses its own export when the run is not sampled.

## Configuration

All binaries read the standard `OTEL_*` variables, consumed directly by the
OpenTelemetry SDK, plus one custom variable. Export is over OTLP HTTP/protobuf to
the collector's `:4318` port.

| Variable                                          | Purpose                                                               | Notes                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                     | Master switch and collector base URL. Unset or blank disables export. | HTTP/protobuf base, e.g. `http://localhost:4318`. See the endpoint-duality note below. |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                     | Protocol selection.                                                   | The binaries export over HTTP/protobuf, the SDK default for the `:4318` endpoint.      |
| `OTEL_EXPORTER_OTLP_HEADERS`                      | Extra export headers, such as an auth token for a hosted collector.   | Comma-separated `key=value` pairs.                                                     |
| `OTEL_SERVICE_NAME`                               | Overrides the seeded `service.name`.                                  | Defaults to the per-binary name in the table above.                                    |
| `OTEL_RESOURCE_ATTRIBUTES`                        | Extra or overriding resource attributes.                              | Standard SDK variable.                                                                 |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sampler configuration.                                                | Standard SDK variables.                                                                |
| `TCAB_ENV`                                        | Sets the `deployment.environment.name` resource attribute.            | Custom to this project. Default `local`; set to `dev`, `staging`, or `prod`.           |
| `RUST_LOG`                                        | Stdout log filter.                                                    | Falls back to each binary's default when unset.                                        |

The web console uses the same names with a `VITE_` prefix
(`VITE_OTEL_EXPORTER_OTLP_ENDPOINT`, `VITE_OTEL_SERVICE_NAME`, `VITE_TCAB_ENV`);
see `apps/web/.env.example`. The browser exports traces only, over the HTTP
`:4318` port. Its `service.version` is taken from the package version at build
time.

### Endpoint duality: in-cluster vs. out-of-cluster

The local Grafana LGTM stack runs in the k3d cluster, so the right value for
`OTEL_EXPORTER_OTLP_ENDPOINT` depends on whether the process runs inside that
cluster:

| Process                                                                         | Runs                | Local endpoint                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Backend, auth, dispatcher, driver, artifacts, arena                             | in the cluster      | `http://tcab-lgtm:4318` (in-cluster Service DNS), set by the [observability component](#local-stack-grafana-lgtm) |
| `cargo run` binary in the devcontainer, host `tcab` CLI or desktop app, browser | outside the cluster | `http://localhost:4318`, via `make -C deployments/local local-grafana`                                            |

The in-cluster services need no env-file change: the local overlay points each at
`tcab-lgtm`. For a binary run outside the cluster, run
`make -C deployments/local local-grafana`, which forwards the in-cluster
collector to `localhost:4318`, and point the process there. Each per-process
example env file at the repo root (`.env.backend.example`, `.env.auth.example`,
`.env.dispatcher.example`, `.env.runner.example` for the CLI and desktop, and
`apps/web/.env.example`) ships that `http://localhost:4318` default commented
out. Copy the relevant file to its real `.env.*` and uncomment the endpoint to
enable export.

## Local stack (Grafana LGTM)

The local k3d cluster runs the
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one
image as the local overlay's `components/observability`, the same component
staging and production use. The image carries an OpenTelemetry collector plus
Tempo for traces, Mimir for metrics, Loki for logs, and Grafana to view them.
Telemetry stays opt-in per process, through each one's
`OTEL_EXPORTER_OTLP_ENDPOINT`.

1. Start the cluster with `make -C deployments/local local-up`. That stands up
   the whole stack, including the `tcab-lgtm` workload, and the local overlay
   already points every in-cluster service at it, so the services export from
   their first start. See [Running](/development/running/).
2. Forward Grafana, and the collector when needed. Grafana is forwarded to
   `localhost:3000` by `make -C deployments/local local-forward`, the data-plane
   session you keep running anyway. `make -C deployments/local local-grafana` is
   the superset that also forwards the OTLP collector to `localhost:4318` and
   `:4317`, for observing a binary run outside the cluster. To do that, copy the
   relevant `.env.*.example` to its real `.env.*` (and `apps/web/.env.example` to
   `apps/web/.env.local`), uncomment
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, and restart the process.
3. Open Grafana at <http://localhost:3000> (anonymous admin, no login). Use
   Explore with the Tempo data source to find traces, searching by service name
   such as `tcab-driver` and opening a trace to see the cross-service span tree;
   Mimir for the request metrics; and Loki for the exported logs.

The collector accepts both the HTTP (`:4318`) and gRPC (`:4317`) OTLP ports; the
binaries and browser use HTTP/protobuf.

Grafana's state lives on a `PersistentVolumeClaim` so dashboards and saved
queries survive a pod restart, and each telemetry store gets its own claim. The
traces describing the period leading up to an OOM kill therefore outlive the pod
that was killed.

Each store has a retention window, set by the `LOKI_RETENTION_PERIOD`,
`TEMPO_BLOCK_RETENTION`, and `PROMETHEUS_RETENTION` environment variables on the
`tcab-lgtm` container, which the `*_EXTRA_ARGS` variables beside them
interpolate. The component sets 24h, and `overlays/azure-prod` raises it to 72h,
because a production issue is often investigated a day or more after the run
that caused it. These stores are a live debugging surface. To keep telemetry
long-term, forward it to a system built for retention rather than growing these
windows.

Two stores take extra configuration. Loki's retention is settable from a
configuration file alone, so the component ships a full `loki-config.yaml` and
mounts it over the image's copy; it is version-coupled to the image pin and must
be re-synced when that pin moves. Pyroscope holds only the LGTM stack's own Go
runtime profiles, since this project's services are Rust and its harnesses Node.
It keeps a small claim because the image offers no flag to disable it and its
startup readiness gate has no timeout.

## Production and staging

A deployed environment opts in the same way local development does, by setting
the standard variables on each process:

- Point each service at your collector. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to
  your OTLP/HTTP collector's base URL on every process you want to observe. The
  export is vendor-neutral, so the collector can be Grafana, an OpenTelemetry
  Collector forwarding to any backend, or a hosted OTLP endpoint.
- Set `TCAB_ENV` to `prod` or `staging`, so traces, metrics, and logs are
  tagged with the right `deployment.environment.name` and can be filtered apart.
- Authenticate the export with `OTEL_EXPORTER_OTLP_HEADERS` where the
  collector requires it, for example
  `OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <token>`. Treat these as
  secrets and inject them through your secret store.
- Sample if volume warrants it with `OTEL_TRACES_SAMPLER` and
  `OTEL_TRACES_SAMPLER_ARG`. The default exports everything.

Leaving `OTEL_EXPORTER_OTLP_ENDPOINT` unset in any environment keeps that process
on stdout-only logging with no exporter overhead, which remains a valid
production configuration.

## Traces for a run

The run detail page in the console links to the traces a run emitted, through
the "View run traces" control beside the tabs. It opens Grafana Explore on a
TraceQL search rather than on a single trace, because a run is several traces:
the driver, the artifact service, and the harness each emit their own, tied
together by the shared `run.id` attribute rather than by a common trace ID. The
query is:

```traceql
{ .run.id = "<run-uuid>" }
```

The link's time window comes from the run's own `startedAt` and `finishedAt` with
a few minutes of padding on either side, because the run being investigated is
frequently not a recent one. Retention still applies, so the link opens on an
empty result for a run older than the environment's window.

The console learns Grafana's address from the backend's `GET /config`, which
reports `grafanaUrl` from `TCAB_GRAFANA_PUBLIC_URL`. Nothing fetches from that
URL; it is only opened in the reader's browser. Where it is unset the control
does not render, which is the correct behavior for the public gallery site, whose
readers have no route to a VPN-only Grafana.
