---
title: "Tasks"
---

A task list is one agent's own record of the work it plans to do: the standard
lightweight agent to-do list, with two hard requirements.

- It is a DAG. A task can be marked blocked by one or more other tasks, and
  the blocking relation is acyclic. gg refuses an edge that would introduce a
  cycle, and a refused call leaves the list unchanged.
- It survives compaction. The list is carried across a
  [compaction](/gg/compaction/) boundary verbatim, so the model keeps its plan on
  a run that goes long.

The list is built and revised with `add_task`, `update_task`, `set_blocked_by`,
`complete_task` and `remove_task`. Under
[responses-as-code](/gg/responses-as-code/overview/) the same calls are the
`gg.tasks` module. Removing a task also strips its id from every other task's
blocked-by set, so no dangling edge is left behind.

The whole list is pinned in its holder's prompt as its own message and rebuilt at
every turn boundary. A task is actionable exactly when every task it is blocked
by is done, and the rendered list marks each open task as ready or as blocked by
the specific tasks still holding it up.

The `maxTasks` param bounds how many tasks the list may hold at once. The default
is 100, and an add beyond the ceiling is refused. A `maxTasks` gg cannot read as
a whole count refuses the launch.

## Modes

A `mode` param sets how much structure a task carries. A `mode` gg does not
recognize refuses the launch, naming the two that exist.

- `simple` (the default): a title and an optional description.
- `issues`: a task carries the same structured sections as a
  [project-management](/gg/project-management/) board issue. A title, an
  in-scope, an out-of-scope and a completion criteria are required, and a
  description stays optional. The explicit scope and completion criteria make
  each task self-describing, which is worth having when an agent is planning
  substantial work for itself.

Both modes are otherwise the same list: an agent-scoped, compaction-surviving
blocked-by DAG.

## Features

Two sliders sit in the capability's Features box, and each is per agent.

| Feature | Default | What switching it changes |
| --- | --- | --- |
| Task dependencies | on | Off withholds `set_blocked_by`, so the list is flat. |
| Revise tasks | on | Off withholds `update_task` and `remove_task`, so the list is append-and-complete only. |

## Tasks and the board

Tasks are the lightweight tier of work tracking, and the
[project-management](/gg/project-management/) board is the heavyweight one. Both
are blocked-by DAGs, and they differ in two ways.

- Scope. A task list belongs to one agent instance, even in `issues` mode.
  The board is run-global, shared by every agent.
- Dispatch. An agent works its own task list. Board issues auto-dispatch: gg
  spawns a dedicated top-level agent for each one as its blockers clear.

So `issues` mode gives a task the shape of a board issue while it stays the
agent's own to-do rather than a work item the run will staff on its own.

## Transfer between agents

Belonging to one agent instance says who may write the list, not how long it
lasts. A task list is a [module](/gg/modules/), so it moves the way modules move.
An
[FSM transition](/gg/fsms/) whose edge names `tasks` hands the list to the next
state's agent in exactly the state it was in, with the completions, the
blocked-by edges and the mode intact. An [`exec`](/gg/fork-and-exec/) carries it
whenever both profiles have the capability, and a `fork` gives the copy its own
independent list that diverges from that moment.

A receiving profile re-resolves `maxTasks` and `mode` for the list it adopts.
Both modes read the same DAG, so only a new task is held to the receiving
profile's rule. A list already longer than a newly tightened ceiling is kept, and
the ordinary cap check refuses the next `add_task`.

One agent writes a list at a time. Task ids are model-authored, so two live
writers would mint the same id for two different pieces of work. Ownership is
likewise fixed: the list is always carried in its holder's prompt, since it is
what the agent steers its work by from one turn to the next.

## Telemetry

`tasks_state` carries the whole DAG: every task's id, title, description,
structured sections, status and blocked-by set, attributed to the module instance
rather than to the holder, so two agents holding one list report one id. It is
emitted at session start as an empty list and again after every successful
mutation.
