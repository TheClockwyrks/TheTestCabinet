---
title: "Context visibility"
---

gg **tracks what is consuming the context window**, broken down by source: skills,
memories, file contents, the thread/history, tool output, and so on.

- Internally this is the accounting that powers the fullness signal in
  [agent-managed context](/gg/agent-managed-context/) and the trigger in
  [compaction](/gg/compaction/).
- Externally this breakdown is streamed as [telemetry](/gg/telemetry/) and rendered
  in the console as a **stacked line graph** showing how an agent's context window
  fills over the course of a run, by category.

## The window renders as an append-only prompt

Several of the window's blocks are **mutable**: the memory block, the task list, the
epic/issue board, and the fullness signal are each rebuilt from their backing store at
every turn boundary so the model always sees current state. Each is a *single* block —
rebuilding it means dropping the old copy and appending the new one, so it lands after
the history that has accumulated since.

That rebuild is skipped when the block comes back **byte-identical**, and the existing
block keeps its position. This matters far more than it sounds like it should, because
of how provider **prompt caches** work: a request only reads the cache for a prefix the
provider has already seen, which in practice means the turn's message list has to
*extend* the previous turn's. Moving an unchanged block to the tail rewrites the prompt
just before its end, so no turn ever extends the last one and **every turn re-reads its
entire context as uncached input** — on a long run, most of its token bill.

So gg holds an unchanged block still and lets the history grow behind it. A block that
genuinely changed does move to the tail, costing that one turn its cache — which is also
the one turn where the block has something new to tell the model. The same rule is why
the fullness signal reports [rounded figures](/gg/agent-managed-context/): a line that
moved by a handful of tokens would otherwise churn the tail every turn on its own.

A [compaction](/gg/compaction/) boundary rewrites the window wholesale and necessarily
resets the cache with it.
