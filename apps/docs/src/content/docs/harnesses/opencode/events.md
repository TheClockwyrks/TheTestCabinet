---
title: Events
---

OpenCode emits its activity as `EventFormat::Opencode`. It runs with
`opencode run --format json`, which writes a line-delimited JSON stream on
standard output. The harness layer parses that stream and maps it onto the
normalized [harness events](/components/driver/events/).

## Raw event stream

Each non-empty line is one complete JSON object carrying a top-level `type`. The
stream is step-oriented: step boundaries bracket the model's turns, and
reasoning, text, tool use, and errors carry the activity within them.

The session id is captured from the first `sessionID`, `session_id`, or
`sessionId` field seen.

A `tool_use` record is self-contained. It carries the tool name, its input, and
a terminal status in one record, so no request/response correlation is needed. A
status of `completed`, `success`, `done`, or `ok` marks the call successful;
`error`, `failed`, `failure`, `cancelled`, or `canceled` marks it failed. Any
other status leaves success undetermined.

## Normalized mapping

| Raw record     | Normalized event                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `step_start`   | consumed                                                                                                                                       |
| `step_finish`  | consumed; carries this step's token usage, emitted as a per-turn usage event and summed into the run's [metrics](/harnesses/opencode/metrics/) |
| `reasoning`    | [reasoning](/components/driver/events/#reasoning) when it carries text, otherwise consumed                                                     |
| `text`         | [agent](/components/driver/events/#agent-message) message when it carries text, otherwise consumed                                             |
| `tool_use`     | the events its tool classifies to (see [Tool mapping](#tool-mapping))                                                                          |
| `error`        | [error](/components/driver/events/#harness-error)                                                                                              |
| any other type | [unknown](/components/driver/events/#unknown)                                                                                                  |

A `tool_use` whose tool name is unrecognized also becomes an unknown event, and
a line that fails to parse as JSON becomes a
[warning](/components/driver/events/#warning), so the stream stays lossless.

## Tool mapping

Tool names are matched case-insensitively:

| OpenCode tool                   | Event                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`                          | [read](/components/driver/events/#file-read)                                                                                                                       |
| `write`, `edit`                 | [write](/components/driver/events/#file-write)                                                                                                                     |
| `apply_patch`                   | one [write](/components/driver/events/#file-write) per file named by the patch markers                                                                             |
| `grep`, `glob`                  | [search](/components/driver/events/#file-search)                                                                                                                   |
| `bash`                          | [command](/components/driver/events/#command), or a recognized file operation                                                                                      |
| `background_process`            | [command](/components/driver/events/#command) when the input carries a command line, otherwise consumed                                                            |
| `task`, `agent_manager`         | [orchestration](/components/driver/events/#orchestration) when the spawned agent or session is identified, otherwise [unknown](/components/driver/events/#unknown) |
| `skill`                         | [skill](/components/driver/events/#skill)                                                                                                                          |
| `lsp`                           | [search](/components/driver/events/#file-search) when it carries a query or symbol, otherwise [unknown](/components/driver/events/#unknown)                        |
| `todo`, `todowrite`, `todoread` | consumed; the agent's internal task list                                                                                                                           |
| any other tool                  | [unknown](/components/driver/events/#unknown)                                                                                                                      |
