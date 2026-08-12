---
title: Telemetry
---

Codex exports traces and logs natively. It is configured entirely from its
`config.toml` and reads no `OTEL_*` environment variable. It accepts no inbound
trace context, so its spans form their own trace, correlated to the run by
resource attribute.

Everything here is gated on the deployment exporting telemetry. See
[Observability](/development/observability/) for the
`OTEL_EXPORTER_OTLP_ENDPOINT` master switch.

## Exported signals

| Signal | Exported | Notes |
| ------ | -------- | ----- |
| Traces | Yes | |
| Logs | Yes | Codex calls these "events". |
| Metrics | Configured | `codex exec`, the invocation a run uses, emits no metrics even with the exporter set. The exporter is still written explicitly. |

## Configuration

A run writes `~/.codex/config.toml`, alongside the `auth.json` that
[subscription authentication](/harnesses/codex/authentication/) uses:

```toml
# `<url>` is the collector base URL, e.g. http://collector:4318.
[otel]
environment = "local"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "<url>/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "<url>/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "<url>/v1/metrics", protocol = "binary" } }
```

Two things differ from the OpenTelemetry conventions used elsewhere. Each
exporter takes the complete `/v1/<signal>` endpoint rather than a base URL, and
the protocol is spelled `binary` or `json` rather than `http/protobuf` or
`http/json`. A run maps the deployment's protocol onto Codex's spelling.

`environment` is taken from `TCAB_ENV`, matching the
`deployment.environment.name` the rest of the system reports under.
`log_user_prompt` is left at its default `false`, which keeps a run's prompt out
of telemetry.

`metrics_exporter` must be written explicitly. Its default is `statsig`, which
ships a run's metrics to that vendor rather than to the configured collector.

## Trace linking

Codex starts a fresh trace for its spans. Every exporting harness carries the
`tcab.run_id`, `tcab.harness`, `tcab.test_case`, `tcab.variant`, and
`tcab.model` resource attributes, so the Codex trace for a run is found by
querying those attributes or by correlating timestamps against the run's own
spans.
