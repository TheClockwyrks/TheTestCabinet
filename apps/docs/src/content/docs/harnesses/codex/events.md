---
title: Events
---

Codex is run with `codex exec --json`, which writes a line-delimited JSON stream
on standard output. Each non-empty line is one complete JSON object carrying a
top-level `type`. The harness layer parses that stream into the normalized
[harness events](/components/core/events/) every caller consumes.

The stream has two layers: lifecycle events describing the conversation and turn
boundaries, and item events that wrap a streamed `item` carrying its own `type`.

## Raw event stream

| Codex event | Handling |
| ----------- | -------- |
| `thread.started` | Captures `thread_id` as the session ID for later events. No event. |
| `turn.started`, `turn.completed` | Turn boundaries, consumed. `turn.completed` carries the `usage` totals used for [metrics](/harnesses/codex/metrics/). No event. |
| `item.started` | The in-progress half of an item, consumed. No event. |
| `item.completed` | Drives the normalized event, derived from the completed `item`. |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |

Items are reported first as `item.started` and then as `item.completed`. The
normalized event is derived from the completed state so terminal information
such as a command's exit code is available.

A line that fails to parse as JSON is a diagnostic printed outside the stream
and is surfaced as a warning event. Output on standard error is surfaced as a
warning as well.

## Normalized mapping

An `item.completed` event is unwrapped to its `item` and mapped by the item's
own type:

| Codex item type | Normalized event |
| --------------- | ---------------- |
| `command_execution` | [command](/components/core/events/#command), or a recognized file operation |
| `file_change` | one [write](/components/core/events/#file-write) per changed path |
| `agent_message` | [agent](/components/core/events/#agent-message) message |
| `error` | [error](/components/core/events/#harness-error) |
| any other item type | [unknown](/components/core/events/#unknown) |

An `item.completed` carrying no `item`, an unrecognized item type, and a line
that fails to parse all become unknown events, so the stream stays lossless.
`file_change` writes are reported with success set to true and no line range.

Codex exposes a single diagnostic channel through `error` items, which it uses
for both errors and advisory notices, and it provides no severity signal, so
every `error` item maps to an error event. Codex has no skill, warning, or
[orchestration](/components/core/events/#orchestration) source.

## Tool mapping

Codex runs file operations through shell commands rather than dedicated tools,
so each `command_execution` is inspected before falling back to a command event.
Only the first simple command is considered, and only commands that are
confidently a file operation are reclassified:

| Command | Reclassified as |
| ------- | --------------- |
| `cat <path>` | [read](/components/core/events/#file-read) |
| `sed -n '10,20p' <path>` | [read](/components/core/events/#file-read), with start line 10 and end line 20 |
| `rg`, `grep`, `find` | [search](/components/core/events/#file-search) |
| `ls <path>` | [list](/components/core/events/#directory-list) |
| anything else | [command](/components/core/events/#command), with the item's exit code and success |

A `sed` invocation is treated as a read when it is a `-n` print range. Every
other command stays a command event, with the item's `exit_code` mapped to the
exit code and success fields.
