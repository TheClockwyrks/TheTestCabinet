---
title: "Tasks"
---

A list of items representing work the model wants to do — the standard lightweight
agent to-do list, with two hard requirements:

- **It is a DAG.** An item can be marked **blocked by** one or more other items, and
  the blocking relation must be acyclic — gg must reject an edge that would
  introduce a cycle.
- **It survives compaction.** The task list is carried across a
  [compaction](/gg/compaction/) boundary verbatim, so the model never loses its
  plan just because it ran long.

Tasks are the lightweight tier of work tracking. Their heavyweight counterpart —
[epics & issues](/gg/epics-and-issues/) — is an expansion of the same idea; the two
share the blocked-by DAG concept.
