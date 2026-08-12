---
title: Events
---

Pi emits its activity as `EventFormat::Pi`. It runs as `pi --mode json --print`,
which writes a line-delimited JSON stream on standard output where each
non-empty line is one complete JSON object carrying a top-level `type`. The
harness layer parses that stream and maps it onto the normalized
[harness events](/components/core/events/).

## Raw event stream

The stream mixes lifecycle markers, completed assistant messages, and tool
executions. The session id is captured from the `session` record. A tool
execution is reported across `tool_execution_start`, `tool_execution_update`,
and `tool_execution_end`, and is reconstructed by pairing the start, which
carries the arguments, with the end, which carries the result.

| Pi event | Handling |
| -------- | -------- |
| `session` | Captures the session `id` (also tried as `sessionId`/`session_id`). No event. |
| `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `tool_execution_update` | Lifecycle markers and partial deltas. No event. |
| `message_end` | A completed message. An `assistant`-role message becomes an [agent](/components/core/events/#agent-message) message, and the record's `message.usage` becomes a [usage](/components/core/events/#usage) event. |
| `tool_execution_start` | Records the tool's `toolCallId`, name, and arguments for later resolution, and counts the invocation in the run's tool tally. No event. |
| `tool_execution_end` | Resolves the recorded start by `toolCallId` and maps it by tool name. |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |
| a line that is not JSON | Becomes a [warning](/components/core/events/#warning) event. |

## Assistant messages

A `message_end` record whose message role is `assistant` becomes an agent
message. Its content is read as either a string or an array of typed parts,
whose `text` parts form the message. Its `thinking` parts form a
[reasoning](/components/core/events/#reasoning) event emitted ahead of the agent
message. A non-assistant message emits no event, as does an assistant message
carrying neither text nor thinking.

## Tool executions

`tool_execution_start` carries the tool name (`toolName`, also tried as
`tool_name`/`tool`/`name`) and its arguments (`args`, also tried as
`input`/`arguments`/`toolInput`). `tool_execution_end` carries only the result,
so the two are paired by `toolCallId` and the operation the agent requested is
classified with its observed outcome.

Success is read from the end record's `isError` boolean, then from a non-null
`error` field, then from the presence of a `result`, and finally from a
`status`/`state` string. An end with no recorded start, and a record whose tool
name is unrecognized, become unknown events so the stream stays lossless.

Tool names are matched case-insensitively:

| Pi tool | Event |
| ------- | ----- |
| `read` | [read](/components/core/events/#file-read) |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `search`, `grep`, `glob` | [search](/components/core/events/#file-search) |
| `list` | [list](/components/core/events/#directory-list) |
| `bash`, `shell` | [command](/components/core/events/#command), or a file operation when the command line is recognizably one |
| any other tool | [unknown](/components/core/events/#unknown) |
