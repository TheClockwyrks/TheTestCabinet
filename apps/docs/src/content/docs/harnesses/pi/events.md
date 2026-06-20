---
title: Events
---

Pi emits its activity as `EventFormat::Pi`. It is run with
`pi --mode json --print`, which writes a line-delimited JSON stream on standard
output: each non-empty line is one complete JSON object carrying a top-level
`type`. The harness layer parses that stream and maps it onto the normalized
[harness events](/components/core/events/).

## Raw event stream

The stream is a mix of lifecycle markers and two activity-bearing records. The
session id is captured from the `session` record (its `id`). Lifecycle markers
and the partial `message_update` deltas carry no agent activity; `turn_end` is
consumed for [usage](./metrics/). Only `message_end` and `tool_execution_end`
produce normalized events.

| Pi event | Handling |
| -------- | -------- |
| `session` | Captures the session `id` (also tried as `sessionId`/`session_id`). No event. |
| `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update` | Lifecycle markers and partial deltas, consumed. No event. |
| `message_end` | A completed message; an `assistant`-role message becomes an [agent](/components/core/events/#agent-message) message (see [Normalized mapping](#normalized-mapping)). |
| `tool_execution_end` | A completed tool execution, mapped by tool name (see [Tool mapping](#tool-mapping)). |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |

## Normalized mapping

A `message_end` record whose message role is `assistant` becomes an agent
message; its content is read as either a string or an array of text parts. A
non-assistant message — such as the echoed user prompt — is lifecycle noise and
emits no event, as does an assistant message with empty text.

A `tool_execution_end` record is self-contained: it carries a tool name
(`toolName`, also tried as `tool_name`/`tool`/`name`), structured input
(`input`, also tried as `arguments`/`args`/`toolInput`), and a terminal status.
Its `status`/`state` field — or a non-null `error` field — sets the success
field. A record whose tool name is unrecognized, and any line that fails to
parse, become unknown events so the stream stays lossless.

## Tool mapping

Tool names are matched case-insensitively:

| Pi tool | Event |
| ------- | ----- |
| `read` | [read](/components/core/events/#file-read) |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `search`, `grep`, `glob` | [search](/components/core/events/#file-search) |
| `list` | [list](/components/core/events/#directory-list) |
| `bash`, `shell` | [command](/components/core/events/#command), or a recognized file operation |
| any other tool | [unknown](/components/core/events/#unknown) |

Pi does not emit a dedicated [skill](/components/core/events/#skill),
[warning](/components/core/events/#warning), or
[orchestration](/components/core/events/#orchestration) source in this version.

---

For the normalized event types these map onto, see
[Harness Events](/components/core/events/).
