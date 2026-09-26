---
title: Telemetry
---

Kilo Code exports traces and logs natively, with telemetry on by default, so the
presence of an endpoint is all that enables it. Its spans form their own trace,
correlated to the run by resource attribute.

A run configures this only when the deployment already exports telemetry. See
[Observability](/development/observability/) for the
`OTEL_EXPORTER_OTLP_ENDPOINT` master switch that gates it.

## Exported signals

| Signal  | Exported |
| ------- | -------- |
| Traces  | Yes      |
| Logs    | Yes      |
| Metrics | No       |

Token usage is captured for a run through the
[metrics](/harnesses/kilo/metrics/) path, which parses the CLI's output rather
than relying on OpenTelemetry.

## Configuration

A run sets these standard variables on the container before the session:

| Variable                      | Value                         |
| ----------------------------- | ----------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the collector, as a base URL  |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`               |
| `OTEL_SERVICE_NAME`           | `tcab-harness-kilo`           |
| `OTEL_RESOURCE_ATTRIBUTES`    | the run's `tcab.*` attributes |

:::note[The endpoint is the only requirement]
Telemetry is on by default. Kilo Code's `experimental.openTelemetry` setting is
a kill switch, set to `false` to turn telemetry off, and a run leaves it unset.
:::

## Trace linking

Kilo Code documents no inbound trace-context configuration, so it starts a fresh
trace. Every exporting harness carries the `tcab.harness`, `tcab.test_case`,
`tcab.variant`, `tcab.model`, and `tcab.run_id` resource attributes, so the Kilo
Code trace for a run is found by querying those attributes or by correlating
timestamps against the run's own spans.

## Relationship to OpenCode

Kilo Code is an OpenCode derivative. Its spans use the `opencode.*` namespace
and it shares OpenCode's config conventions, so a dashboard built for
[OpenCode](/harnesses/opencode/telemetry/) largely works for Kilo Code, with the
service name as the discriminator.
