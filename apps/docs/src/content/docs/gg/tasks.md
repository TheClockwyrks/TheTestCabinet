---
title: "Tasks"
---

An **agent-scoped** list of items representing work the model wants to do — the
standard lightweight agent to-do list, with two hard requirements:

- **It is a DAG.** An item can be marked **blocked by** one or more other items, and
  the blocking relation must be acyclic — gg must reject an edge that would
  introduce a cycle.
- **It survives compaction.** The task list is carried across a
  [compaction](/gg/compaction/) boundary verbatim, so the model never loses its
  plan just because it ran long.

## Modes

A `mode` param sets how much structure a task item carries:

- **`simple`** (default) — the lightweight case: a **title** and an optional
  **description**, an ordinary to-do.
- **`issues`** — a task requires the **same structured sections as a
  [Project management](/gg/project-management/) board issue**: **title**,
  **in-scope**, **out-of-scope**, and **completion criteria** required, **description**
  optional. The explicit scope and completion criteria make each item self-describing,
  useful when an agent is planning substantial work for itself.

Both modes are otherwise identical: an agent-scoped, compaction-surviving blocked-by
DAG.

## Tasks versus the board

Tasks are the lightweight tier of work tracking. Their heavyweight counterpart is the
[Project management](/gg/project-management/) board, and the two share the blocked-by
DAG concept — but they differ in the two things that matter:

- **Scope.** A task list is **per agent** — one agent's private plan, even in
  `issues` mode. The board is **run-global**, shared by every agent.
- **Dispatch.** Tasks are **never auto-dispatched**; an agent works its own list.
  Board issues **auto-dispatch** — gg spawns a dedicated top-level agent for each one
  as its blockers clear.

So `issues` mode gives a task the *shape* of a board issue without the *behaviour*:
it is still the agent's own to-do, not a work item the run will staff on its own.
