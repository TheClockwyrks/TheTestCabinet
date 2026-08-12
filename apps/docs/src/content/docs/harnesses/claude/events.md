---
title: Events
---

Claude Code is run with `claude --print --output-format stream-json --verbose`,
which emits a line-delimited JSON stream on standard output. Each non-empty line
is a complete JSON object carrying a top-level `type`. The harness layer parses
that stream into the normalized [harness events](/components/core/events/) every
caller consumes.

The stream is stateful. An `assistant` event introduces a tool use, and the
operation it requested becomes a normalized event only once the matching
tool-result arrives in a later `user` event. Pairing the requested operation
with its observed result is what lets a file read report both the path the agent
asked for and whether the read succeeded. Any event may carry a `session_id`;
the first non-empty one seen is the session ID for the stream.

## Raw event stream

Top-level `type` values are recognized as follows:

| Claude Code event | Handling |
| ----------------- | -------- |
| `system` | Session lifecycle metadata. The `init` event's `cwd` is captured to resolve relative paths. The `init`, `status`, and `thinking_tokens` subtypes emit no event; any other subtype becomes an unknown event. |
| `assistant` | Text content becomes activity; tool-use content is recorded for later correlation. |
| `user` | Tool-result content resolves a recorded tool use. Echoed prompt or injected-context text emits no event. |
| `rate_limit_event` | Credential state, consumed. A status other than `allowed` becomes a warning. |
| `result` | The terminal event. Its usage and final output are consumed for [metrics](/harnesses/claude/metrics/); a reported terminal error becomes an event. |
| `stream_event` | Lower-level partial telemetry that the completed `assistant` and `user` events restate, so it is consumed. |
| any other type | An unknown event, so the stream stays lossless. |

A non-JSON line is a diagnostic printed outside the stream and is surfaced as a
warning. Output on standard error is surfaced as a warning as well.

## Normalized mapping

| Raw stream input | Normalized event |
| ---------------- | ---------------- |
| `assistant` `text` blocks, joined per message | [agent](/components/core/events/#agent-message) |
| `assistant` `thinking` blocks, joined per message | [reasoning](/components/core/events/#reasoning) |
| `assistant` `redacted_thinking` block | consumed, since it carries no readable text |
| `assistant` `tool_use` block | recorded, and resolved when its tool-result arrives |
| `user` `tool_result` block | the recorded tool use's event(s) |
| `user` `text` block | consumed as echoed prompt or injected context |
| `rate_limit_event` with a non-`allowed` status | [warning](/components/core/events/#warning) |
| terminal `result` reporting an error | [error](/components/core/events/#harness-error) |
| `system` recognized subtypes, `stream_event`, allowed `rate_limit_event`, successful `result` | consumed |
| unrecognized output | [unknown](/components/core/events/#unknown) |

Reasoning is emitted ahead of the agent message it leads into, so a thought
split across blocks is reported once. An unrecognized tool, a malformed tool-use
block, and an unrecognized `system` subtype each become unknown events, so
nothing is dropped. Claude Code has no
[orchestration](/components/core/events/#orchestration) source.

## Tool mapping

Each recognized tool use is paired with its tool-result by a unique
`tool_use_id`, and the result's error and interruption flags set the success
field. An ambiguous id match becomes an unknown event rather than a guess. A
read result that arrives with no recorded tool use is recovered as a read event
from the file metadata it carries; any other unpaired result becomes an unknown
event.

| Claude Code tool | Normalized event |
| ---------------- | ---------------- |
| `Read` | [read](/components/core/events/#file-read), with the line range derived from the `offset` and `limit` input |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | [write](/components/core/events/#file-write) |
| `Grep`, `Glob` | [search](/components/core/events/#file-search) |
| `LS` | [list](/components/core/events/#directory-list) |
| `Bash` | [command](/components/core/events/#command), or a recognized file operation reclassified into read, search, or list from the command, exactly as a Codex command is |
| `Skill` | [skill](/components/core/events/#skill), with the path synthesized as `skills/<name>/SKILL.md` under the workspace |
| `StructuredOutput` | Native delivery of `--json-schema` output; it produces no event |
| any other tool | [unknown](/components/core/events/#unknown) |

Claude Code reports no stable exit code for `Bash` results, so a command event
carries success without an exit code.
