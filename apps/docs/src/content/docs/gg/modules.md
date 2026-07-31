---
title: "Modules"
---

Everything an agent instance *holds* — its conversation window, its memories, its task
list, its handle on the board, what it has read from the skill catalog, its thread
archive — is a **module**. A module is one unit of per-agent state with defined rules for
four questions: what it puts in the prompt, what it reports as telemetry, how it is
copied, and what happens to it when a different agent takes it over.

There are six kinds, and the list is closed:

| Kind | What it holds |
| --- | --- |
| `history` | The agent's conversation window — every message, file view and pinned block. Always present. |
| `memories` | The [memories](/gg/memories/) it curates, under whichever strategy the capability configures. |
| `tasks` | The [task](/gg/tasks/) list — the blocked-by DAG it steers by. |
| `board` | The [project-management](/gg/project-management/) board. Run-global: every holder holds the *same* board. |
| `skills` | The [skills](/gg/skills/) catalog and the set of skills read so far. |
| `archive` | The thread archive [`archive_thread`](/gg/agent-managed-context/) fills and `search_archive` reads. |

## Ownership

Every module-backed capability reads an **`ownership`** param:

```jsonc
{ "id": "tasks", "enabled": true, "params": { "ownership": "unowned" } }
```

Five capabilities carry it, one per module a configuration can turn on:
[`memories`](/gg/memories/), [`tasks`](/gg/tasks/),
[`project-management`](/gg/project-management/) (the board), [`skills`](/gg/skills/), and
[`agent-managed-context`](/gg/agent-managed-context/) (the thread archive). The sixth
module, `history`, has no capability behind it and no ownership to configure: an agent's
window *is* its prompt.

- **`owned`** (the default) — the holder's prompt carries the module's **state**: the
  pinned block it keeps — the memory index, the task list, the board — is refreshed into
  the window on that module's own schedule, and skills contribute their up-front catalog
  listing. This is how every capability behaved before ownership was configurable, so a
  configuration that says nothing keeps behaving exactly as it did.
- **`unowned`** — none of that reaches the window. No pinned block, no catalog listing, no
  [linked-memory notice](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote).
  Everything else is untouched: the tools are still offered, the store is still read and
  written through them, the telemetry still reaches the console, and the module is still
  copied and transferred like any other. It simply costs the holder no context until it
  asks.

What ownership does **not** change is the system prompt's instructions for the capability.
An unowned module still has its tools, and a model handed `add_task` with nothing telling
it what a task list is for would use it worse than one told nothing at all. So the prompt
still explains the capability; what it stops doing is handing over the contents every turn.
[Skills](/gg/skills/) are the one place the two are the same thing — the catalog *is* the
state — so an unowned skills module has no menu in the prompt, and `read_skill` reads a
skill by name for an agent that was never shown the list.

An unrecognized value falls back to `owned` and is reported as a launch **warning**, never
a launch failure — the same way every other unrecognized capability *value* is treated.

Unowned is worth reaching for when a module is not really *about* the agent holding it: an
agent given a working store it should be able to act on, but that it should not be paying
for in every request it makes. The extreme case is a module that pins nothing in the first
place — the thread [archive](/gg/agent-managed-context/) — where ownership is recorded and
carried but there is nothing in the window for it to withhold.

One case applies it for you: an agent whose profile has **no project-management
capability** holds the run's board unowned. It is still on the same queue — an issue it was
dispatched for is on that board — but it is not shown a whole decomposition it has no tool
to act on.

## Copying: forking and sharing

There are exactly two ways to copy a module, and they are different things:

- **Fork** — an **independent** copy. New backing store, contents deep-copied, monotonic
  counters (a memory's revision numbers, an archive entry's ordinal) carried forward rather
  than restarted. The two copies diverge from the moment the fork is made, and neither can
  see the other's writes. A fork never duplicates telemetry the original has not yet
  reported: one write is one event, on the stream of the agent that made it.
- **Share** — a **linked** handle on the same store. What one holder writes, the other
  reads. A new holder's watermarks start at the store's current head, so it is not handed a
  backlog of everything that happened before it existed, and each holder reports only what
  *it* did — see [linked memories](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote),
  the one place a share is reachable from a configuration today.

