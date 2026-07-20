---
title: Telemetry
---

Claude Code has the most complete OpenTelemetry support of any harness: all three
signals, built into the CLI itself, and it is the only harness that reads the
standard `TRACEPARENT`. A run's Claude Code session therefore appears **inside the
run's own trace**, nested under the harness invocation span.

Nothing here is enabled unless the deployment already exports telemetry — see
[Observability](/development/observability/) for the `OTEL_EXPORTER_OTLP_ENDPOINT`
master switch that gates it.

## What is exported

| Signal | Exported | Notes |
| ------ | -------- | ----- |
| Traces | Yes | Spans named `claude_code.interaction`, `claude_code.llm_request`, `claude_code.tool`, `claude_code.hook`. Beta — span names and attributes may change between Claude Code releases. |
| Metrics | Yes | Token counts, cost, and session counters. |
| Logs | Yes | Structured session events. |

## Configuration

A run sets these on the container before the session:

| Variable | Value | Why |
| -------- | ----- | --- |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | The master switch. Nothing is exported without it. |
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` | `1` | Gates **traces** specifically. Without it only metrics and logs are emitted. |
| `OTEL_TRACES_EXPORTER` | `otlp` | Each signal needs its exporter named; unset means that signal is off. |
| `OTEL_METRICS_EXPORTER` | `otlp` | |
| `OTEL_LOGS_EXPORTER` | `otlp` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the collector | Rewritten to be reachable from inside the container. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | |
| `OTEL_SERVICE_NAME` | `tcab-harness-claude` | |
| `OTEL_RESOURCE_ATTRIBUTES` | `tcab.*` for the run | Correlates the session to the run. |
| `OTEL_TRACES_EXPORT_INTERVAL` | `1000` | |
| `OTEL_METRIC_EXPORT_INTERVAL` | `1000` | |
| `OTEL_LOGS_EXPORT_INTERVAL` | `1000` | |
| `TRACEPARENT` | the run's trace context | Joins the run's trace. Omitted when no trace is in scope. |

The three export intervals are deliberately shortened from their multi-second
defaults. A harness session is short-lived, and the default batching drops the
tail of a session when the process exits before the next flush.

:::note[Two switches, not one]
`CLAUDE_CODE_ENABLE_TELEMETRY` alone yields metrics and logs but **no traces**.
If a run shows Claude Code metrics without spans, the beta switch is the thing to
check.
:::

## Trace linking

Claude Code reads `TRACEPARENT` from its environment at session start — but only
in `claude -p` and Agent SDK sessions. Interactive sessions ignore it. A run
always invokes `claude --print`, so linking always applies here.

Note that the trace context carries the sampling decision. When a run's trace is
not sampled, Claude Code correctly suppresses its own export too.

`CLAUDE_CODE_PROPAGATE_TRACEPARENT` is a different, *outbound* setting — it
propagates context to API proxies — and is not what makes a session join the run's
trace. A run does not set it.

## What is not exported

Claude Code does not pass `OTEL_*` to its own subprocesses (the Bash tool, hooks,
MCP servers), so work it delegates does not appear as further spans. It does pass
`TRACEPARENT` to Bash subprocesses when tracing is active, so an instrumented tool
invoked by the model would still slot into the trace.

---

See [Observability](/development/observability/) for the collector the run exports
to and the switch that gates all of this, and
[Authentication](./authentication/) for the separate credential path.
