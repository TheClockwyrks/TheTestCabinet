---
title: "Run diagnostics"
---

The diagnostics explain a cost gap between two arms, through the tool-call
behavior and the token breakdown behind it. Every arm is diagnosable on the same
terms, so a third-party harness reports the per-tool and per-turn detail that
[gg's telemetry](/gg/telemetry/overview/) records for a gg run, and a gg run
reports the same per-tool tally a third-party harness does.

## Recorded run data

Every run stores three things the diagnostics build on.

Run-level [metrics](/components/contracts/metrics/): total run time, the four
normalized token classes (`uncached_input`, `cached_input`, `output`,
`reasoning`), and cost as both `comparable` and `actual`.

A normalized [event stream](/components/driver/events/),
`HarnessOutcome.translated_events`, persisted as the `run.events_json` column
and served at `GET /runs/{id}/events`. Every harness's raw output is parsed into
semantic [`EventKind`](/components/driver/events/) events.

A per-tool invocation tally, `RunRecord.tool_calls`, keyed by lowercased raw
tool name, and whether that tally has been counted.

## Event classification

The tool-call diagnostics are only as trustworthy as the classification behind
them, so every tool a supported harness emits maps to a semantic event or is
deliberately consumed (`event.rs` in `microservice-driver`). Nothing falls through to
`unknown`.

A new harness, or a new tool on an existing one, is validated the same way: pull
runs with `scripts/extract-assets.sh`, re-parse each `raw.jsonl` through the
current `EventParser`, and confirm no tool lands in `unknown`.

## Tool-call counts

Some tools are recognized and deliberately consumed, emitting no event because
they touch no workspace state. The todo tools (`todowrite`, `todoread`, and
Goose's `todo`) are the clearest case, and a harness may call them dozens of
times in a run. Each is a real API round-trip costing real tokens.

The tally therefore counts every tool invocation the model made, consumed ones
included, and is recorded independently of the event stream. Silent consumption
is correct for the activity feed and wrong for a cost diagnostic, so the two are
kept apart: `count_tool` records the invocation, and the parser emits an event
only when there is workspace activity to show.

Names are lowercased when counted, so a harness that varies casing counts one
tool.

Two harnesses name no tools in their output, so their tallies are counted from
what the run did instead.

- Codex reports completed items rather than tool calls. Its tally counts the
  run's normalized events: each `read`, `list`, `search`, `command` and `write`
  event is one call under that name, so a file change touching three files
  counts three `write` calls.
- gg's tally counts its own telemetry. A tool-calling agent's `ToolCall` counts
  under the tool's name (`read_file`), and a responses-as-code program's
  `ApiCall` counts under the operation it called (`files.read_file`). Every
  agent of the run is counted, subagents included.

Both counts are taken from the event stream the run stores, so the same
functions count a run as it streams and count a stored run afterwards.

### Counting an earlier run

A run records its tally as it streams. A gg or Codex run recorded before these
harnesses were counted has no tally, and is counted the first time a comparison
holds it.

Each run carries a flag saying whether its tally has been counted. A run that
streamed with counting in place is counted when it is stored. When a comparison
loads a held gg or Codex run whose flag is unset, the backend counts the run's
stored event stream, stores the tally and sets the flag. Every later load reads
the stored tally. The flag is what tells a run with no tool calls from one that
was never counted, so a run with an empty tally is counted once.

A comparison loads its runs without their event streams. Only a run being
counted has its stream read.

## Per-turn token attribution

Run-level totals answer how much was spent; per-turn usage answers what it was
spent on. Harnesses that report usage incrementally emit an
[`EventKind::Usage`](/components/driver/events/) event per turn, carrying that
turn's token counts and, when the harness reports one, that turn's cost.

The per-turn counts are mapped onto the four normalized classes by the same
`harness_registry` mapping in `microservice-driver` that produces the session
total, so a turn slice and the run total never diverge. The registry names the events that
carry usage per harness: `step_finish` for Kilo Code and OpenCode, `message_end`
for Pi. A harness that reports only a cumulative running total emits none, since
a cumulative snapshot is not a per-turn figure.

## Arm diagnostics

`ArmDiagnostics` (`comparison.rs` in `microservice-backend`) carries the four
token classes and the tool-call counts, each summed across the arm's runs. Ratios such
as the cache-hit ratio and the reasoning share are derived by the view from
those raw classes.

The comparison detail page presents, per arm and alongside the
[statistics](/comparisons/statistics/):

- the [comparable cost](/components/contracts/metrics/) and total-token
  distributions;
- the automated-only score and pass rate;
- tool-call counts by kind of work, stacked per arm, consumed tools included.

### Tool-call kinds

The tool-call chart groups every tool under the kind of work it does, so the
same work stacks the same way whichever harness did it, and each kind keeps one
color in every comparison. Each bar's tooltip lists, under each kind, the tools
counted in it.

| Kind        | Tools                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| `reading`   | reading a file or listing a folder                                     |
| `editing`   | writing or changing a file, `apply_patch` included                     |
| `shell`     | running a shell command                                                |
| `search`    | searching file contents or names                                       |
| `planning`  | todo lists and gg's task list                                          |
| `subagents` | handing work to another agent, Claude Code's and OpenCode's `task` too |
| `board`     | gg's issue board                                                       |
| `memory`    | gg's memories                                                          |
| `context`   | gg's context management: compaction, archives and file views           |
| `other`     | every other tool, and any tool the chart does not recognize            |

A gg function counts under the same kind as the tool it calls, so
`files.read_file` is `reading` like `read_file`. The table that assigns each
tool name its kind is `TOOL_KINDS` in
`packages/ui/src/app/pages/comparisons/comparisonMath.ts`.

The view presents these numbers and draws no conclusion about which arm is
better.
