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

- **`owned`** (the default) — the holder's prompt carries the module. Its system-prompt
  section is rendered, and the pinned block it keeps (the memory index, the task list, the
  board) is refreshed into the window on that module's own schedule. This is how every
  capability behaved before ownership was configurable, so a configuration that says
  nothing keeps behaving exactly as it did.
- **`unowned`** — the module is reachable through the holder's **tools and nothing else**.
  No system-prompt section, no pinned block. Its state is still completely live: the tools
  read and write it, its telemetry still reaches the console, and it is still copied and
  transferred like any other module. It simply costs the holder no context until it asks.

An unrecognized value falls back to `owned` and is reported as a launch **warning**, never
a launch failure — the same way every other unrecognized capability *value* is treated.

Unowned is worth reaching for when a module is not really *about* the agent holding it: an
agent given a working store it should be able to act on, but that it should not be paying
for in every request it makes.

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
  reads.

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

Two rules about limits:

- **Caps tighten forward only.** Contents already over a newly-resolved cap are **kept**, and
  it is the next write that is refused. Deleting a memory because the successor's profile is
  stingier would lose work the run already paid for.
- **The window's system prompt is never inherited.** A system prompt states the toolset, the
  roster and the ending calls of the agent it was rendered for, so a transferred window has
  item 0 replaced with the successor's. Everything behind it — the whole thread — is exactly
  what the successor is meant to keep, and the turn counter is never renumbered.