Two kinds override the choice, and the reasons are worth knowing:

- The **board** is always shared, even when something asks it to fork. Two boards would each
  keep their own per-prefix issue counter and would both hand out `ABC-4`, for two different
  pieces of work, in a run whose logs, briefs and agent names all quote that id.
- The **window** can never be shared. The turn loop holds it exclusively for the whole of a
  turn; a second writer would be interleaving messages into a thread mid-turn. Asking to
  share one gives an independent copy.

The **skills** module is copied in halves: the catalog is immutable and always shared, while
the *read set* — the record of which skill bodies are already pinned in the window — follows
the window it describes. A fork copies it; a share aliases it.

## Transfer

Handing a live module to an agent running under a **different profile** is a transfer. Per
kind, one of four things happens:

1. **Carried** — the module moves across live, with its contents, and is re-resolved against
   the **receiving** profile: its caps, its mode, its ownership. A module still carrying
   limits resolved from the profile that produced it is the bug this rule exists to prevent.
2. **Dropped** — the receiving profile does not enable the capability. Turning a capability
   off is what "this agent does not get one" means.
3. **Dropped and re-initialized** — the receiving profile configures the capability in a
   shape the contents cannot be read under, so a fresh one is started and the successor is
   *told why* rather than left to discover an empty store. The concrete case is a
   [memory strategy](/gg/memories/) mismatch: a scratchpad cannot be re-rendered as a
   markdown index without silently changing both what it means and which tools read it, so gg
   states the reset instead of performing a conversion nobody asked for.
4. **Initialized fresh** — the receiving profile enables a capability the predecessor did not
   hold.

One rule about caps applies only to a transfer, not to a share: a store several agents are
curating **together** has one set of limits by construction, so a transfer re-points them
only when the module's holder is its sole holder. Re-pointing them because one holder was
replaced would silently change what the others may write.

Two rules about limits:

- **Caps tighten forward only.** Contents already over a newly-resolved cap are **kept**, and
  it is the next write that is refused. Deleting a memory because the successor's profile is
  stingier would lose work the run already paid for.
- **The window's system prompt is never inherited.** A system prompt states the toolset, the
  roster and the ending calls of the agent it was rendered for, so a transferred window has
  item 0 replaced with the successor's. Everything behind it — the whole thread — is exactly
  what the successor is meant to keep, and the turn counter is never renumbered.

## Who copies and who transfers

A **transfer** happens when one agent instance hands over to another, and there are two ways
that happens:

- An [FSM transition](/gg/fsms/) carries exactly the modules the edge names, and everything
  else the outgoing instance held is dropped. The list is explicit, so a recorded
  configuration says what it does.
- An [`exec`](/gg/fork-and-exec/) carries every kind **both profiles have**, drops what the
  successor's profile turns off, and starts fresh whatever only the successor has. The model
  chooses when, and the rule is fixed rather than declared.

A **fork** is the other half: [`fork`](/gg/fork-and-exec/) clones a whole set for a copy of
the agent that made it, using the fork/share rules above per kind — an independent window and
task list, a shared board, and memories that follow the forker's
[scope](/gg/memories/#scoping-whose-memories-are-these).

Only an FSM transition names modules explicitly, and the six kinds above are exactly the
vocabulary its `transfer` list is written in — `history`, `memories`, `tasks`, `board`,
`skills`, `archive`. The console's [state editor](/gg/fsms/#authoring-one-in-the-console)
renders them as a checkbox each. A name that is not one of the six is dropped with a launch
warning rather than failing the machine: one mistyped word should not stop a run whose other
nine edges are fine.

## What a module reports

A module's telemetry is attributed to **its holder**, which is what keeps the console's
per-agent panels honest when a store has more than one. A write is reported once, on the
stream of the agent that made it; every other holder re-emits its own state snapshot
instead, because its panel changed but the work was not its own. An **unowned** module
still reports everything — ownership decides what reaches the *model*, never what reaches
the record.

The other half of that rule is what happens on a handoff: a module that is dropped is
drained onto the outgoing agent's stream before it goes, and every module the successor
ends up with — carried or fresh — re-states itself on the successor's stream as soon as it
arrives. The console reduces per agent, so a module that arrived silently would leave the
successor's panel empty for the rest of the run.
