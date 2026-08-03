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

- **Scope.** A task list is **per agent instance** — one agent's own plan, even in
  `issues` mode. The board is **run-global**, shared by every agent.
- **Dispatch.** Tasks are **never auto-dispatched**; an agent works its own list.
  Board issues **auto-dispatch** — gg spawns a dedicated top-level agent for each one
  as its blockers clear.

So `issues` mode gives a task the *shape* of a board issue without the *behaviour*:
it is still the agent's own to-do, not a work item the run will staff on its own.

## A list can outlive the instance that wrote it

"Per agent instance" is about who may *write* it, not about how long it lasts. A task
list is a [module](/gg/modules/), so it moves the way modules move: an
[FSM transition](/gg/fsms/) whose edge names `tasks` hands the list to the next state's
agent **in exactly the state it was in** — the completions, the blocked-by edges, the
mode — rather than as a summary somebody had to write. An [`exec`](/gg/fork-and-exec/)
carries it whenever both profiles have the capability, and a `fork` gives the copy its
own independent list that diverges from that moment.

What never happens is two agents writing one list at the same time. Unlike
[memories](/gg/memories/#scoping-whose-memories-are-these), a task list has no shared
scope: task ids are model-authored, so two live writers would mint the same id for two
different pieces of work and there would be no merge that could tell them apart.

Tasks are the one module-backed capability with **no [`ownership`](/gg/modules/#ownership)
param**. The list is always carried in its holder's prompt, as its own message, refreshed at
every turn boundary — it is what the agent steers its work by from one turn to the next, so
being handed it every turn is what the capability *is*.
