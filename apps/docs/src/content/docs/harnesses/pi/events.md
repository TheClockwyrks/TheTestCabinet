---
title: Events
---

Pi emits its activity as `EventFormat::Pi`. It is run with
`pi --mode json --print`, which writes a line-delimited JSON stream on standard
output: each non-empty line is one complete JSON object carrying a top-level
`type`. The harness layer parses that stream and maps it onto the normalized
[harness events](/components/core/events/).

## Raw event stream

The stream is a mix of lifecycle markers, completed assistant messages, and tool
executions. The session id is captured from the `session` record (its `id`).
Lifecycle markers and the partial `message_update` deltas carry no agent
activity; `turn_end` is consumed for [usage](./metrics/). A tool execution is
reported across three records — `tool_execution_start`, `tool_execution_update`,
and `tool_execution_end` — and is reconstructed by pairing the start (which
carries the arguments) with the end (which carries the result).

| Pi event | Handling |
| -------- | -------- |
| `session` | Captures the session `id` (also tried as `sessionId`/`session_id`). No event. |
| `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update` | Lifecycle markers and partial deltas, consumed. No event. |
| `message_end` | A completed message; an `assistant`-role message becomes an [agent](/components/core/events/#agent-message) message (and a [reasoning](/components/core/events/#reasoning) event for any thinking parts; see [Normalized mapping](#normalized-mapping)). |
| `tool_execution_start` | Records the tool's `toolCallId`, `toolName`, and `args` for later resolution. No event. |
| `tool_execution_update` | A streaming partial of an in-progress execution, consumed. No event. |
| `tool_execution_end` | Resolves the recorded start by `toolCallId` and maps it by tool name (see [Tool mapping](#tool-mapping)). |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |

## Normalized mapping

A `message_end` record whose message role is `assistant` becomes an agent
message; its content is read as either a string or an array of typed parts, whose
`text` parts form the message. Its `thinking` parts form a
[reasoning](/components/core/events/#reasoning) event emitted ahead of the agent
message. A non-assistant message — such as the echoed user prompt — is lifecycle
noise and emits no event, as does an assistant message with neither text nor
thinking.

A tool execution is split across events: `tool_execution_start` carries the tool
name (`toolName`, also tried as `tool_name`/`tool`/`name`) and its arguments
(`args`, also tried as `input`/`arguments`/`toolInput`), while
`tool_execution_end` carries only the result. The start is recorded and the end
resolves it, pairing the two by `toolCallId` so the operation the agent requested
is classified with its observed outcome. Success is read from the end's `isError`
boolean (a present result with no error counts as success), falling back to an
`error`/`status` field. An end with no recorded start, a record whose tool name
is unrecognized, and any line that fails to parse all become unknown events so
the stream stays lossless.

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
