---
title: Telemetry
---

OpenCode has no native OpenTelemetry support, so a run adds it with a plugin.
With the plugin in place OpenCode exports all three signals and — uniquely among
the plugin-based harnesses — accepts an inbound trace context, so its spans join
**the run's own trace**.

Nothing here is enabled unless the deployment already exports telemetry — see
[Observability](/development/observability/) for the `OTEL_EXPORTER_OTLP_ENDPOINT`
master switch that gates it.

## The plugin

Instrumentation comes from
[`@devtheops/opencode-plugin-otel`](https://github.com/DEVtheOPS/opencode-plugin-otel).
There is no install step: OpenCode resolves a plugin named in its config from npm
when it starts, so a run only writes the config file. The run container already
has registry access for the harness install itself.

A run writes `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@devtheops/opencode-plugin-otel"]
}
```

## What is exported

| Signal | Exported |
| ------ | -------- |
| Traces | Yes |
| Metrics | Yes |
| Logs | Yes |

## Configuration

Everything the plugin reads is vendor-prefixed; it ignores the standard `OTEL_*`
variables entirely.

| Variable | Value | Why |
| -------- | ----- | --- |
| `OPENCODE_ENABLE_TELEMETRY` | `1` | The master switch. |
| `OPENCODE_OTLP_ENDPOINT` | the collector | Base URL only — the plugin appends `/v1/traces`, `/v1/metrics`, and `/v1/logs` itself. A scheme-less value is rejected. |
| `OPENCODE_OTLP_PROTOCOL` | `http/protobuf` | The plugin defaults to gRPC on `:4317`, so the protocol must be set explicitly for an HTTP collector. |
| `OPENCODE_TRACEPARENT` | the run's trace context | Joins the run's trace. Omitted when no trace is in scope. |

## Trace linking

The plugin reads the trace context from `OPENCODE_TRACEPARENT`, **not** from the
standard `TRACEPARENT`. A run sets the vendor variable for exactly this reason;
setting only the standard one would leave OpenCode's spans in a detached trace.

The context carries the sampling decision, and the plugin's default sampler is
parent-based. When a run's trace is not sampled, OpenCode correctly suppresses its
own export — including its metrics and logs.

## Caveats

The plugin is third-party. It is actively maintained, but it is not covered by
OpenCode's own release testing, so a breaking OpenCode change can disable
telemetry without failing the run — export failure is never fatal. If OpenCode
runs stop producing spans while other harnesses continue, suspect the plugin
before the collector.

Kilo Code is an OpenCode derivative and emits spans in the same `opencode.*`
namespace, so a dashboard built for one largely works for the other. See
[Kilo Code → Telemetry](/harnesses/kilo/telemetry/).

---

See [Observability](/development/observability/) for the collector the run exports
to and the switch that gates all of this, and [Overview](./overview/) for how
OpenCode is installed and invoked.
