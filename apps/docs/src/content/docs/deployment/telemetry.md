---
title: Telemetry
---

The Test Cabinet's services emit OpenTelemetry traces, metrics, and logs over
OTLP, opt-in through the standard `OTEL_*` variables.
[Observability](/development/observability/) documents that mechanism: every
variable, how the spans nest, and the local stack. This page covers what a
deployment additionally needs, which is a collector to export to and the
per-environment wiring to reach it.

The default is to run the collector in the cluster, through the
`components/observability` kustomize component. Including it in an overlay both
deploys the stack and gives every service somewhere to export to. Grafana Cloud
and an external collector are drop-in alternatives.

## Per-environment enablement

Telemetry stays off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so each
environment opts in independently. Enable it in both staging and prod, so a
change is validated against the same distributed trace in both. Tag each
environment with `TCAB_ENV` so its traces, metrics, and logs carry the right
`deployment.environment.name`.

Every service reads its endpoint from its pod environment. With the in-cluster
LGTM stack, each overlay's env patch sets
`OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318` on every workload, alongside
`TCAB_ENV`. With an external collector, set that endpoint to your collector's
address and supply any auth header from a Kubernetes `Secret` through
`OTEL_EXPORTER_OTLP_HEADERS`. The dispatcher forwards its endpoint, headers,
protocol, and `TCAB_ENV` into every per-run driver `Job` and every publish `Job`,
so their spans export alongside the long-lived services with no extra wiring.

The [web console](/components/web/overview/) is a browser app that exports traces
only, through the `VITE_OTEL_*` build-time variables. The CLI and Tauri app are
operator tools rather than deployed services, and read the same `OTEL_*`
variables on whatever host runs them.

## Choosing a collector

Any OTLP/HTTP collector works, since the export is vendor-neutral. The three
options below differ mainly in how much you operate yourself.

### Self-hosted Grafana LGTM

The `components/observability` component runs the
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one
image (collector plus Tempo, Mimir, Loki, and Grafana) in the cluster, which is
the same stack local development runs. All four cloud overlays include it. It
adds:

- a `tcab-lgtm` `StatefulSet` and `ClusterIP` `Service`, with a
  `PersistentVolumeClaim` per store so telemetry survives a restart and retention
  windows mean something;
- a `NetworkPolicy` admitting OTLP from the services and the per-run `Job`s
  through the base default-deny;
- a `tcab-lgtm-config` ConfigMap carrying the Loki configuration, mounted over
  the image's own copy so log retention can be set.

Retention is tuned per environment by patching `LOKI_RETENTION_PERIOD`,
`TEMPO_BLOCK_RETENTION`, and `PROMETHEUS_RETENTION` on the `StatefulSet`. The
component defaults to 24 hours, and `azure-prod` raises it to three days.

The `Service` is `ClusterIP` and carries no public `Ingress`. Reach Grafana with
`kubectl port-forward svc/tcab-lgtm 3000:3000`, or, on the overlays that include
`components/internal-ingress`, at the `grafana.` hostname over the VPN-only
ingress. Because the `otel-lgtm` image ships Grafana with anonymous admin,
exposing that hostname is paired with the overlay's `patch-grafana-auth.yaml`,
which disables anonymous access and sets admin credentials from the
`tcab-grafana-admin` Secret. Both `grafana-admin-user` and
`grafana-admin-password` must exist in Key Vault before the overlay applies; see
[Internal ingress](/deployment/kubernetes/internal-ingress/).

This option is the cheapest and adds no third-party dependency, and you operate
and secure the telemetry workload yourself. Dropping the component from an
overlay opts out, leaving its workloads on stdout-only logging.

### Grafana Cloud

A managed Grafana stack (Tempo, Mimir, Loki) that accepts OTLP directly, and the
same Grafana UI used locally, so dashboards and queries transfer. Omit the
observability component and point each service at the OTLP endpoint, passing the
token as a header:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic <base64-instance-id:token>
```

Treat the header as a secret and inject it from your secret store.

### A managed observability backend

To send to a managed backend (a cloud provider's monitor, or any OTLP-compatible
vendor), run an
[OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) that receives
OTLP from the services and exports onward. The services still speak plain OTLP
and the collector does the translation. An example collector configuration is in
`deployments/telemetry/otel-collector.yaml`. This is the most setup, since it
adds a collector to run as a sidecar or its own `Deployment`, and it keeps a
third-party metrics backend in the loop without the services knowing about it.

## Authentication and volume

- Authenticate the export with `OTEL_EXPORTER_OTLP_HEADERS` whenever the
  collector requires it. Grafana Cloud always does. Inject the header from your
  secret store.
- Sample if volume warrants it with `OTEL_TRACES_SAMPLER` and
  `OTEL_TRACES_SAMPLER_ARG`. The default exports everything, which suits this
  project's scale.

## Running without telemetry

An unset `OTEL_EXPORTER_OTLP_ENDPOINT` keeps a service on stdout-only logging
with no exporter overhead, which is a legitimate production configuration for an
operator who reads container logs directly. Telemetry data is disposable, so it
is the one thing in a deployment that needs no [backup](/deployment/backups/).
