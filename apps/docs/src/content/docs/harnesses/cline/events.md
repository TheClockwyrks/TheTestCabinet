---
title: Events
---

Cline emits its activity as `EventFormat::Cline`. It runs with `cline --json`,
which writes a line-delimited JSON stream on standard output. The harness layer
parses that stream and maps it onto the normalized
[harness events](/components/core/events/).

## Raw event stream

Each non-empty line is one complete JSON object carrying a top-level `type`.
Current Cline versions wrap every record in an `agent_event`, whose real event
is nested in an `event` object; versions that emit a flat say/ask stream are
supported as well.

The session id is captured from a `sessionId`, `session_id`, or `id` field. The
`taskId` and `task_id` fields name the in-memory conversation rather than the
session, so they are never captured.

Within an `agent_event`, the nested `event` object's `type` and `contentType`
drive the mapping. A tool call's input arrives on its `content_start`, keyed by
`toolCallId`, and is resolved when the matching `content_end` arrives with the
call's terminal output. A tool whose `content_start` was missed is still
classified from the `content_end` alone when that record restates the `toolName`
and `input`. A text or reasoning block's streaming delta is consumed on
`content_start`, because the matching `content_end` carries the complete text.

A tool's success is read from its `content_end` `output`: a `success` flag, or,
for a batch carried as an `output` array or an `output.results` array, every
item succeeding.

Whether reasoning arrives as its own block depends on the model and the
provider. A model that folds its reasoning into the visible text has that
reasoning reported as part of the agent message.

## Normalized mapping

| Raw record                                                                                                   | Normalized event                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `hook_event`                                                                                                 | consumed                                                                                 |
| `run_result`                                                                                                 | consumed; carries the session usage totals read for [metrics](/harnesses/cline/metrics/) |
| `agent_event` → `iteration_start`, `iteration_end`, `usage`, `done`                                          | consumed                                                                                 |
| `agent_event` → `content_start`                                                                              | consumed; records the tool input or the streaming delta                                  |
| `agent_event` → `content_end` (`text`)                                                                       | [agent](/components/core/events/#agent-message) message, from `text` or `content`        |
| `agent_event` → `content_end` (`reasoning`, `thinking`)                                                      | [reasoning](/components/core/events/#reasoning), from `text` or `content`                |
| `agent_event` → `content_end` (`tool`)                                                                       | the events its tool classifies to (see [Tool mapping](#tool-mapping))                    |
| `say` `text`, `say` `completion_result`, `ask` `followup`                                                    | [agent](/components/core/events/#agent-message) message when it carries text             |
| `say` `reasoning`                                                                                            | [reasoning](/components/core/events/#reasoning)                                          |
| `say` `error`, `say` `api_req_failed`                                                                        | [error](/components/core/events/#harness-error)                                          |
| an `agent_event` with no nested `event`, an unrecognized `contentType`, say/ask tool activity, anything else | [unknown](/components/core/events/#unknown)                                              |

A `content_end` whose text is empty emits nothing. A line that fails to parse as
JSON becomes a [warning](/components/core/events/#warning), so the stream stays
lossless.

## Tool mapping

A `tool` `content_end` is classified by its `toolName`:

| Cline tool                                               | Event                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `run_commands`, `execute_command`, `bash`                | [command](/components/core/events/#command), one per command in a `commands` array or one for a single command string |
| `read_files`, `read_file`                                | [read](/components/core/events/#file-read), one per file in a `files` array or one for a single path                  |
| `editor`, `write_to_file`, `replace_in_file`, `new_rule` | [write](/components/core/events/#file-write)                                                                          |
| `apply_patch`                                            | one [write](/components/core/events/#file-write) per file named by the patch markers                                  |
| `search_files`, `search_codebase`                        | [search](/components/core/events/#file-search), one per pattern in a `queries` array or one for a single query        |
| `list_files`                                             | [list](/components/core/events/#directory-list)                                                                       |
| `skills`, `use_skill`                                    | [skill](/components/core/events/#skill)                                                                               |
| any other tool                                           | [unknown](/components/core/events/#unknown)                                                                           |
