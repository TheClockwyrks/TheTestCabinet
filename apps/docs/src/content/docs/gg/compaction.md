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
