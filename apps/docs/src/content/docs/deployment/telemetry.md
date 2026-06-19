---
title: Telemetry
---

The Test Cabinet's services emit OpenTelemetry traces, metrics, and logs over
OTLP, opt-in through the standard `OTEL_*` variables. That mechanism — every
variable, how the spans nest, the local Grafana LGTM stack — is documented in
full under [Observability](/development/observability/), and this page does not
repeat it. What a deployment additionally needs is a **collector to export to**
and the per-environment wiring to reach it; that is what this page covers.

## Enable it in staging and prod

Telemetry stays off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so each
environment opts in independently. **Enable it in both staging and prod** — a
production-shaped staging environment is exactly where a distributed trace earns
its keep when you are validating a change, and the cost is negligible. Tag each
environment with `TCAB_ENV` (`staging` / `prod`) so its traces, metrics, and logs
carry the right `deployment.environment.name` and can be filtered apart, as
[Observability](/development/observability/#production-and-staging) describes.

The two services read their endpoint from the same place they read everything
else:

- **Backend** — an environment variable on the Container App (the endpoint
  non-secret, the auth header a Container Apps **secret**), or in
  `/etc/test-cabinet/backend.env` on a VM.
- **Workers** — `/etc/test-cabinet/worker.env` on each VM (see the
  [worker env overlays](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/env)).

The [web console](/components/web/overview/) is a browser app that exports
**traces only** through the `VITE_OTEL_*` build-time variables; see
[Observability](/development/observability/#configuration). The CLI and Tauri app
are operator tools, not deployed services, but read the same `OTEL_*` variables on
whatever host runs them.

## Choosing a collector

Any OTLP/HTTP collector works — the export is vendor-neutral. The three options
below differ mainly in how much you operate yourself.

### Grafana Cloud

A managed Grafana stack (Tempo, Mimir, Loki) with a generous free tier that
accepts **OTLP directly**. It is the lowest-friction option and it is the same
Grafana UI you already use locally, so dashboards and queries transfer. Point
each service at the OTLP endpoint and pass the token as a header:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic <base64-instance-id:token>
```

Treat the header as a secret — inject it from your secret store, never commit it.

### Self-hosted Grafana LGTM

Run the [`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm)
all-in-one image on a small VM — the **same image the devcontainer runs**, so
staging/prod observability mirrors local exactly. Cheapest in dollars, but you
operate, secure, and (if you care about retention) back up the telemetry box
yourself. Point each service at that VM's `:4318` on the private network:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://<lgtm-host-private-address>:4318
```

### Azure Monitor

To keep everything in Azure, run an
[OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) that receives
OTLP from the services and exports to Azure Monitor / Application Insights — the
services still speak plain OTLP, the collector does the translation. An example
collector configuration is in
[`deployments/telemetry/otel-collector.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/telemetry/otel-collector.yaml).
This is the most setup (a collector to run, as a sidecar or its own small host)
but adds no third-party dependency.

## Authentication and volume

- **Authenticate the export** with `OTEL_EXPORTER_OTLP_HEADERS` whenever the
  collector requires it (Grafana Cloud always does; a private-network LGTM host
  may not). The header is a secret — inject it, do not commit it.
- **Sample if volume warrants it** with `OTEL_TRACES_SAMPLER` /
  `OTEL_TRACES_SAMPLER_ARG`; the default exports everything, which is fine at this
  project's scale.

## Leaving it off is valid

Per [Observability](/development/observability/), an unset
`OTEL_EXPORTER_OTLP_ENDPOINT` keeps a service on stdout-only logging with zero
exporter overhead — a legitimate production configuration if you would rather read
container/VM logs directly than stand up a collector. Telemetry data is itself
disposable; it is the one thing in a deployment you generally do **not** need to
[back up](/deployment/backups/).
