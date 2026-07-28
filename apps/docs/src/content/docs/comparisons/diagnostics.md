---
title: "Why: run diagnostics"
---

Knowing that Kilo cost 6× what Pi did is the start of the question, not the
answer. A comparison must show **why** — the tool-call behavior and token
breakdown that explain the gap. The target is the depth
[gg's result views](/gg/telemetry/) already reach for its own runs (per-tool call
counts, per-turn tokens, cache ratios), brought to the **third-party harnesses** so
every arm is diagnosable on equal terms.

This requires capturing more than the run-level totals recorded today. Both gaps
below are **in scope** for the comparison feature.

## What is recorded today

Every non-gg run stores:

- **Run-level [metrics](/components/core/metrics/) only:** total run time, the four
  normalized token classes (`uncached_input`, `cached_input`, `output`,
  `reasoning`), and cost (`comparable` / `actual`). No turn count, no tool-call
  count, no per-turn breakdown.
- **A normalized [event stream](/components/core/events/)** —
  `HarnessOutcome.translated_events`, persisted as the `run.events_json` column and
  served at `GET /runs/{id}/events`. Every harness's raw output is parsed into
  semantic [`EventKind`](/components/core/events/) events (`Read`, `Write`,
  `Command`, `Search`, `List`, `Skill`, `Orchestration`, `Reasoning`, `Agent`, …).

The event stream is the seam the diagnostics build on — but it needs the two
additions below.

## Prerequisite: correct event classification (done)

The tool-call diagnostics are only as trustworthy as the classification behind
them. That classification was **audited and fixed** as the first step of this
feature (`crates/core/src/event.rs`), validated by re-parsing real Codex /
OpenCode / Cline / Kilo / Pi runs of Carom until zero tool calls fell through to
`unknown`. Five tools had been leaking:

- `apply_patch` (Kilo/OpenCode) — the patch body is in `patchText`, which the path
  extractor didn't read, so **every file write these harnesses made was dropped**;
  they appeared to never write a file. Now mapped to `Write`.
- `background_process` (Kilo/OpenCode) — unhandled; a `start` action now maps to
  its command.
- `task` (OpenCode) — the subagent-spawn tool was routed only by Kilo; now shared,
  mapping to `Orchestration`.
- `search_codebase` (Cline) — its patterns arrive in a `queries` array, not a
  scalar; now one `Search` per query.
- `agent_settled` (Pi) — lifecycle noise, now consumed instead of surfaced.

Any future harness or tool must be validated the same way. The reference
technique: pull runs with `scripts/extract-assets.sh`, then re-parse each
`raw.jsonl` through the current `EventParser` and confirm no tool lands in
`unknown`.

## Gap 1: tool-call counts (including consumed tools)

**Tool-call counts by category** — how many reads, writes, commands, searches,
subagent spawns a run made — are now _derivable_ from the corrected event stream,
and the comparison must surface them per arm. This is often the whole story: a
harness that re-reads the same files, or shells out far more than it needs to,
shows it here.

One subtlety makes a naive count wrong. Some tools are **recognized and
deliberately consumed** — they emit no event because they touch no workspace state.
The clearest case is the **todo tools** (`todowrite`/`todoread`, and Goose's `todo`
extension): Kilo called `todowrite` **53 times** across three Carom runs. Those are
real API round-trips that cost real tokens, and a tool-call view built purely from
the emitted event stream would show **zero** of them. For the comparison
diagnostics, count **every tool invocation the model made**, including consumed
ones — either by counting raw tool events before the consume step, or by having the
consumed-tool paths still record a count while emitting no semantic event. Silent
consumption is correct for the activity feed but wrong for a cost diagnostic.

## Gap 2: per-turn token attribution

Run-level token totals answer "how much" but not "on what." The raw streams of the
third-party harnesses **do** carry per-turn usage — Pi emits it on each
`message_end`, Kilo/OpenCode on each `step_finish` — but it is currently **summed
away** into a single run-level total by `parse_session_usage`
(`crates/core/src/harness_registry.rs`), and the event translator discards the
per-turn usage records entirely.

Capturing it means:

- Adding a **usage/turn event** to the [`EventKind`](/components/core/events/) enum
  — a non-gg analogue of gg's per-turn `Usage`/`TurnStarted` telemetry.
- Having each `parse_*` function (`parse_pi`, `parse_kilo`, `parse_opencode`,
  `parse_codex`, `parse_claude`, `parse_cline`, `parse_goose` in
  `crates/core/src/event.rs`) **emit** that per-turn usage instead of dropping it,
  and `parse_session_usage` retain per-turn slices rather than only the summed
  total.

With per-turn usage in hand, the comparison can plot tokens-per-turn and
cost-per-turn across a run and attribute spend to phases (the cache-miss ratio and
reasoning-token share are usually where a 6× gap lives), matching what
[gg's request-metrics graphs](/gg/telemetry/) already show for gg runs.

## Presentation

Per arm, the diagnostics view presents, for the arm as a whole and drillable to
each run:

- the **token breakdown** by class, with the cache-hit ratio and reasoning share;
- **tool-call counts** by category, including consumed tools (Gap 1);
- **per-turn** token and cost curves (Gap 2);
- **cost** (`comparable`), run time, and — for a gg arm — the per-slot rollup from
  `gg_summary` (`GgSlotCost`).

As everywhere else in this feature, the view **presents** these numbers; it draws
no conclusion about which arm is "better." See
[statistics](/comparisons/statistics/) for how the per-run diagnostics are
summarized across an arm's `N` runs.
