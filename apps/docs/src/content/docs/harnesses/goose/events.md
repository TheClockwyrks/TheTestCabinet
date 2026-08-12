---
title: Events
---

Goose is run with `goose run --output-format stream-json`, which emits a
line-delimited JSON stream on standard output. Each non-empty line is a complete
JSON object carrying a top-level `type`. The harness layer parses that stream
into the normalized [harness events](/components/core/events/) every caller
consumes.

## Raw event stream

The stream is made up of four record types:

| Goose record | Handling |
| ------------ | -------- |
| `message` | A serialized conversation message whose `content` is an array of blocks (`text`, `thinking`, `redactedThinking`, `toolRequest`, `toolResponse`) processed in order. |
| `notification` | Surfaced verbatim as an [unknown](/components/core/events/#unknown) event rather than parsed from prose. |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |
| `complete` | The run boundary. It carries the usage consumed for [metrics](/harnesses/goose/metrics/) and flushes any pending assistant span. |

Within a `message`, assistant `text` blocks are agent progress and assistant
`thinking` blocks are the model's reasoning. User text is the echoed prompt, and
`redactedThinking` blocks carry no readable text.

Goose streams each fragment as cumulative-or-delta records sharing a message
`id`, so fragments of the same kind and id accumulate into one pending span. A
record that restates the pending text replaces it, and any other same-kind,
same-id record is appended. A pending span is flushed when activity of a
different kind or id follows, or when the run completes, so a message's
[reasoning](/components/core/events/#reasoning) is reported just ahead of its
[agent](/components/core/events/#agent-message) message.

A line that fails to parse as JSON is surfaced as a warning event, as is output
on standard error.

## Normalized mapping

| Raw | Normalized |
| --- | ---------- |
| assistant `text` block | [agent](/components/core/events/#agent-message), accumulated across same-id fragments and then flushed |
| assistant `thinking` block | [reasoning](/components/core/events/#reasoning), accumulated across same-id fragments and then flushed |
| user `text`, `redactedThinking` | consumed |
| `toolRequest` with its matching `toolResponse` | the tool's event, or unknown |
| `complete` | consumed for usage, flushing pending text |
| `error` | [error](/components/core/events/#harness-error) |
| `notification` | [unknown](/components/core/events/#unknown) |
| unrecognized record or block type | [unknown](/components/core/events/#unknown) |

The harness layer captures no session id from Goose's stream, so harness events
from a Goose run carry none.

## Tool mapping

A `toolRequest` block is recorded against its call id and resolved when the
matching `toolResponse` arrives. The response's `toolResult.status` (`success`
or `error`) sets the event's success field. A `toolRequest` that cannot be
parsed becomes an unknown event.

Goose and MCP servers prefix tool names with an extension id such as
`developer__shell`. The name is split on `__` and the extension prefix stripped
before classification. Tools from the `todo` extension are consumed as internal
session state. The remaining base names map as follows:

| Goose tool | Normalized event |
| ---------- | ----- |
| `read`, `read_image` | [read](/components/core/events/#file-read); an image's path comes from its `source` field |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `text_editor` | [read](/components/core/events/#file-read) or [write](/components/core/events/#file-write) by its `command`: `view` and `read` read; `write`, `create`, `overwrite`, `edit`, `str_replace`, `insert`, `move`, `rename`, and `delete` write; anything else is unknown |
| `shell` | [command](/components/core/events/#command), or a recognized file operation |
| `grep`, `glob` | [search](/components/core/events/#file-search) |
| `list`, `tree` | [list](/components/core/events/#directory-list) |
| `load_skill`, `skill` | [skill](/components/core/events/#skill) |
| `todo__*` | consumed as internal session state |
| any other tool | [unknown](/components/core/events/#unknown) |
