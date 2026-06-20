---
title: Events
---

Goose uses `EventFormat::Goose`. It is run with `goose run --output-format
stream-json`, which emits a line-delimited JSON stream on standard output: each
non-empty line is a complete JSON object carrying a top-level `type`. The harness
layer parses that stream and maps each record onto the normalized [harness
events](/components/core/events/).

## Raw event stream

The stream is made up of four record types:

| Goose record | Handling |
| ------------ | -------- |
| `message` | A serialized conversation message whose `content` is an array of blocks (`text`, `thinking`/`redactedThinking`, `toolRequest`, `toolResponse`) processed in order. |
| `notification` | Surfaced verbatim as an [unknown](/components/core/events/#unknown) event rather than parsed from prose. |
| `error` | Becomes an [error](/components/core/events/#harness-error) event. |
| `complete` | The run boundary. It carries usage (consumed for [metrics](./metrics/)) and flushes any pending assistant text. |

Within a `message`, only assistant `text` blocks are agent progress; user text is
the echoed prompt and is ignored, and `thinking`/`redactedThinking` blocks carry
no activity. Assistant text fragments share a message `id` and are accumulated
into one pending message: a record that restates the pending text replaces it (a
cumulative update), and any other same-id record is appended (a delta). The
pending text is flushed as a single [agent](/components/core/events/#agent-message)
message when other activity follows, when the message id changes, or when the run
completes.

A `toolRequest` block is recorded against its call id and resolved when the
matching `toolResponse` arrives; the two are correlated by id. The response's
`toolResult.status` (`success`/`error`) sets the event's success field. A
`toolRequest` that cannot be parsed becomes an unknown event.

## Normalized mapping

| Raw | Normalized |
| --- | ---------- |
| assistant `text` block | [agent](/components/core/events/#agent-message) (accumulated across same-id fragments, then flushed) |
| user `text`, `thinking`, `redactedThinking` | consumed — no event |
| `toolRequest` + matching `toolResponse` | the [tool event](#tool-mapping) for the tool, or unknown |
| `complete` | consumed for usage; flushes pending text — no event of its own |
| `error` | [error](/components/core/events/#harness-error) |
| `notification` | [unknown](/components/core/events/#unknown) |
| unrecognized record / block type | [unknown](/components/core/events/#unknown) |

The harness layer does not capture a session id from Goose's stream, so harness
events from a Goose run carry no session ID.

## Tool mapping

Goose and MCP servers prefix tool names with an extension id (such as
`developer__shell`); the name is split on `__` and the extension prefix is
stripped before classification. Tools from the `todo` extension are consumed as
internal session state. The remaining base names map as follows:

| Goose tool | Event |
| ---------- | ----- |
| `read` | [read](/components/core/events/#file-read) |
| `write`, `edit` | [write](/components/core/events/#file-write) |
| `text_editor` | [read](/components/core/events/#file-read) or [write](/components/core/events/#file-write), by its `command` (`view`/`read` read; `write`/`create`/`overwrite`/`edit`/`str_replace`/`insert`/`move`/`rename`/`delete` write; anything else unknown) |
| `shell` | [command](/components/core/events/#command), or a recognized file operation |
| `grep`, `glob` | [search](/components/core/events/#file-search) |
| `list` | [list](/components/core/events/#directory-list) |
| `load_skill`, `skill` | [skill](/components/core/events/#skill) |
| `todo__*` | consumed — internal session state, no event |
| any other tool | [unknown](/components/core/events/#unknown) |

See [Harness Events](/components/core/events/) for the normalized event contract.
