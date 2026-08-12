---
title: Events
---

Antigravity uses `EventFormat::Generic`, the harness layer's best-effort
translation for harnesses whose output stream is not modeled in detail. The
generic parser treats output as plain lines. Each line on standard output becomes
an [unknown](/components/core/events/#unknown) event carrying the raw value,
which is the parsed JSON when the line is valid JSON and the raw text otherwise.
Each line on standard error becomes a
[warning](/components/core/events/#warning) event, the same default applied to
standard error across every harness. The stream therefore stays lossless and a
failing run's full output survives.

## Raw event stream

| Antigravity output | Normalized |
| ------------------ | ---------- |
| stdout line | [unknown](/components/core/events/#unknown) carrying the raw JSON value, or the raw text |
| stderr line | [warning](/components/core/events/#warning) |

The generic parser interprets none of the harness's own output, so a run records
no [agent](/components/core/events/#agent-message),
[command](/components/core/events/#command), or file-operation events.

See [Harness Events](/components/core/events/) for the normalized event contract.
