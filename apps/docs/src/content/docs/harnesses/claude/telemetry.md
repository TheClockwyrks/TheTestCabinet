---
title: Telemetry
---

Claude Code exports all three OpenTelemetry signals from the CLI itself, and it
reads the standard `TRACEPARENT`. A run's Claude Code session therefore appears
inside the run's own trace, nested under the harness invocation span.

Everything here is gated on the deployment exporting telemetry. See
[Observability](/development/observability/) for the
`OTEL_EXPORTER_OTLP_ENDPOINT` master switch.

## Exported signals

| Signal | Exported | Notes |
| ------ | -------- | ----- |
| Traces | Yes | Spans named `claude_code.interaction`, `claude_code.llm_request`, `claude_code.tool`, `claude_code.hook`. Span names and attributes are beta and may change between Claude Code releases. |
| Metrics | Yes | Token counts, cost, and session counters. |
| Logs | Yes | Structured session events. |

## Configuration

A run sets these on the container before the session:

| Variable | Value | Purpose |
| -------- | ----- | ------- |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | The master switch. Nothing is exported without it. |
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` | `1` | Gates traces. With this unset, only metrics and logs are emitted. |
| `OTEL_TRACES_EXPORTER` | `otlp` | Each signal needs its exporter named. |
| `OTEL_METRICS_EXPORTER` | `otlp` | |
| `OTEL_LOGS_EXPORTER` | `otlp` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the collector | Rewritten to be reachable from inside the container. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | |
| `OTEL_SERVICE_NAME` | `tcab-harness-claude` | |
| `OTEL_RESOURCE_ATTRIBUTES` | the run's `tcab.*` attributes | Correlates the session to the run. |
| `OTEL_TRACES_EXPORT_INTERVAL` | `1000` | |
| `OTEL_METRIC_EXPORT_INTERVAL` | `1000` | |
| `OTEL_LOGS_EXPORT_INTERVAL` | `1000` | |
| `TRACEPARENT` | the run's trace context | Joins the run's trace. Set only when a trace is in scope. |

Both Claude Code switches are required. `CLAUDE_CODE_ENABLE_TELEMETRY` alone
yields metrics and logs, and the beta switch is what adds traces.

The three export intervals are shortened from their multi-second defaults. A
harness session is short-lived, and the default batching drops the tail of a
session when the process exits before the next flush.

## Trace linking

Claude Code reads `TRACEPARENT` from its environment at session start in
`claude -p` and Agent SDK sessions. A run always invokes `claude --print`, so
linking always applies.

The trace context carries the sampling decision, so a run whose trace is not
sampled suppresses Claude Code's export too. `TRACEPARENT` is also passed to
Bash subprocesses while tracing is active, so an instrumented tool the model
invokes slots into the same trace.
