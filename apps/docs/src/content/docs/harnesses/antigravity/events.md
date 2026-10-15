---
title: Events
---

Antigravity uses `EventFormat::Generic`, the harness layer's best-effort
translation for harnesses whose output stream is not modeled in detail. The
generic parser treats output as plain lines. Each line on standard output becomes
an [unknown](/components/driver/events/#unknown) event carrying the raw value,
which is the parsed JSON when the line is valid JSON and the raw text otherwise.
Each line on standard error becomes a
[warning](/components/driver/events/#warning) event, the same default applied to
standard error across every harness. The stream therefore stays lossless and a
failing run's full output survives.

## Raw event stream

| Antigravity output | Normalized                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ |
| stdout line        | [unknown](/components/driver/events/#unknown) carrying the raw JSON value, or the raw text |
| stderr line        | [warning](/components/driver/events/#warning)                                              |

The generic parser interprets none of the harness's own output, so a run records
no [agent](/components/driver/events/#agent-message),
[command](/components/driver/events/#command), or file-operation events.

See [Harness Events](/components/driver/events/) for the normalized event contract.
