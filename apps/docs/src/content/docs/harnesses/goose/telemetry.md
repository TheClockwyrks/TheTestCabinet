---
title: Telemetry
---

Goose is a Rust CLI built on `opentelemetry-rust`, so it reads the standard
`OTEL_*` environment directly and needs no plugin. It accepts no inbound trace
context, so its spans form their own trace, correlated to the run by resource
attribute.

Everything here is gated on the deployment exporting telemetry. See
[Observability](/development/observability/) for the
`OTEL_EXPORTER_OTLP_ENDPOINT` master switch.

## Exported signals

| Signal | Exported | Notes |
| ------ | -------- | ----- |
| Traces | Yes | LLM calls, tool executions, and agent decisions. |
| Metrics | Yes | |
| Logs | Yes | |

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
| `OTEL_RESOURCE_ATTRIBUTES` | the run's `tcab.*` attributes |

Setting the endpoint is what turns export on; Goose has no separate enable
switch. `OTEL_SDK_DISABLED=true` is the kill switch Goose documents.

Goose also reads `otel_exporter_otlp_endpoint` and `otel_exporter_otlp_timeout`
from `~/.config/goose/config.yaml`. A run uses the environment instead, which
overrides the file and needs no file written into the container.

## Trace linking

Goose starts a fresh trace for its spans. Every exporting harness carries the
`tcab.run_id`, `tcab.harness`, `tcab.test_case`, `tcab.variant`, and
`tcab.model` resource attributes, so the Goose trace for a run is found by
querying those attributes or by correlating timestamps against the run's own
spans.
