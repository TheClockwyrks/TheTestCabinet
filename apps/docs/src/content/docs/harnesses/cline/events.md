---
title: Events
---

Cline runs with `cline --json` and emits a line-delimited JSON stream
(`EventFormat::Cline`) on standard output, which the harness layer translates
into the normalized [harness events](/components/core/events/). Cline 3.x wraps
every record in a top-level `type`; older versions emit a flat say/ask stream.
Both shapes are handled.

The session id is captured from a `sessionId`, `session_id`, or `id` field. The
`taskId`/`task_id` fields name the in-memory conversation, not the session, and
are never captured.

## Raw event stream

Each non-empty line is a complete JSON object dispatched on its top-level `type`:

| Top-level `type` | Handling |
| --- | --- |
| `hook_event` | Lifecycle bookkeeping. Consumed; no event. |
| `run_result` | The terminal record; its final text and usage are consumed elsewhere. No event. |
| `agent_event` | Agent activity nested in the record's `event` object (see below). |
| anything else | Treated as a legacy say/ask record (see below). |

Within an `agent_event`, the nested `event` object's `type` and `contentType`
drive the mapping. An `agent_event` with no nested `event` becomes an
[unknown](/components/core/events/#unknown) event.

- `iteration_start`, `iteration_end`, `usage`, and `done` are consumed; totals
  come from the `run_result` record instead.
- `content_start` records a tool call's input (a `tool` `contentType`, keyed by
  `toolCallId`) for later resolution. A text block's streaming delta is consumed
  here because the matching `content_end` carries the complete text.
- `content_end` resolves the block: a `text` block emits an
  [agent](/components/core/events/#agent-message) message (from the record's
  `text`, falling back to `content`; empty text emits nothing), a `reasoning` (or
  `thinking`) block emits a [reasoning](/components/core/events/#reasoning) event
  the same way, and a `tool` block resolves the recorded tool into its event(s). A
  tool whose `content_start` was missed is still classified from the `content_end`
  alone when it restates the `toolName` and `input`. Any other `contentType`
  becomes an unknown event.

  Note that whether reasoning arrives as its own `reasoning` block depends on the
  model and provider: some models (for example Gemini routed through OpenRouter)
  fold their reasoning into the visible `text` rather than emitting a separate
  block, in which case it is reported as part of the agent message with no
  reasoning event.

A tool's success is read from its `content_end` `output`: a `success` flag, or —
for a batch (`output` array or `output.results` array) — every item succeeding.

Older Cline versions emit a flat say/ask stream. It is handled conservatively: a
`say` of `text` or `completion_result`, and an `ask` of `followup`, become agent
messages when they carry non-empty `text`; `say` `reasoning` becomes a
[reasoning](/components/core/events/#reasoning) event; `say`
`error` or `api_req_failed` becomes an
[error](/components/core/events/#harness-error) event. Everything else —
including legacy tool activity, which is not reconstructed — becomes an unknown
event.

## Normalized mapping

| Raw record | Normalized event |
| --- | --- |
| `hook_event` | consumed |
| `run_result` | consumed (text and usage) |
| `agent_event` → `iteration_start` / `iteration_end` / `usage` / `done` | consumed |
| `agent_event` → `content_start` | consumed (records tool input or text delta) |
| `agent_event` → `content_end` (`text`) | [agent](/components/core/events/#agent-message) |
| `agent_event` → `content_end` (`reasoning` / `thinking`) | [reasoning](/components/core/events/#reasoning) |
| `agent_event` → `content_end` (`tool`) | per the [tool mapping](#tool-mapping) |
| legacy `say` `text` / `completion_result`, `ask` `followup` | [agent](/components/core/events/#agent-message) |
| legacy `say` `reasoning` | [reasoning](/components/core/events/#reasoning) |
| legacy `say` `error` / `api_req_failed` | [error](/components/core/events/#harness-error) |
| `agent_event` with no nested `event`, unrecognized `contentType`, legacy tool activity, anything else | [unknown](/components/core/events/#unknown) |

## Tool mapping

A `tool` `content_end` is classified by its `toolName`:

| Cline tool | Event |
| --- | --- |
| `run_commands`, `execute_command`, `bash` | [command](/components/core/events/#command) (one per command — a `commands` array or single string) |
| `read_files`, `read_file` | [read](/components/core/events/#file-read) (one per file — a `files` array or single path) |
| `editor`, `write_to_file`, `replace_in_file`, `new_rule` | [write](/components/core/events/#file-write) |
| `apply_patch` | [write](/components/core/events/#file-write) (one per file named by the patch markers) |
| `search_files`, `search_codebase` | [search](/components/core/events/#file-search) |
| `list_files` | [list](/components/core/events/#directory-list) |
| `skills`, `use_skill` | [skill](/components/core/events/#skill) |
| any other tool | [unknown](/components/core/events/#unknown) |

See [Harness Events](/components/core/events/) for the normalized event types
these map onto.
