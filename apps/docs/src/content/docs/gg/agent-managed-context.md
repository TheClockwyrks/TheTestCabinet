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
