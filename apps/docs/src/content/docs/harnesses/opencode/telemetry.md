---
title: Telemetry
---

OpenCode exports OpenTelemetry through a plugin that a run registers. With the
plugin in place OpenCode exports all three signals and accepts an inbound trace
context, so its spans join the run's own trace.

A run configures this only when the deployment already exports telemetry. See
[Observability](/development/observability/) for the
`OTEL_EXPORTER_OTLP_ENDPOINT` master switch that gates it.

## The plugin

Instrumentation comes from
[`@devtheops/opencode-plugin-otel`](https://github.com/DEVtheOPS/opencode-plugin-otel).
OpenCode resolves a plugin named in its config from npm when it starts, so a run
only writes the config file and needs no install step.

A run writes `/home/node/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@devtheops/opencode-plugin-otel"]
}
```

## Exported signals

| Signal  | Exported |
| ------- | -------- |
| Traces  | Yes      |
| Metrics | Yes      |
| Logs    | Yes      |

## Configuration

Everything the plugin reads is vendor-prefixed, so a run sets these variables
rather than the standard `OTEL_*` ones:

| Variable                    | Value                   | Purpose                                                                                                      |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OPENCODE_ENABLE_TELEMETRY` | `1`                     | The master switch.                                                                                           |
| `OPENCODE_OTLP_ENDPOINT`    | the collector           | A base URL, with the scheme included. The plugin appends `/v1/traces`, `/v1/metrics`, and `/v1/logs` itself. |
| `OPENCODE_OTLP_PROTOCOL`    | `http/protobuf`         | The run's OTLP protocol, set explicitly because the plugin defaults to gRPC on `:4317`.                      |
| `OPENCODE_TRACEPARENT`      | the run's trace context | Joins the run's trace. Set only when a trace is in scope.                                                    |

## Trace linking

The plugin reads the trace context from `OPENCODE_TRACEPARENT` rather than the
standard `TRACEPARENT`, so a run passes it under the vendor name.

The context carries the sampling decision and the plugin's default sampler is
parent-based, so a run whose trace is unsampled suppresses OpenCode's export of
all three signals.

## Caveats

The plugin is third-party and is not covered by OpenCode's own release testing.
Export failure never fails a run, so a breaking OpenCode change disables
telemetry silently. When OpenCode runs stop producing spans while other
harnesses continue, suspect the plugin before the collector.
