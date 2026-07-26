---
title: "Compaction"
---

When a thread approaches the active model's context-window limit, gg **summarizes
the thread and restarts it from the summary**, so the model can keep working
"beyond" its context window. Compaction is what lets a gg run continue *within* one
logical session instead of needing an [orchestrator](/orchestrators/overview/) to
loop it.

Requirements:

- Trigger when the thread nears the **active model's** window (the threshold is a
  capability parameter, not a constant — and note that with
  [multi-model](/gg/multi-model/) different agents have different window sizes).
- Produce a summary that preserves enough working state for the model to continue
  without losing the thread of what it was doing.
- **Preserve pinned state across the boundary.** Compaction is not just
  summarization — several other capabilities have state that must *survive*
  compaction verbatim rather than be summarized away. Compaction is the capability
  that makes "retained across compaction" mean something.

## Summarization strategies

How the dropped history is summarized is a **swappable strategy**, so a study can
compare which one retains the most useful state without changing anything else
about a run. The compaction capability's **Summarization strategy** field selects
it (empty picks the default):

- **Model summary** (`model`, the default) — one model call that writes a focused
  prose recap of the thread being dropped: what the agent is building, the key
  decisions and discoveries, files changed, what is in progress, and the next
  step.
- **Structured extract** (`structured`) — the same model call, but steered to emit
  that state under fixed headings (`Building`, `Decisions`, `Files`,
  `In progress`, `Next step`) rather than free prose — a more predictable shape to
  compare across runs.

Both carry the pinned state forward verbatim (below); they differ only in how the
*history* is condensed. A run naming a strategy gg doesn't recognize falls back to
the default rather than failing to launch, so a sweep can reference a
not-yet-built strategy without breaking. Adding a strategy is a drop-in behind the
`Summarizer` trait in `crates/gg/src/compaction.rs`.

Every compaction is **recorded per agent** so the strategies can be compared by
what they actually retained. Each boundary carries the strategy that ran, the
fullness that triggered it, the window it reclaimed, the per-source composition
*just before* and *just after* the drop, the retained-state counts, and the
**summary text itself** (with a flag when a failed summarization fell back to
gg's fixed note). The console surfaces this as the per-agent **Compaction** view —
the detail behind the compaction markers on the Context graph — where you can read
each summary side by side with the bands it collapsed. Because the composition is
on the compaction record itself, the view works whether or not
[context visibility](/gg/context-visibility/) is on, live and after the run.

## Enabling compaction shrinks the window the agent gets

Summarizing is itself a model call over (nearly) the whole thread: at the trigger the
summarizer has to fit the transcript **and** write a summary within the same context
window. Measured against the model's full window, a run can therefore trip the
trigger at a point where the compaction meant to save it no longer fits.

So gg makes the reserve explicit. When compaction is on, the window the agent is
given — the denominator of every fullness figure, the graph's ceiling, and the
trigger's basis — is the model's window **less the `summaryHeadroom` fraction**,
20% by default. The agent works against the reduced window; the held-back slice is
the room the summarization round-trip runs in. Against a 200k model that is 160k of
working window, with the default 0.85 trigger firing at ~136k.

With compaction off nothing is reserved, since there is no summarization call to
make room for — which is also why the `no-compaction` [configuration](/gg/configurations/)
is a clean overflow arm: it gets the whole window and simply runs out of it.

`summaryHeadroom` is a capability parameter like the trigger, accepting `0.0`–`0.9`
(a value outside that keeps the default). Set it to `0` to hand the agent the whole
window and accept the risk; raise it for a summarizer whose prompt is heavier than
the default's.

Compaction summarizes the *history* and carries the following state forward
verbatim, forming the fixed prefix of the post-compaction context window:

- **[Skills](/gg/skills/)** — the list of available skills, plus the full contents
  of any skills that have been **read**.
- **[Tasks](/gg/tasks/)** — the active task list.
- **[Memories](/gg/memories/)** — the same treatment as skills: the list, plus the
  contents of those in play.

The [epic/issue board](/gg/epics-and-issues/) is likewise retained across a
compaction boundary. [Agent-managed context](/gg/agent-managed-context/) is the
model-facing complement to compaction: compaction is the automatic backstop when
the window fills; agent-managed context lets a disciplined agent avoid ever hitting
it.
