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
  normalized type. [Codex](#codex-event-mapping) is mapped this way.
- **Best effort mapping.** For harnesses whose event formats are not yet modeled
  in detail, the harness layer surfaces output as it streams — recognizable
  diagnostics become warning or error events and everything else becomes an
  unknown event carrying the raw output. This still gives callers live visibility
  and full failure output, and a harness can be promoted to a structured mapping
  later without changing the event contract.

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
