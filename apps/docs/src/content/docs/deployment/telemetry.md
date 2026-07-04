---
title: Telemetry
---

The Test Cabinet's services emit OpenTelemetry traces, metrics, and logs over
OTLP, opt-in through the standard `OTEL_*` variables. That mechanism — every
variable, how the spans nest, the local Grafana LGTM stack — is documented in
full under [Observability](/development/observability/), and this page does not
repeat it. What a deployment additionally needs is a **collector to export to**
and the per-environment wiring to reach it; that is what this page covers.

The default this project ships is to run the collector **in the cluster** — the
[`components/observability`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/observability)
kustomize component, the same Grafana LGTM stack local development uses. Including
it in an overlay both deploys the stack and points every service at it; the
[Self-hosted Grafana LGTM](#self-hosted-grafana-lgtm-the-default) section below is
the worked example. Grafana Cloud and an external collector remain drop-in
alternatives.

## Enable it in staging and prod

Telemetry stays off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so each
environment opts in independently. **Enable it in both staging and prod** — a
production-shaped staging environment is exactly where a distributed trace earns
its keep when you are validating a change, and the cost is negligible. Tag each
environment with `TCAB_ENV` (`staging` / `prod`) so its traces, metrics, and logs
carry the right `deployment.environment.name` and can be filtered apart, as
[Observability](/development/observability/#production-and-staging) describes.

Every service reads its endpoint from its pod environment. With the in-cluster
LGTM component (the default below), each overlay sets
`OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318` on every workload via its
env patch — the same place it sets `TCAB_ENV` — so enabling telemetry is just
including the component. With an external collector instead, set that endpoint
(and the auth header from a Kubernetes **`Secret`**, via `OTEL_EXPORTER_OTLP_HEADERS`)
to your collector's address. The **dispatcher** forwards its endpoint, headers,
and `TCAB_ENV` into every per-run **driver** Job, so run/driver spans
(`tcab-driver`) export alongside the long-lived services with no extra wiring.

The [web console](/components/web/overview/) is a browser app that exports
**traces only** through the `VITE_OTEL_*` build-time variables; see
[Observability](/development/observability/#configuration). The CLI and Tauri app
are operator tools, not deployed services, but read the same `OTEL_*` variables on
whatever host runs them.

## Choosing a collector

Any OTLP/HTTP collector works — the export is vendor-neutral. The three options
below differ mainly in how much you operate yourself; the first is the default
this repo ships.

### Self-hosted Grafana LGTM (the default)

Run the [`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm)
all-in-one image (collector + Tempo/Mimir/Loki + Grafana) **in the cluster** — the
**same stack local development runs**, so staging/prod observability mirrors local
exactly. This ships as the
[`components/observability`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/observability)
kustomize component, included by `overlays/{staging,prod,azure-staging,azure-prod}`:
it adds the `tcab-lgtm` `StatefulSet` + `Service` (with a `PersistentVolumeClaim`
for Grafana's state) and a `NetworkPolicy` admitting the services' OTLP, and each
overlay's env patch sets every workload's

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318
```

It is the cheapest in dollars and adds no third-party dependency, but you operate,
secure, and (if you care about retention) back up the telemetry workload yourself —
the telemetry stores are ephemeral by design (only Grafana's PVC persists). The
`tcab-lgtm` `Service` is `ClusterIP` and carries **no public Ingress**; reach Grafana
either through a `kubectl port-forward svc/tcab-lgtm 3000:3000` or — in `azure-prod`,
which layers on the [`components/internal-ingress`](https://github.com/TheClockwyrks/TheTestCabinet/tree/master/deployments/k8s/components/internal-ingress)
— at **`https://grafana.tcab.testcabinet.ai`** over the internal (VPN-only) ingress,
alongside the console and services. Because the `otel-lgtm` image ships Grafana with
**anonymous admin**, exposing that URL is paired with the overlay's
`patch-grafana-auth.yaml`, which disables anonymous access and sets admin credentials
from the `tcab-grafana-admin` Secret (synced from the `grafana-admin-user` /
`grafana-admin-password` Key Vault secrets — both must exist before the overlay
applies). To **opt out** of in-cluster telemetry, simply drop the component from an
overlay (its workloads fall back to stdout-only logging).

### Grafana Cloud

A managed Grafana stack (Tempo, Mimir, Loki) with a generous free tier that
accepts **OTLP directly** — choose it over the self-hosted stack to avoid
operating the telemetry workload. It is the same Grafana UI you use locally, so
dashboards and queries transfer. Omit the observability component and point each
service at the OTLP endpoint, passing the token as a header:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic <base64-instance-id:token>
```

Treat the header as a secret — inject it from your secret store, never commit it.

### A managed observability backend

To send to a managed backend (a cloud provider's monitor, or any OTLP-compatible
vendor), run an
[OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) that receives
OTLP from the services and exports onward — the services still speak plain OTLP,
the collector does the translation. An example collector configuration is in
[`deployments/telemetry/otel-collector.yaml`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/deployments/telemetry/otel-collector.yaml).
This is the most setup (a collector to run, as a sidecar or its own `Deployment`)
but keeps a third-party metrics backend (e.g. Azure Monitor) in the loop without
the services knowing about it.

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
