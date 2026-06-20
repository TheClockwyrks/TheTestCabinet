---
title: Events
---

OpenCode emits its activity as `EventFormat::Opencode`. It is run with
`opencode run --format json`, which writes a line-delimited JSON stream on
standard output: each non-empty line is one complete JSON object carrying a
top-level `type`. The harness layer parses that step stream and maps it onto the
normalized [harness events](/components/core/events/). The session id is captured
from the first `sessionID`, `session_id`, or `sessionId` field seen.

## Raw event stream

The stream is a sequence of step-oriented records. Step boundaries and reasoning
carry no agent activity and are consumed; text, tool use, and errors carry it.

| OpenCode event | Handling |
| -------------- | -------- |
| `step_start`, `step_finish` | Step boundaries, consumed. They carry the usage totals used for [metrics](./metrics/). No event. |
| `reasoning` | Model thinking, consumed. No event. |
| `text` | Becomes an [agent](/components/core/events/#agent-message) message (empty text emits nothing). |
| `tool_use` | A self-contained tool record, classified in place (see [Tool mapping](#tool-mapping)). |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |

A `tool_use` record is self-contained — it carries the tool name, input, and a
terminal status in one record, so no request/response correlation is needed. Its
status (`completed`/`success`/`done`/`ok` versus `error`/`failed`/`failure`/
`cancelled`) sets the success field on the resulting event.

## Normalized mapping

Each line is mapped by its top-level `type`. The agent text comes from a `text`
record, and each `tool_use` record is classified into one or more file-operation
events by its tool name. Any line that fails to parse as JSON, any `type` not
listed above, and any `tool_use` whose tool name is unrecognized all become
[unknown](/components/core/events/#unknown) events so the stream stays lossless.

## Tool mapping

Tool names are matched case-insensitively and classified self-contained:

| OpenCode tool | Event |
| ------------- | ----- |
| `read` | [read](/components/core/events/#file-read) |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `apply_patch` | one [write](/components/core/events/#file-write) per file named by the patch markers |
| `grep`, `glob` | [search](/components/core/events/#file-search) |
| `bash` | [command](/components/core/events/#command), or a recognized file operation |
| `skill` | [skill](/components/core/events/#skill) |
| `lsp` | [search](/components/core/events/#file-search) when it carries a query/symbol, otherwise [unknown](/components/core/events/#unknown) |
| any other tool (webfetch, websearch, todowrite, question, …) | [unknown](/components/core/events/#unknown) |

`lsp` is treated as a search only when it carries a query or symbol; a navigation
operation with none falls through to an unknown event. OpenCode does not expose
[orchestration](/components/core/events/#orchestration) activity in this version.

---

For the normalized event types these map onto, see
[Harness Events](/components/core/events/).
