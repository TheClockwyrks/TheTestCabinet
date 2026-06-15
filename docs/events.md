# Harness Events

## Overview

While a run is in progress its harness is doing work — running commands, reading
and writing files, emitting assistant messages, and occasionally reporting its
own errors. The [agent harness layer](./harnesses.md) converts that activity into
a single stream of normalized **harness events** so that callers can observe a
run as it happens without needing to understand any harness specific output
format.

Every supported harness reports its activity differently. The harness layer is
responsible for translating each harness's raw output into the normalized event
types defined here, exactly as it translates raw usage into the normalized token
classes in [Metrics](./metrics.md#tokens). Callers — the
[testing harness application](./application.md), its command line interface, and
the desktop shell — consume one uniform stream regardless of which harness
produced it.

This solves a concrete problem: without an event stream the only signal a caller
gets is the final outcome, so a run appears to sit silently until it finishes and
a failure surfaces as a single opaque line. Emitting events as they arrive lets
callers show live progress and, when a harness fails, see the harness's own
diagnostic output rather than a truncated summary.

## Event Stream

A harness invocation produces an ordered stream of events as the harness runs.
Events are delivered to the caller in the order the harness emits them, before
the invocation completes, so a caller can render progress live.

Each event is one of the normalized [event types](#event-types) below. Every
event carries a discriminator identifying its type, and callers branch on that
discriminator rather than inspecting a generic payload.

## Common Fields

Every event, regardless of type, carries the following fields:

- **Type** — the discriminator slug identifying the event type. Each type below
  defines its own slug.
- **Timestamp** — an ISO 8601 timestamp for when the event was observed. Most
  harnesses do not stamp their own output, so this is the time the testing
  harness saw the line rather than a harness provided time.
- **Session ID** *(optional)* — the harness reported session identifier the event
  belongs to, when the harness exposes one. Unlike a dedicated session manager,
  The Test Cabinet does not mint its own session IDs; this field carries the
  underlying harness's identifier when it can be determined and is otherwise
  unset.

The type discriminator is inline on every event. Events do not nest their type
specific data under a `payload` field; callers check the type field and read the
type specific fields directly.

## Event Types

### Agent Message

Generated when an agent emits a plain natural language message that is not
structured tool activity, a harness diagnostic, or a terminal result the harness
reports separately.

- Discriminator: `agent`
- **Message** — the plain text emitted by the agent.

### Command

Generated when an agent runs a shell command. If a harness does not differentiate
shell commands used for reading, searching, or listing files from ordinary
commands, those operations are reported as command events rather than the
dedicated file operation events below.

- Discriminator: `command`
- **Command** — the shell command the agent attempted to run.
- **Working directory** *(optional)* — the directory the command ran from, when
  the harness reports it.
- **Exit code** *(optional)* — the process exit code, when the command reached a
  point where one exists and the harness reports it.
- **Is success** *(optional)* — whether the command succeeded. Agent caused
  failures (for example a malformed command) are still command events with this
  set to false. Unset when the harness does not report command success.

### File Read

Generated when an agent reads a file. Reports the operation that occurred, never
the data returned by it.

- Discriminator: `read`
- **Path** — the file that was read, as an absolute path when it can be
  determined. The path is not guaranteed to exist.
- **Start line** / **End line** *(optional)* — the inclusive line range read,
  when the harness reports it.
- **Is success** *(optional)* — whether the read succeeded. This is **not** the
  same as whether the path exists; a read can fail for other reasons such as
  permissions. Unset when the harness does not report it.

### File Write

Generated when an agent writes to a file. Reports where the write occurred, never
the written payload.

- Discriminator: `write`
- **Path** — the file that was written, as an absolute path when it can be
  determined. The path is not guaranteed to exist.
- **Start line** / **End line** *(optional)* — the inclusive line range written,
  when the harness reports it.
- **Is success** *(optional)* — whether the write succeeded, on the same terms as
  a read's success field.

### File Search

Generated when an agent searches the filesystem or searches within files. Reports
the search that occurred, never the results. If a harness does not differentiate
search commands from ordinary shell commands, searches are reported as command
events instead.

- Discriminator: `search`
- **Query** — the search pattern, file name, glob, or other search expression.
- **Path** *(optional)* — the file or directory scope searched, as an absolute
  path when set.
- **Is success** *(optional)* — whether the search completed, which is **not**
  the same as whether it matched anything.

### Directory List

Generated when an agent lists directory contents. Reports the listing operation,
never the entries returned.

- Discriminator: `list`
- **Path** *(optional)* — the directory whose contents were listed, as an
  absolute path when set.
- **Is success** *(optional)* — whether the listing completed.

### Skill

Generated when an agent uses a skill, but **only** when the harness differentiates
skill use from an ordinary file read. When a harness reports skill files as
ordinary reads, those are reported as read events instead.

- Discriminator: `skill`
- **Path** — the skill file that was read, as an absolute path when it can be
  determined.
- **Skill name** *(optional)* — the harness provided name for the skill.
- **Start line** / **End line** *(optional)* — the inclusive line range read.
- **Is success** *(optional)* — whether the skill use completed.

### Orchestration

Generated when a harness reports subagent orchestration activity, such as a
subagent starting or completing.

- Discriminator: `orchestration`
- **Action** — one of `subagent_started`, `subagent_completed`, or
  `subagent_failed`.
- **Subagent ID** *(optional)* — the harness provided identifier for the
  subagent.
- **Subagent name** *(optional)* — the harness provided display or role name.
- **Is success** *(optional)* — whether the action completed successfully, most
  meaningful for terminal actions.

### Harness Error

Generated when the underlying harness reports an error caused by the harness
itself. This is **not** used for agent caused errors; a malformed command an agent
ran is a command event with its success field set to false.

- Discriminator: `error`
- **Message** — a human readable description of the error.
- **Code** *(optional)* — a harness provided stable error code, when one exists.

### Warning

Generated when the underlying harness reports output indicating a potential issue.
Harness diagnostics printed to standard error that are not clearly fatal are
surfaced as warnings.

- Discriminator: `warning`
- **Message** — a human readable description of the potential issue.
- **Code** *(optional)* — a harness provided stable warning code, when one
  exists.

### Unknown

Generated when the harness layer cannot classify a piece of harness output as any
of the types above. Preserving these rather than dropping them keeps the stream
lossless, which matters most when diagnosing a failing harness.

- Discriminator: `unknown`
- **Raw** — the original harness output that could not be classified. It may be
  any JSON value, including a string for non JSON output.

## Translating Harness Output

Each harness emits its activity in its own format, and the harness layer maps that
format onto the event types above. Two broad strategies are used:

- **Structured mapping.** When a harness emits a documented machine readable event
  stream, the harness layer parses it and maps each event to its precise
  normalized type. [Codex](#codex-event-mapping),
  [Claude Code](#claude-code-event-mapping), [Cline](#cline-event-mapping),
  [Goose](#goose-event-mapping), [Kilo Code](#kilo-code-event-mapping),
  [OpenCode](#opencode-event-mapping), and [Pi](#pi-event-mapping) are mapped this
  way.
- **Best effort mapping.** For harnesses whose event formats are not yet modeled
  in detail, the harness layer surfaces output as it streams — recognizable
  diagnostics become warning or error events and everything else becomes an
  unknown event carrying the raw output. This still gives callers live visibility
  and full failure output, and a harness can be promoted to a structured mapping
  later without changing the event contract. Antigravity is mapped this way: it
  authenticates only with a Google account, so it cannot run in The Test
  Cabinet's API-key-only mode, and its plain `--print` output carries no
  structured stream to model.

A structured mapping's exact field names are confirmed against real CLI output
rather than a published schema. Where a harness's stream has not yet been
captured from a real run, the mapping reads each field from a small set of
candidate locations and falls back to an unknown event rather than guessing — and
the [`raw.jsonl` and `events.jsonl`](./run-records.md#co-located-run-files) files
a run records make it straightforward to confirm and refine those field names
against an actual stream.

Regardless of strategy, output a harness writes to standard error is surfaced as
warning events while the run is in progress, and an invocation that exits non
zero produces a terminal error event carrying the harness's own failure output.
The exit status alone is never the only signal a caller receives.

## Codex Event Mapping

Codex is run with `codex exec --json`, which emits a line delimited JSON stream on
standard output. Each non empty line is a complete JSON object. The stream has two
layers: lifecycle events describing the conversation and turn boundaries, and item
events wrapping a streamed `item` that carries its own `type`.

Lifecycle events are consumed for metadata rather than emitted as activity:

| Codex event | Handling |
| ----------- | -------- |
| `thread.started` | Carries `thread_id`, captured as the session ID for later events. |
| `turn.started` | Marks the start of a turn. No event is emitted. |
| `turn.completed` | Carries `usage`, consumed for [usage](./metrics.md#tokens). No event. |

Items are reported first as `item.started` and then as `item.completed`. The
normalized event is derived from the completed state so that terminal information
such as a command's exit code is available; the started notification is not turned
into a duplicate event. Completed items map as follows:

| Codex item type | Event |
| --------------- | ----- |
| `command_execution` | [command](#command), or a recognized file operation (see below) |
| `file_change` | one [write](#file-write) per changed path |
| `agent_message` | [agent](#agent-message) |
| `error` | [error](#harness-error) |
| any other item type | [unknown](#unknown) |

Codex runs file operations through shell commands rather than dedicated tools, so
`command_execution` items are inspected before falling back to a command event.
When the command is a `bash -lc` invocation whose first simple command is a known
file operation, it is mapped accordingly: `cat` and print only `sed` ranges map to
read events, `rg`, `grep`, and `find` map to search events, and `ls` maps to a
list event. A `sed -n '10,20p' path` range maps to a read event with start line 10
and end line 20. Paths are reported as absolute when they can be determined from
the command; because Codex does not report a per command working directory,
relative paths are surfaced as written. Commands that are not confidently a file
operation remain command events, with the item's exit code mapped to the exit code
and success fields.

Codex exposes a single diagnostic channel through `error` items, which it uses for
both true errors and advisory notices (for example reporting that a bypass flag is
enabled). Because Codex provides no severity signal, all `error` items map to error
events. Codex does not emit dedicated skill, warning, or orchestration activity in
this version, so those event types have no Codex source; if a future version adds
one, the corresponding event type must be produced from it. Any line that fails to
parse as JSON, and any item type not listed above, becomes an unknown event so the
stream stays lossless.

## Claude Code Event Mapping

Claude Code is run with `claude --print --output-format stream-json --verbose`,
which emits a line delimited JSON stream on standard output. Each non empty line
is a complete JSON object carrying a top level `type`. The stream is stateful: an
`assistant` event introduces a tool use, and the operation it requested is only
turned into a normalized event once the matching tool-result arrives in a later
`user` event. Pairing the requested operation with its observed result is what
lets a file read report both the path the agent asked for and whether the read
succeeded. Any event may carry a `session_id`; the first non empty one seen is
captured as the session ID for the stream.

Top level events map as follows:

| Claude Code event | Handling |
| ----------------- | -------- |
| `system` | Session lifecycle metadata. The `init` event's `cwd` is captured to resolve relative paths; `init`, `status`, and `thinking_tokens` subtypes emit no event. Any other subtype becomes [unknown](#unknown). |
| `assistant` | Text content becomes an [agent](#agent-message) message and tool-use content is recorded for correlation (see below). |
| `user` | Tool-result content resolves a recorded tool use into its event; echoed prompt or injected-context text emits no event. |
| `rate_limit_event` | Consumed as credential state, except a non `allowed` status, which becomes a [warning](#warning). |
| `result` | The terminal result; its usage and final output are consumed for [metrics](./metrics.md#tokens), and only a reported terminal error becomes an [error](#harness-error). |
| `stream_event` | Lower-level partial telemetry that the completed `assistant` and `user` events restate, so it is consumed. |
| any other type | [unknown](#unknown) |

Within an `assistant` message, `text` blocks are joined into one agent message,
while `thinking` and `redacted_thinking` blocks are model reasoning and carry no
activity. Each tool-use block is recognized by name and recorded; an unrecognized
tool (an MCP tool, web tool, todo tool, and the like) or a malformed tool-use
block becomes an unknown event. Recognized tools map to events when their
tool-result arrives, whose `is_error` and interruption flags set the success
field:

| Claude Code tool | Event |
| ---------------- | ----- |
| `Read` | [read](#file-read), with the line range derived from the `offset` and `limit` input |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | [write](#file-write) |
| `Grep`, `Glob` | [search](#file-search) |
| `LS` | [list](#directory-list) |
| `Bash` | [command](#command), or a recognized file operation classified from the command exactly as a Codex command is |
| `Skill` | [skill](#skill), with the path synthesized as `skills/<name>/SKILL.md` under the workspace |
| `StructuredOutput` | Native delivery of `--json-schema` output; the tool use and its result emit no event |
| any other tool | [unknown](#unknown) |

A tool-result is paired with its tool use by a unique `tool_use_id`; an ambiguous
match emits an unknown event rather than guessing the operation. A read result
that arrives without a recorded tool use is still recovered as a read event from
the file metadata it carries, and any other unpaired tool-result becomes an
unknown event so the stream stays lossless. As with every harness, file
operations report only the operation that occurred — the path, optional line
range, and success — never the contents the operation returned.

Claude Code does not emit a stable source for [orchestration](#orchestration)
activity in this version, so that event type has no Claude Code source; if a
future version adds one, the corresponding event type must be produced from it.

## Cline Event Mapping

Cline is run with `cline --json`, a line delimited JSON stream. Cline 3.x wraps
every record in a top-level `type`: `hook_event` (lifecycle bookkeeping,
consumed), `agent_event` (agent activity nested in its `event` object), and
`run_result` (the terminal record, whose final text and usage are consumed
elsewhere). The session id is captured from a `sessionId`, `session_id`, or `id`
field; the `taskId`/`task_id` fields name the in-memory conversation, not the
session, and are never captured.

Within an `agent_event`, the nested event's `type` and `contentType` drive the
mapping. Iteration boundaries, per-step `usage`, and `done` are consumed. A text
block's streaming delta arrives on `content_start` and is consumed; the matching
`content_end` carries the complete text and becomes an [agent](#agent-message)
message. A tool call's input arrives on `content_start` (recorded against its
`toolCallId`) and is resolved when the `content_end` carries the tool output,
whose `success` flag — or, for a batch, every item succeeding — sets the success
field. Tool names map as follows:

| Cline tool | Event |
| ---------- | ----- |
| `run_commands`, `execute_command`, `bash` | one [command](#command) per command (a `commands` array or single string) |
| `read_files`, `read_file` | one [read](#file-read) per file (a `files` array or single path) |
| `editor`, `write_to_file`, `replace_in_file`, `new_rule` | [write](#file-write) |
| `apply_patch` | one [write](#file-write) per file named by the patch markers |
| `search_files`, `search_codebase` | [search](#file-search) |
| `list_files` | [list](#directory-list) |
| `skills`, `use_skill` | [skill](#skill) |
| any other tool | [unknown](#unknown) |

Older Cline versions emit a flat say/ask stream instead of the wrapped records.
That legacy stream is handled conservatively: a `say` text or completion result
and an `ask` followup become agent messages, reasoning is consumed, a diagnostic
`say` becomes an [error](#harness-error), and everything else — including legacy
tool activity, which is not reconstructed — becomes an unknown event. Cline does
not emit a stable [orchestration](#orchestration) source in this version.

## Goose Event Mapping

Goose is run with `goose run --output-format stream-json`, a line delimited JSON
stream of `message`, `notification`, `error`, and `complete` events. The session
id comes from the named session Goose is launched with. The `complete` event
carries usage and is consumed; it also flushes the final assistant text.

A `message` event carries a serialized conversation message whose `content` is an
array of blocks processed in order. Assistant `text` blocks are accumulated into
one pending message — Goose streams a message as cumulative-or-delta records
sharing one id, so a record that restates the pending text replaces it and any
other same-id record is appended — and flushed as an [agent](#agent-message)
message when other activity follows or the run completes. User text and
`thinking`/`redactedThinking` blocks carry no activity. A `toolRequest` block is
recorded against its call id and resolved when the matching `toolResponse`
arrives, whose `toolResult.status` sets the success field. Tool names, after
stripping an extension prefix such as `developer__`, map as follows:

| Goose tool | Event |
| ---------- | ----- |
| `text_editor` | [read](#file-read) or [write](#file-write), by its command |
| `read` | [read](#file-read) |
| `write`, `edit` | [write](#file-write) |
| `grep`, `glob` | [search](#file-search) |
| `list` | [list](#directory-list) |
| `shell` | [command](#command), or a recognized file operation |
| `load_skill`, `skill` | [skill](#skill) |
| `todo__*` | consumed — internal session state, no event |
| any other tool | [unknown](#unknown) |

`notification` events are surfaced as unknown rather than parsed from prose, and
`error` events become [error](#harness-error) events.

## Kilo Code Event Mapping

Kilo Code is run with `kilo run --format json` and is built on OpenCode-style
runtime events (see [OpenCode](#opencode-event-mapping)), so it shares that
stream shape: `step_start`/`step_finish` boundaries (consumed; the latter carries
usage), `reasoning` (consumed), `text` (an [agent](#agent-message) message),
self-contained `tool_use` events, and `error` events. The session id is captured
from `sessionID`. Kilo extends the OpenCode tool set with workflow and semantic
tools:

| Kilo tool | Event |
| --------- | ----- |
| `task`, `agent_manager` | [orchestration](#orchestration) when the spawned agent/session is identified, otherwise [unknown](#unknown) |
| `codesearch` | [search](#file-search) |
| all OpenCode tools | as in the [OpenCode mapping](#opencode-event-mapping) |

## OpenCode Event Mapping

OpenCode is run with `opencode run --format json`, a line delimited JSON stream
of `step_start`, `text`, `tool_use`, `step_finish`, `reasoning`, and `error`
events, with the session id at `sessionID`. Step boundaries carry usage and are
consumed, reasoning is model thinking and is consumed, and a `text` event becomes
an [agent](#agent-message) message.

A `tool_use` event is self-contained — it carries the tool name, input, and a
terminal status in one event, so no request/response correlation is needed — and
its `completed`/`error` status sets the success field. Tool names map as follows:

| OpenCode tool | Event |
| ------------- | ----- |
| `read` | [read](#file-read) |
| `write`, `edit` | [write](#file-write) |
| `apply_patch` | one [write](#file-write) per file named by the patch markers |
| `grep`, `glob` | [search](#file-search) |
| `bash` | [command](#command), or a recognized file operation |
| `skill` | [skill](#skill) |
| `lsp` | [search](#file-search) when it carries a query/symbol, otherwise [unknown](#unknown) |
| any other tool (webfetch, websearch, todowrite, question, …) | [unknown](#unknown) |

`error` events become [error](#harness-error) events. OpenCode does not expose
[orchestration](#orchestration) in this version.

## Pi Event Mapping

Pi is run with `pi --mode json --print`, a line delimited JSON stream of lifecycle
markers (`session`, `agent_start`/`agent_end`, `turn_start`/`turn_end`,
`message_start`, `message_update`) and the two activity-bearing records,
`message_end` and `tool_execution_end`. The session id is captured from the
`session` record's `id`. Lifecycle markers, the partial `message_update` deltas,
and `turn_end` (consumed for usage) emit no event.

A `message_end` record whose message role is `assistant` becomes an
[agent](#agent-message) message — its content is a string or an array of text
parts — while a non-assistant message (such as the echoed user prompt) is
ignored. A `tool_execution_end` record is self-contained and carries a
`toolName`, structured input, and a terminal status; its status or `error` field
sets the success field. Tool names are matched case-insensitively:

| Pi tool | Event |
| ------- | ----- |
| `read` | [read](#file-read) |
| `write`, `edit` | [write](#file-write) |
| `search`, `grep`, `glob` | [search](#file-search) |
| `list` | [list](#directory-list) |
| `bash`, `shell` | [command](#command), or a recognized file operation |
| any other tool | [unknown](#unknown) |

Pi does not emit a dedicated [skill](#skill), [warning](#warning), or
[orchestration](#orchestration) source in this version.
