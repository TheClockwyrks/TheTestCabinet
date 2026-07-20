---
title: Telemetry
---

Goose is a Rust CLI built on `opentelemetry-rust`, so it reads the standard
`OTEL_*` environment directly and needs no plugin. It has no way to accept an
inbound trace context, so its spans form **their own trace**, correlated to the
run by resource attribute rather than nested under it.

Nothing here is enabled unless the deployment already exports telemetry — see
[Observability](/development/observability/) for the `OTEL_EXPORTER_OTLP_ENDPOINT`
master switch that gates it.

## What is exported

| Signal | Exported |
| ------ | -------- |
| Traces | Yes — LLM calls, tool executions, and agent decisions |
| Metrics | Yes |
| Logs | Yes |

Goose's documentation does not enumerate the signals precisely; the exporters for
all three are configurable and a run sets all three.

## Configuration

A run sets these on the container before the session:

| Variable | Value |
| -------- | ----- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the collector, as a base URL |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` |
| `OTEL_TRACES_EXPORTER` | `otlp` |
| `OTEL_METRICS_EXPORTER` | `otlp` |
| `OTEL_LOGS_EXPORTER` | `otlp` |
| `OTEL_SERVICE_NAME` | `tcab-harness-goose` |
| `OTEL_RESOURCE_ATTRIBUTES` | `tcab.*` for the run |

There is no separate enable switch: setting the endpoint is what turns export on.
The only kill switch Goose documents is `OTEL_SDK_DISABLED=true`.

Goose can also be configured from `~/.config/goose/config.yaml`, via
`otel_exporter_otlp_endpoint` and `otel_exporter_otlp_timeout`. A run uses the
environment instead, since it overrides the file and needs no file to be written.

## Trace linking

Goose documents no inbound trace-context configuration. Standard OpenTelemetry
SDKs do not read `TRACEPARENT` from the process environment — that is a
convention some tools implement, not part of the W3C specification, which
concerns HTTP headers — so absent explicit support Goose starts a fresh trace.

To find the Goose trace for a run, query on the resource attributes every
exporting harness carries — `tcab.harness`, `tcab.test_case`, `tcab.variant`, and
`tcab.model` — or correlate by timestamp against the run's own spans.

---

See [Observability](/development/observability/) for the collector the run exports
to and the switch that gates all of this, and [Overview](./overview/) for how
Goose is installed and invoked.
