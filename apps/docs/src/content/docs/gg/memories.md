---
title: "Memories"
---

Memories are **essentially the same as [skills](/gg/skills/)** — description shown
up front, body retained across [compaction](/gg/compaction/) — with one difference:
they are **curated by the model itself** rather than authored ahead of time. The
model writes and updates its own memories as it works.

Because the model controls them, gg must **bound them**:

- a cap on the **number** of memories, and
- a cap on their **length** (individually and/or in aggregate),

so that self-curated memory cannot crowd out the working context. When a cap is
hit, the model must revise or evict rather than simply accrue.

This is deliberately analogous to how The Test Cabinet's own agent memory works
(one fact per file, with an index) — gg gives the *model under test* the same
affordance.
