---
title: Telemetry
---

Codex exports traces and logs natively. It is configured entirely from its
`config.toml` — it reads no `OTEL_*` environment variable — and it has no way to
accept an inbound trace context, so its spans form **their own trace**, correlated
to the run by resource attribute rather than nested under it.

Nothing here is enabled unless the deployment already exports telemetry — see
[Observability](/development/observability/) for the `OTEL_EXPORTER_OTLP_ENDPOINT`
master switch that gates it.

## What is exported

| Signal | Exported | Notes |
| ------ | -------- | ----- |
| Traces | Yes | |
| Logs | Yes | Codex calls these "events". |
| Metrics | Configured, but not emitted | `codex exec` — the invocation a run uses — is known not to emit metrics even when the exporter is set. The exporter is still configured explicitly; see the warning below. |

## Configuration

A run writes `~/.codex/config.toml`, alongside the `auth.json` that
[subscription authentication](./authentication/) uses:

```toml
[otel]
environment = "local"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://collector:4318/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "http://collector:4318/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "http://collector:4318/v1/metrics", protocol = "binary" } }
```

Two things differ from the OpenTelemetry conventions used elsewhere:

- **Full signal paths, not a base URL.** Each exporter takes the complete
  `/v1/<signal>` endpoint.
- **`binary` and `json`, not `http/protobuf` and `http/json`.** A run maps the
  deployment's protocol onto Codex's spelling.

`environment` is taken from `TCAB_ENV`, matching the `deployment.environment.name`
the rest of the system reports under.

:::caution[`metrics_exporter` must be set explicitly]
Its default is **`statsig`**, not `none` — leaving it unset ships a run's metrics
to the vendor rather than to the configured collector. A run always writes it
explicitly for that reason, even though `codex exec` does not currently emit
metrics anyway.
:::

`log_user_prompt` is left at its default `false`, so a run's prompt is never
copied into telemetry.

## Trace linking

Codex documents no inbound trace-context configuration, and ignores
`TRACEPARENT`. Its spans therefore start a fresh trace rather than joining the
run's.

To find the Codex trace for a run, query on the resource attributes every
exporting harness carries — `tcab.harness`, `tcab.test_case`, `tcab.variant`, and
`tcab.model` — or correlate by timestamp against the run's own spans.

## Caveats

`codex mcp-server` emits no telemetry at all. That does not affect a run, which
invokes `codex exec`, but it is worth knowing if you instrument Codex elsewhere.

---

See [Observability](/development/observability/) for the collector the run exports
to and the switch that gates all of this, and
[Authentication](./authentication/) for the other file a run writes into
`~/.codex/`.
