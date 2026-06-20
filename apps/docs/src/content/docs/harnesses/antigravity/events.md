---
title: Events
---

Antigravity uses `EventFormat::Generic`, the harness layer's **best-effort
fallback** for harnesses whose output stream is not modeled in detail. Rather
than parsing a structured event format, the generic parser treats output as
plain lines: each line written to standard output becomes an
[unknown](/components/core/events/#unknown) event carrying the raw value — the
parsed JSON when the line is valid JSON, otherwise the raw text — and each line
written to standard error becomes a
[warning](/components/core/events/#warning) event. This is the same default
applied to standard error across every harness, and it keeps the stream lossless
so a failing run's full output survives.

## Raw event stream

| Antigravity output | Normalized |
| ------------------ | ---------- |
| stdout line | [unknown](/components/core/events/#unknown) carrying the raw JSON value, or the raw text |
| stderr line | [warning](/components/core/events/#warning) |

There is **no detailed per-event mapping** for Antigravity. No
[agent](/components/core/events/#agent-message),
[command](/components/core/events/#command), file-operation, or
[skill](/components/core/events/#skill) events are produced, because the generic
parser does not interpret the harness's output. A structured mapping could be
added later — without changing the event contract — once a real output stream can
be captured. Antigravity runs under [subscription
authentication](./authentication/) only, so capturing one means first signing in
with its `agy` CLI (see the [overview](./)).

See [Harness Events](/components/core/events/) for the normalized event contract.
