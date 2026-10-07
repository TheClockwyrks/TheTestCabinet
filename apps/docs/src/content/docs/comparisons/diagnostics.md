---
title: "Run diagnostics"
---

The diagnostics explain a cost gap between two arms, through the tool-call
behavior and the token breakdown behind it. Every arm is diagnosable on the same
terms, so a third-party harness reports the per-tool and per-turn detail that
[gg's telemetry](/gg/telemetry/overview/) records for a gg run.

## Recorded run data

Every non-gg run stores three things the diagnostics build on.

Run-level [metrics](/components/core/metrics/): total run time, the four
normalized token classes (`uncached_input`, `cached_input`, `output`,
`reasoning`), and cost as both `comparable` and `actual`.

A normalized [event stream](/components/core/events/),
`HarnessOutcome.translated_events`, persisted as the `run.events_json` column
and served at `GET /runs/{id}/events`. Every harness's raw output is parsed into
semantic [`EventKind`](/components/core/events/) events.

A per-tool invocation tally, `RunRecord.tool_calls`, keyed by lowercased raw
tool name.

## Event classification

The tool-call diagnostics are only as trustworthy as the classification behind
them, so every tool a supported harness emits maps to a semantic event or is
deliberately consumed (`crates/core/src/event.rs`). Nothing falls through to
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

## Per-turn token attribution

Run-level totals answer how much was spent; per-turn usage answers what it was
spent on. Harnesses that report usage incrementally emit an
[`EventKind::Usage`](/components/core/events/) event per turn, carrying that
turn's token counts and, when the harness reports one, that turn's cost.

The per-turn counts are mapped onto the four normalized classes by the same
`crates/core/src/harness_registry` mapping that produces the session total, so a
turn slice and the run total never diverge. The registry names the events that
carry usage per harness: `step_finish` for Kilo Code and OpenCode, `message_end`
for Pi. A harness that reports only a cumulative running total emits none, since
a cumulative snapshot is not a per-turn figure.

## Arm diagnostics

`ArmDiagnostics` (`crates/core/src/comparison.rs`) carries the four token
classes and the tool-call counts, each summed across the arm's runs. Ratios such
as the cache-hit ratio and the reasoning share are derived by the view from
those raw classes.

The comparison detail page presents, per arm and alongside the
[statistics](/comparisons/statistics/):

- the [comparable cost](/components/core/metrics/) and total-token
  distributions;
- the automated-only score and pass rate;
- tool-call counts by tool, stacked per arm, consumed tools included.

The view presents these numbers and draws no conclusion about which arm is
better.
