---
title: "Agent-managed context"
---

Give each agent **agency over its own context window** rather than managing it
implicitly.

- An agent is **told how full its context window is**, as an explicit signal it can
  act on (this signal comes from [context visibility](/gg/context-visibility/)).
- An agent can **evict file views** it no longer needs, reclaiming context.
- An agent can **archive a section of its thread** (its history): the data is
  removed from the live context but **remains searchable**, so it is recoverable
  without occupying the window.

This is the model-facing complement to [compaction](/gg/compaction/): compaction is
the automatic backstop when the window fills; agent-managed context lets a
disciplined agent avoid ever hitting it.

Agent-managed context is an **opt-in** capability (`agent-managed-context`), like
compaction — a run must name it in its capability set. When it is off, none of the
tools below are offered, no fullness signal is injected, and the ablation's off arm
behaves exactly as a run without the feature.

## The fullness signal

Each turn — after the pinned blocks (skills, memories, tasks) are refreshed and after
any [compaction](/gg/compaction/) — gg rebuilds a short, **system-adjacent** line from
the *current* window accounting and pins it just before the model acts:

> Context window: 74210/128000 tokens (58% full). Largest consumers (tokens): file
> views 41000, tool output 12000, history 8000. If it is getting full, reclaim space
> yourself: `evict_file_view` … `archive_thread` … `search_archive`.

It reflects the live [`ContextModel`](/gg/context-visibility/) each turn, names the
biggest consuming [sources](/gg/context-visibility/) so the agent knows *where* the
window is going, and is refreshed **in place** (never accreting turn over turn) so it
stays cheap — one short line whose own cost is excluded from the numbers it reports.

## Evicting file views

`evict_file_view` drops the contents of files the agent has read (the
`FileView`-sourced items `read_file` produced) from the **live** window, reclaiming
their tokens. This is safe: the files are unchanged on disk and can be re-read at any
time.

- `evict_file_view { path }` evicts the views of that one workspace path.
- `evict_file_view {}` (no `path`) evicts **every** file view.

The tool result reports what was reclaimed, and the next
[context breakdown](/gg/context-visibility/) shows the file-view band fall.

## Archiving the thread, and searching it back

`archive_thread` moves older thread material out of the live window into a **searchable
archive**, then `search_archive { query }` recovers it on demand — the full text, never
a summary, reachable without occupying the window.

**Selection model.** `archive_thread { keep_recent_turns? }` archives the *oldest*
ephemeral thread material, keeping the most recent `keep_recent_turns` **assistant
turns** live (default `1` — keep the current turn, archive everything older). A turn is
each `Assistant` message and the tool results and file views that follow it; a leading
run of items with no preceding assistant (such as a prior compaction summary) forms the
oldest turn. `keep_recent_turns: 0` archives all ephemeral history; a value at least the
number of turns archives nothing. The **pinned** prefix — the system prompt, the build
prompt, read skills, memories, the task list, and the fullness signal — is never
archived. This is a clean, predictable "section": *everything but my most recent
turn(s)*.

The archive is append-only and grows for the life of the session; `search_archive` does
a case-insensitive substring match over each archived message's text (including the tool
calls it made) and returns the matching entries, capped so a broad query cannot itself
refill the window.

## What the console sees

Evict and archive each emit a `ContextManaged` telemetry event carrying the `action`,
the `reclaimedTokens`, the number of `items` removed, and a human-readable `detail`
(the evicted paths, or how many turns were archived and the archive's new size). The
underlying `ToolCall`/`ToolResult` still stream too; the `ContextManaged` event carries
the *effect*, which the console draws as a marker on the timeline and the context graph
next to the band drop the following breakdown shows. `search_archive` reclaims nothing,
so it is reported only as an ordinary tool result.
