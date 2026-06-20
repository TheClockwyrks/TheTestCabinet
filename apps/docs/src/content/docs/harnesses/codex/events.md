---
title: Events
---

Codex emits its activity as `EventFormat::Codex`. It is run with
`codex exec --json`, which writes a line-delimited JSON stream on standard
output: each non-empty line is one complete JSON object. The harness layer
parses that stream and maps it onto the normalized
[harness events](/components/core/events/). A line that fails to parse as JSON
is a diagnostic printed outside the stream and is surfaced as a warning event.

## Raw event stream

Every line carries a top-level `type`. The stream has two layers: lifecycle
events describing the conversation and turn boundaries, and item events that wrap
a streamed `item` carrying its own `type`.

| Codex event | Handling |
| ----------- | -------- |
| `thread.started` | Captures `thread_id` as the session ID for later events. No event is emitted. |
| `turn.started`, `turn.completed` | Turn boundaries, consumed. `turn.completed` carries the `usage` totals used for [metrics](./metrics/). No event. |
| `item.started` | The in-progress half of an item, consumed. No event. |
| `item.completed` | Drives the normalized event, derived from the completed `item` (see [Item mapping](#item-mapping)). |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |
| any other type | Becomes an [unknown](/components/core/events/#unknown) event. |

Items are reported first as `item.started` and then as `item.completed`. The
normalized event is derived from the completed state so terminal information such
as a command's exit code is available; the started notification is not turned
into a duplicate event.

## Normalized mapping

`item.completed` events are unwrapped to their `item` and mapped by the item's
own type. An `item.completed` carrying no `item`, any unrecognized item type, and
any line that fails to parse all become unknown events so the stream stays
lossless.

## Item mapping

Completed items map to normalized events as follows:

| Codex item type | Event |
| --------------- | ----- |
| `command_execution` | [command](/components/core/events/#command), or a recognized file operation (see below) |
| `file_change` | one [write](/components/core/events/#file-write) per changed path |
| `agent_message` | [agent](/components/core/events/#agent-message) message |
| `error` | [error](/components/core/events/#harness-error) |
| any other item type | [unknown](/components/core/events/#unknown) |

Codex runs file operations through shell commands rather than dedicated tools, so
each `command_execution` is inspected before falling back to a command event.
Only the first simple command is considered, and only commands that are
confidently a file operation are reclassified:

| Command | Reclassified as |
| ------- | --------------- |
| `cat <path>` | [read](/components/core/events/#file-read) |
| `sed -n '10,20p' <path>` | [read](/components/core/events/#file-read), with start line 10 and end line 20 |
| `rg`, `grep`, `find` | [search](/components/core/events/#file-search) |
| `ls <path>` | [list](/components/core/events/#directory-list) |
| anything else | [command](/components/core/events/#command), with the item's exit code and success |

A `sed` invocation is only treated as a read when it is a `-n` print range;
anything else stays a command. Commands that are not confidently a file operation
remain command events, with the item's `exit_code` mapped to the exit code and
success fields. `file_change` writes are reported with success set to true and no
line range.

Codex exposes a single diagnostic channel through `error` items, which it uses
for both true errors and advisory notices; because Codex provides no severity
signal, all `error` items map to error events. Codex does not emit dedicated
skill, warning, or orchestration activity in this version.

---

For the normalized event types these map onto, see
[Harness Events](/components/core/events/).
