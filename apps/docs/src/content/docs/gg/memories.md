---
title: "Memories"
---

Memories are **essentially the same as [skills](/gg/skills/)** — a description
shown up front, a body that survives [compaction](/gg/compaction/) — with one
difference: they are **curated by the model itself** rather than authored ahead
of time. The model writes and updates its own memories as it works.

Because the model controls them, gg must **bound them**, so that self-curated
memory cannot crowd out the working context. When a limit is hit, the model must
revise or evict rather than simply accrue.

This is deliberately analogous to how The Test Cabinet's own agent memory works
(one fact per file, with an index) — gg gives the *model under test* the same
affordance.

## The store is gg's, not the workspace's

Under every strategy the memories live **inside gg and nowhere else**. Two of the
strategies talk about an "index file" and "memory files" because that is the
mental model a model already has, but nothing is written to disk: the memory
tools are the only way to create, read, revise or remove one. That is what makes
the index trustworthy — a model cannot rewrite its own index behind gg's back by
writing over a file, and gg's accounting of what the window holds can never
disagree with what is stored.

## The three strategies

The capability's `implementation` selects the **memory strategy**. They differ in
what is *always* in the context window, which is the variable the strategies exist
to compare: memory you are handed every turn, memory you can see the titles of, or
memory you have to go looking for. An unrecognized name resolves to `scratchpad`
rather than failing the run.

| Strategy | Always in context | Tools |
| --- | --- | --- |
| `scratchpad` (default) | every memory, body and all | `write_memory`, `update_memory`, `delete_memory` |
| `markdown` | the index (one `slug` — `description` line per memory) | `create_memory`, `read_memory`, `edit_memory`, `delete_memory` |
| `keyword-search` | nothing | `create_memory`, `read_memory`, `edit_memory`, `delete_memory`, `search_memories` |

All three work in both execution modes. Under
[responses-as-code](/gg/responses-as-code/) the same functions are methods on the
`memory` object (`memory.createMemory`, `memory.searchMemories`, …), and only the
active strategy's are bound into a program's scope, so `memory.list()` is an
honest answer to "what can I do with memory here?".

### `scratchpad`

A small, curated set whose **bodies are all pinned** in the window and cross a
compaction boundary verbatim. Memory you never have to look up, and context you
pay for continuously — which is why it is bounded on all three axes (count, each
body, and their total).

### `markdown`

An **index** over markdown files. The index is pinned; the memories themselves are
not, so the model reads one when it needs it. `create_memory` adds the entry and
`delete_memory` removes it — the model can never write the index directly.

The index is what bounds the population: a create whose entry would push the index
over its limit is refused, and the refusal tells the model to delete a memory
rather than to shorten the one it is writing. There is no separate count limit,
because every memory must have a line in the index anyway.

### `keyword-search`

Markdown files with **no index at all**: nothing about them is in the window until
the model looks. `search_memories` takes an array of keywords and ranks the
matches by how many distinct keywords a memory mentions, then by how often — plain
case-insensitive substring matching over each memory's slug, description and
contents. Each hit carries a short excerpt; the model reads the ones worth having
in full.

Because there is no index to put one in, a `description` is optional here (when
given, it is shown with search results).

### Editing

The two file-shaped strategies revise a memory by **search/replace**, exactly as
`edit_file` does: the model quotes the text it is changing, which must appear
exactly once. Appending is quoting the last line and replacing it with itself plus
what is being added. An edit that would leave the memory **empty** is refused and
told to delete it instead — a deletion is a decision, not something gg infers from
an edit.

## Limits

Every limit is set through the capability's `params`, and **`0` disables it**
(unlimited). A param a strategy does not use is ignored, so one sweep can hand
every arm the same params block.

| Param | Applies to | Default |
| --- | --- | --- |
| `maxCount` | `scratchpad`, `keyword-search` | 8 / unlimited |
| `maxLenPerMemory` | all three | 2 000 / 8 192 / 8 192 |
| `maxTotalLen` | `scratchpad` | 8 000 |
| `maxLenIndex` | `markdown` | 16 384 |
| `maxLenDescription` | all three | unlimited |
| `maxResults` | `keyword-search` | 25 |

Lengths are in characters of a memory's **body**; a description is a short
one-liner and is not counted against them (it is counted in the index, which is
what `maxLenIndex` measures).

`maxLenDescription` is the one exception, and the only limit that is **off by
default**. It bounds the description itself, under every strategy — worth setting
on a `markdown` run, where every description is a line of the pinned index and one
verbose one-liner is a cost the window pays on every turn. An over-long
description is refused, never truncated, and is checked before the body limits so
a call that breaches both is told about the cheaper fix first.

For example, a markdown run with a small index and no per-memory limit:

```json
{
  "id": "memories",
  "enabled": true,
  "implementation": "markdown",
  "params": { "maxLenIndex": 4096, "maxLenPerMemory": 0 }
}
```

## Compaction

Memories survive a compaction boundary under every strategy — that is the point
of them. What crosses *in the window* is what the strategy pins: every body under
`scratchpad`, the index alone under `markdown`, nothing under `keyword-search`
(where the memories are still stored, and still findable, on the other side).

The [`memory-compaction`](/gg/compaction/) strategy, which asks the agent to
record its working state instead of writing a summary, asks for the calls the
run's memory strategy actually offers.

### The pinned block is rebuilt at a boundary, and only there

A memory the model just wrote is already in front of it — the call it made and
the confirmation it got back are both in the thread — so re-sending the block the
turn after a write tells it nothing it does not already know. What it *does* cost
is a fresh copy of every memory (or of the whole index) every time the model
curates, which on a long run is most of what memory spends.

So between boundaries gg leaves the block exactly as it is, and lets the thread
carry the news. What the thread cannot carry is a compaction, which drops the very
tool results the model was reading its memories out of — so gg rebuilds the block
there, immediately before the window is rewritten. The stale copy is superseded
into the ephemeral history the boundary is about to sweep away, and the fresh one
crosses as part of the pinned prefix. (A plan-mode context reset clears the thread
the same way, and gets the same treatment.)

The consequence to know about is that a pinned index can lag: a memory created
since the last compaction is stored and readable but is not listed there yet. The
system prompt says so, so the model does not read a missing line as a lost memory.

## What gg records

Two things are streamed, and they answer different questions.

The **`memory_state`** event is the set as it stands: every memory currently held
with its description, character count and line count, the totals, the limits in
force, and the run's **peaks** — the most memories, characters and lines ever held
at once. The peaks are there because the live figures alone are misleading: a model
that curates well spends its budget, prunes, and finishes holding almost nothing.

The **`memory_revision`** event is one entry of an append-only record of what the
model *did*: every successful mutation, in order, carrying the memory's text as of
that revision. It is what a snapshot can never show — a memory written and later
deleted, and the earlier wording of one that was revised. Revision numbers are per
slug and keep counting across a delete, so a name that is discarded and re-created
reads as the history it is. A refused mutation records nothing; it did nothing.

The console folds the two together into the Memories panel: current-and-peak
totals, a treemap of every memory ever held sized by its character count, and each
memory — deleted ones included — expandable into its revision history.
