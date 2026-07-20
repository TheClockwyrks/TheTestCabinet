---
title: Telemetry
---

Kilo Code exports traces and logs natively, with telemetry **on by default** — the
presence of an endpoint is all that enables it. It has no way to accept an inbound
trace context, so its spans form **their own trace**, correlated to the run by
resource attribute rather than nested under it.

Nothing here is enabled unless the deployment already exports telemetry — see
[Observability](/development/observability/) for the `OTEL_EXPORTER_OTLP_ENDPOINT`
master switch that gates it.

## What is exported

| Signal | Exported |
| ------ | -------- |
| Traces | Yes |
| Logs | Yes |
| Metrics | **No** — Kilo Code emits none |

The missing metrics are the one real gap against the other exporting harnesses.
Token usage is still captured for a run through the normal
[metrics](./metrics/) path, which parses the CLI's output rather than relying on
OpenTelemetry.

## Configuration

A run sets these on the container before the session:

| Variable | Value |
| -------- | ----- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the collector, as a base URL |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` |
| `OTEL_SERVICE_NAME` | `tcab-harness-kilo` |
| `OTEL_RESOURCE_ATTRIBUTES` | `tcab.*` for the run |

:::note[There is no enable flag]
Telemetry is on by default; the endpoint is the only thing required. Kilo Code's
`experimental.openTelemetry` setting is a **kill switch** — you set it to `false`
to turn telemetry off — not an opt-in. A run does not set it.
:::

## Trace linking

Kilo Code documents no inbound trace-context configuration, so it starts a fresh
trace. To find the Kilo Code trace for a run, query on the resource attributes
every exporting harness carries — `tcab.harness`, `tcab.test_case`,
`tcab.variant`, and `tcab.model` — or correlate by timestamp against the run's own
spans.

## Relationship to OpenCode

Kilo Code is an OpenCode derivative: its spans use the `opencode.*` namespace and
it shares OpenCode's config conventions. A dashboard built for
[OpenCode](/harnesses/opencode/telemetry/) largely works for Kilo Code, with the
service name as the discriminator.

---

See [Observability](/development/observability/) for the collector the run exports
to and the switch that gates all of this, and [Overview](./overview/) for how
Kilo Code is installed and invoked.
