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

Compaction is a prime candidate for a **swappable summarization tool** so we can
study which strategy retains the most useful state.

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
