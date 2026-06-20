---
title: Harness Events
---

While a run is in progress its harness is doing work — running commands, reading
and writing files, emitting assistant messages, and occasionally reporting its
own errors. The [agent harness layer](/components/core/harnesses/) converts that
activity into a single stream of normalized **harness events** so that callers
can observe a run as it happens without needing to understand any harness
specific output format.

Every supported harness reports its activity differently. The harness layer is
responsible for translating each harness's raw output into the normalized event
types defined here, exactly as it translates raw usage into the normalized token
classes in [Metrics](/components/core/metrics/#tokens). Callers — the [testing
harness application](/components/architecture/), its command line interface, and
the desktop shell — consume one uniform stream regardless of which harness
produced it.

This solves a concrete problem: without an event stream the only signal a caller
gets is the final outcome, so a run appears to sit silently until it finishes and
a failure surfaces as a single opaque line. Emitting events as they arrive lets
callers show live progress and, when a harness fails, see the harness's own
diagnostic output rather than a truncated summary.

Not every event is translated from harness output. The orchestrator brackets a
harness session with setup and teardown work — pulling the run-container image,
starting the container, installing the harness, preparing the test case, and
tearing down afterward — and any of those steps can take a while before the
harness produces its first event. To keep that time from looking like a hang,
the orchestrator emits [system events](#system) of its own into the same stream,
so a caller always sees what the run is currently doing.

This page is the authoritative definition of the normalized event types. How a
specific harness's raw output is mapped onto them — the structured stream it
emits, its tool names, and its quirks — is documented per harness under
[Harnesses](/harnesses/), and the cross-cutting translation contract every
harness shares lives in the [agent harness
layer](/components/core/harnesses/#event-reporting).

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
- **Session ID** *(optional)* — the harness reported session identifier the
  event belongs to, when the harness exposes one. Unlike a dedicated session
  manager, The Test Cabinet does not mint its own session IDs; this field
  carries the underlying harness's identifier when it can be determined and is
  otherwise unset.

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

### Reasoning

Generated when a harness reports the model's internal reasoning ("thinking")
content as a stream distinct from the agent's visible message. Kept separate from
an [agent message](#agent-message) because reasoning is often long and is a
different kind of activity; a consumer can present it apart from the visible
output (the web feed collapses it by default).

Not every harness exposes reasoning content, and a harness that does only emits
it for models that produce it. A harness that folds reasoning into its visible
text (rather than reporting it as a separate block) produces no reasoning events,
and reasoning that is reported only as a token count — not as content — is
recorded in the run [metrics](metrics.md), not here.

- Discriminator: `reasoning`
- **Message** — the text of the model's reasoning.

### Command

Generated when an agent runs a shell command. If a harness does not
differentiate shell commands used for reading, searching, or listing files from
ordinary commands, those operations are reported as command events rather than
the dedicated file operation events below.

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

Generated when an agent writes to a file. Reports where the write occurred,
never the written payload.

- Discriminator: `write`
- **Path** — the file that was written, as an absolute path when it can be
  determined. The path is not guaranteed to exist.
- **Start line** / **End line** *(optional)* — the inclusive line range written,
  when the harness reports it.
- **Is success** *(optional)* — whether the write succeeded, on the same terms
  as a read's success field.

### File Search

Generated when an agent searches the filesystem or searches within files.
Reports the search that occurred, never the results. If a harness does not
differentiate search commands from ordinary shell commands, searches are
reported as command events instead.

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

Generated when an agent uses a skill, but **only** when the harness
differentiates skill use from an ordinary file read. When a harness reports
skill files as ordinary reads, those are reported as read events instead.

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
itself. This is **not** used for agent caused errors; a malformed command an
agent ran is a command event with its success field set to false.

- Discriminator: `error`
- **Message** — a human readable description of the error.
- **Code** *(optional)* — a harness provided stable error code, when one exists.

### Warning

Generated when the underlying harness reports output indicating a potential
issue. Harness diagnostics printed to standard error that are not clearly fatal
are surfaced as warnings.

- Discriminator: `warning`
- **Message** — a human readable description of the potential issue.
- **Code** *(optional)* — a harness provided stable warning code, when one
  exists.

### System

Generated by the orchestrator itself — not translated from harness output — to
report a run lifecycle stage as it begins, finishes, or fails. These bracket the
setup and teardown work around a harness session so a caller sees progress
during steps that can take a while (most often pulling the image or installing
the harness) instead of a silent wait. Because they originate in the
orchestrator rather than a harness, system events never carry a session ID.

- Discriminator: `system`
- **Stage** — the lifecycle stage being reported, one of `pull_image`,
  `start_container`, `install_harness`, `probe_harness`, `init_test_case`, or
  `teardown`.
- **Status** — the point the stage has reached, one of `started`, `completed`,
  or `failed`. A stage is reported with `started` when it begins and then
  `completed` or `failed` when it resolves; `install_harness` and
  `init_test_case` are only reported when the harness or test case defines the
  corresponding step.
- **Message** — a human readable description of the stage and its status.

### Unknown

Generated when the harness layer cannot classify a piece of harness output as
any of the types above. Preserving these rather than dropping them keeps the
stream lossless, which matters most when diagnosing a failing harness.

- Discriminator: `unknown`
- **Raw** — the original harness output that could not be classified. It may be
  any JSON value, including a string for non JSON output.

## Per-harness translation

Each harness reports its activity in its own format, and the harness layer maps
that format onto the event types above. The strategies it uses — a structured
mapping for harnesses with a documented machine readable stream, a best-effort
fallback for those whose format is not yet modeled, and the standard handling of
standard error and non-zero exits — are the cross-cutting concern of the [agent
harness layer](/components/core/harnesses/#event-reporting). The exact mapping
for each harness — its raw stream, tool names, and quirks — lives on that
harness's **Events** page under [Harnesses](/harnesses/).
