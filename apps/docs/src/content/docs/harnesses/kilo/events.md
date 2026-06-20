---
title: Events
---

Kilo Code emits its activity as `EventFormat::Kilo`. It is run with
`kilo run --format json`, which writes a line-delimited JSON stream on standard
output: each non-empty line is one complete JSON object carrying a top-level
`type`. Kilo Code is built on the same OpenCode-style step stream as
[OpenCode](/components/core/events/#opencode-event-mapping), so it shares that
stream's shape; the harness layer parses it and maps it onto the normalized
[harness events](/components/core/events/). The session id is captured from a
`sessionID`, `session_id`, or `sessionId` field.

## Raw event stream

Each line is handled by its top-level `type`:

| Kilo event | Handling |
| ---------- | -------- |
| `step_start`, `step_finish` | Step boundaries, consumed. `step_finish` carries the usage totals used for [metrics](./metrics/). No event. |
| `reasoning` | Model thinking. Becomes a [reasoning](/components/core/events/#reasoning) event when it carries text, otherwise consumed. |
| `text` | The assistant's plain text becomes an [agent](/components/core/events/#agent-message) message. An empty text emits no event. |
| `tool_use` | A self-contained tool call, classified in place (see [Tool mapping](#tool-mapping)). |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |

A `tool_use` event is self-contained — it carries the tool name, input, and a
terminal status in one event, so no request/response correlation is needed — and
its status sets the success field.

## Normalized mapping

| Raw event | Normalized event |
| --------- | ---------------- |
| `step_start`, `step_finish` | none (consumed) |
| `reasoning` | [reasoning](/components/core/events/#reasoning) message when it carries text, otherwise none |
| `text` | [agent](/components/core/events/#agent-message) message |
| `tool_use` | the event its tool classifies to (see [Tool mapping](#tool-mapping)) |
| `error` | [error](/components/core/events/#harness-error) |
| any other type | [unknown](/components/core/events/#unknown) |

A line that fails to parse as JSON, any unrecognized event type, and a
`tool_use` whose tool is not recognized all become unknown events so the stream
stays lossless.

## Tool mapping

Kilo Code extends the OpenCode tool set with workflow and semantic-search tools;
tool names are matched case-insensitively:

| Kilo tool | Event |
| --------- | ----- |
| `task`, `agent_manager` | [orchestration](/components/core/events/#orchestration) when the spawned agent/session is identified, otherwise [unknown](/components/core/events/#unknown) |
| `codesearch` | [search](/components/core/events/#file-search) |
| `todowrite`, `todoread` | consumed — internal task list, no event |
| `read` | [read](/components/core/events/#file-read) |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `apply_patch` | one [write](/components/core/events/#file-write) per file named by the patch markers |
| `grep`, `glob` | [search](/components/core/events/#file-search) |
| `bash` | [command](/components/core/events/#command), or a recognized file operation |
| `skill` | [skill](/components/core/events/#skill) |
| `lsp` | [search](/components/core/events/#file-search) when it carries a query/symbol, otherwise [unknown](/components/core/events/#unknown) |
| any other tool | [unknown](/components/core/events/#unknown) |

A `task` or `agent_manager` call only becomes an orchestration event when the
spawned agent or session can be identified from the input; otherwise it falls
through to an unknown event rather than guessing. Any other tool delegates to the
[OpenCode tool mapping](/components/core/events/#opencode-event-mapping).

---

For the normalized event types these map onto, see
[Harness Events](/components/core/events/).
