---
title: Harness Events
---

While a run is in progress its harness runs commands, reads and writes files,
emits assistant messages, and reports its own errors. The [agent harness
layer](/components/core/harnesses/) converts that activity into a single stream
of normalized harness events, so a caller observes a run as it happens through
one uniform stream regardless of which harness produced it.

Every supported harness reports its activity differently. The harness layer
translates each harness's raw output into the normalized event types defined
here, exactly as it translates raw usage into the normalized token classes in
[Metrics](/components/core/metrics/#tokens). Emitting events as they arrive lets
a caller show live progress and, when a harness fails, surface the harness's own
diagnostic output rather than a truncated summary.

Some events originate in the orchestrator rather than in harness output. The
orchestrator brackets a harness session with setup and teardown work, and any of
those steps can take a while before the harness produces its first event. It
emits [system events](#system) of its own into the same stream so that a caller
always sees what the run is currently doing.

This page is the authoritative definition of the normalized event types. The
cross-cutting translation contract every harness shares lives in the [agent
harness layer](/components/core/harnesses/#event-reporting), and the mapping for
a specific harness lives on that harness's Events page under
[Harnesses](/harnesses/overview/).

## Event stream

A harness invocation produces an ordered stream of events as the harness runs.
Events are delivered to the caller in the order the harness emits them, before
the invocation completes, so a caller can render progress live.

Each event is one of the normalized [event types](#event-types) below. Every
event carries a discriminator identifying its type, and callers branch on that
discriminator rather than inspecting a generic payload.

## Common fields

Every event, regardless of type, carries the following fields.

- Type — the discriminator slug identifying the event type. Each type below
  defines its own slug.
- Timestamp — an ISO 8601 timestamp for when the event was observed. Most
  harnesses do not stamp their own output, so this is the time the testing
  harness saw the line rather than a harness provided time.
- Session ID (optional) — the harness reported session identifier the event
  belongs to, when the harness exposes one. The Test Cabinet mints no session
  IDs of its own; this field carries the underlying harness's identifier when it
  can be determined and is otherwise unset.

The type discriminator is inline on every event. Type specific data sits inline
beside it, so a caller checks the type field and reads the type specific fields
directly.

## Event types

### Agent message

Generated when an agent emits a plain natural language message that is not
structured tool activity, a harness diagnostic, or a terminal result the harness
reports separately.

- Discriminator: `agent`
- Message — the plain text emitted by the agent.

### Reasoning

Generated when a harness reports the model's internal reasoning ("thinking")
content as a stream distinct from the agent's visible message. It is kept
separate from an [agent message](#agent-message) because reasoning is often long
and is a different kind of activity, so a consumer can present it apart from the
visible output.

A harness that folds reasoning into its visible text produces no reasoning
events. Reasoning reported only as a token count is recorded in the run
[metrics](/components/core/metrics/).

- Discriminator: `reasoning`
- Message — the text of the model's reasoning.

### Command

Generated when an agent runs a shell command. A harness that reports reading,
searching, or listing files as ordinary shell commands produces command events
for those operations rather than the dedicated file operation events below.

- Discriminator: `command`
- Command — the shell command the agent attempted to run.
- Working directory (optional) — the directory the command ran from, when the
  harness reports it.
- Exit code (optional) — the process exit code, when the command reached a point
  where one exists and the harness reports it.
- Is success (optional) — whether the command succeeded. An agent caused
  failure, for example a malformed command, is a command event with this set to
  false. Unset when the harness does not report command success.

### File read

Generated when an agent reads a file. Reports the operation that occurred, and
the data returned by it stays out of the stream.

- Discriminator: `read`
- Path — the file that was read, as an absolute path when it can be determined.
  The path is not guaranteed to exist.
- Start line / End line (optional) — the inclusive line range read, when the
  harness reports it.
- Is success (optional) — whether the read succeeded, which is distinct from
  whether the path exists. A read can fail for other reasons such as
  permissions. Unset when the harness does not report it.

### File write

Generated when an agent writes to a file. Reports where the write occurred, and
the written payload stays out of the stream.

- Discriminator: `write`
- Path — the file that was written, as an absolute path when it can be
  determined. The path is not guaranteed to exist.
- Start line / End line (optional) — the inclusive line range written, when the
  harness reports it.
- Is success (optional) — whether the write succeeded, on the same terms as a
  read's success field.

### File search

Generated when an agent searches the filesystem or searches within files.
Reports the search that occurred, and its results stay out of the stream. A
harness that reports searches as ordinary shell commands produces
[command](#command) events for them instead.

- Discriminator: `search`
- Query — the search pattern, file name, glob, or other search expression.
- Path (optional) — the file or directory scope searched, as an absolute path
  when set.
- Is success (optional) — whether the search completed, which is distinct from
  whether it matched anything.

### Directory list

Generated when an agent lists directory contents. Reports the listing operation,
and the entries returned stay out of the stream.

- Discriminator: `list`
- Path (optional) — the directory whose contents were listed, as an absolute
  path when set.
- Is success (optional) — whether the listing completed.

### Skill

Generated when an agent uses a skill, and only when the harness differentiates
skill use from an ordinary file read. A harness that reports skill files as
ordinary reads produces [read](#file-read) events for them instead.

- Discriminator: `skill`
- Path — the skill file that was read, as an absolute path when it can be
  determined.
- Skill name (optional) — the harness provided name for the skill.
- Start line / End line (optional) — the inclusive line range read.
- Is success (optional) — whether the skill use completed.

### Orchestration

Generated when a harness reports subagent orchestration activity, such as a
subagent starting or completing.

- Discriminator: `orchestration`
- Action — one of `subagent_started`, `subagent_completed`, or
  `subagent_failed`.
- Subagent ID (optional) — the harness provided identifier for the subagent.
- Subagent name (optional) — the harness provided display or role name.
- Is success (optional) — whether the action completed successfully, most
  meaningful for terminal actions.

### Usage

Generated when a harness reports per-turn token usage partway through a run, one
event per turn. The counts carry that turn's tokens mapped onto the same four
normalized classes as the run-level total, through the same shared mapping, so a
per-turn slice and the session total never diverge. The run-level total in
[Metrics](/components/core/metrics/) answers how much a run spent; these events
answer where it was spent.

Only a harness that reports per-turn deltas produces these events. A harness
that reports a cumulative running total produces none.

- Discriminator: `usage`
- Tokens — this turn's [token counts](/components/core/metrics/#tokens), by
  normalized class.
- Cost (optional) — the harness reported cost in USD for this turn, when the
  harness reports cost per turn.

### Harness error

Generated when the underlying harness reports an error caused by the harness
itself. An agent caused error is reported instead as a [command](#command) event
with its success field set to false.

- Discriminator: `error`
- Message — a human readable description of the error.
- Code (optional) — a harness provided stable error code, when one exists.

### Warning

Generated when the underlying harness reports output indicating a potential
issue. Harness diagnostics printed to standard error that are not clearly fatal
are surfaced as warnings.

- Discriminator: `warning`
- Message — a human readable description of the potential issue.
- Code (optional) — a harness provided stable warning code, when one exists.

### System

Generated by the orchestrator to report a run lifecycle stage as it begins,
finishes, or fails. These bracket the setup and teardown work around a harness
session so that a caller sees progress during steps that can take a while, most
often pulling the image or installing the harness. They originate in the
orchestrator rather than a harness, so they carry no session ID.

- Discriminator: `system`
- Stage — the lifecycle stage being reported, one of `pull_image`,
  `start_container`, `install_harness`, `probe_harness`, `init_test_case`, or
  `teardown`.
- Status — the point the stage has reached, one of `started`, `completed`, or
  `failed`. A stage is reported with `started` when it begins and then
  `completed` or `failed` when it resolves. `install_harness` and
  `init_test_case` are reported only when the harness or test case defines the
  corresponding step.
- Message — a human readable description of the stage and its status.

### gg telemetry

Generated by [gg](/gg/overview/), which the core invokes directly rather than
translating from a third-party CLI's output. gg emits a purpose-built
[telemetry](/gg/telemetry/overview/) stream covering the agent tree, the issue board, and
context-window breakdowns, all of which sit outside the taxonomy above. A gg run
carries each telemetry event verbatim in this type, so gg's own events flow
unchanged through the same sink, relay, and event store as every other event.

A gg run also emits the mapped, human-facing types above alongside these events,
so a console that does not understand gg's stream still shows live activity.

- Discriminator: `gg`
- Event — the gg telemetry event, verbatim.

### Unknown

Generated when the harness layer cannot classify a piece of harness output as
any of the types above. Preserving these keeps the stream lossless, which
matters most when diagnosing a failing harness.

- Discriminator: `unknown`
- Raw — the original harness output that could not be classified. It may be any
  JSON value, including a string for output that is not JSON.

## Per-harness translation

Each harness reports its activity in its own format, and the harness layer maps
that format onto the event types above. The strategies it uses are the
cross-cutting concern of the [agent harness
layer](/components/core/harnesses/#event-reporting): a structured mapping for a
harness with a documented machine readable stream, a best-effort fallback for
one whose format is not yet modeled, and the standard handling of standard error
and non-zero exits. The exact mapping for each harness, its raw stream, tool
names, and quirks, lives on that harness's Events page under
[Harnesses](/harnesses/overview/).
