---
title: "Modules"
---

A module is one unit of per-agent state with defined rules for four questions:
what it contributes to its holder's prompt, what it reports as telemetry, how it
is copied, and what happens to it when a different agent takes it over.
Everything an agent instance holds is a module: its conversation window, its
memories, its task list, its handle on the board, what it has read from the
skills catalogue, and its thread archive.

There are six kinds, and the list is closed.

| Kind | What it holds |
| --- | --- |
| `history` | The agent's conversation window: every message, open view and pinned block. Always present. |
| `memories` | The [memories](/gg/memories/) it curates, under whichever strategy the capability configures. |
| `tasks` | The [task](/gg/tasks/) list, a blocked-by DAG. |
| `board` | The [project-management](/gg/project-management/) board. Run-global: every holder holds the same board. |
| `skills` | The [skills](/gg/skills/) catalogue and the set of skills read so far. |
| `archive` | The thread archive [`archive_thread`](/gg/agent-managed-context/) fills and `search_archive` reads. |

## Ownership

Two module-backed capabilities read an `ownership` param:
[`project-management`](/gg/project-management/) for the board and
[`agent-managed-context`](/gg/agent-managed-context/) for the thread archive.

```jsonc
{ "id": "project-management", "enabled": true, "params": { "ownership": "unowned" } }
```

- `owned`, the default, means the holder's prompt carries the module. Its
  system-prompt section is rendered, and the pinned block it keeps is refreshed
  into the window on that module's own schedule.
- `unowned` means the module is reachable through its tools alone. Its state
  stays live: the tools read and write it, it is copied and transferred like any
  other module, and its telemetry is unchanged. What the model still gets is
  each tool's own schema and description.

An unrecognized value resolves to `owned` and is reported as a launch warning
rather than a launch failure, in line with every other unrecognized capability
value.

Unowned suits a store an agent should be able to act on without paying for it in
every request it makes. One case applies it without configuration: an agent
whose profile has no project-management capability holds the run's board
unowned, so it is not shown a decomposition it has no tool to act on.

The other four kinds read no ownership param, and a param set on their
capabilities is ignored. A window is its holder's prompt. A task list is what an
agent steers by from turn to turn, so it is always carried as its own message.
For memories the [strategy](/gg/memories/) already decides what the store puts
in the window, and for skills the catalogue is the only route an agent has to
knowing which skills exist.

## Copying

There are two ways to copy a module.

- Fork produces an independent copy: a new backing store, deep-copied
  contents, and monotonic counters carried forward rather than restarted. The
  two copies diverge from the moment the fork is made, and neither sees the
  other's writes. A fork leaves undrained telemetry with the original, so one
  write is one event on the stream of the agent that made it.
- Share produces a linked handle on the same store. What one holder writes,
  the other reads. A new holder's watermarks start at the store's current head,
  so it is not handed a backlog of everything that happened before it existed,
  and each holder reports only its own writes.

Two kinds override the choice. The board is always shared, because two boards
would each keep their own per-prefix issue counter and both hand out `ABC-4` for
two different pieces of work in a run whose logs, briefs and agent names all
quote that id. The window is never shared, because the turn loop holds it
exclusively for the whole of a turn; asking to share one yields an independent
copy.

The skills module is copied in halves. The catalogue is immutable and always
shared. The read set, which records which skill bodies are already pinned in the
window, follows the window it describes: a fork copies it and a share aliases
it.

[`fork`](/gg/fork-and-exec/) clones a whole set for a copy of the agent that
made it, applying these rules per kind. A copy therefore gets an independent
window and task list, a shared board, and memories that follow the forker's
[scope](/gg/memories/). The copy's memories are re-stamped with the copy's own
agent id, so its writes are attributed to it.

The [code an agent has loaded](/gg/skills/#code-skills) by reading a code skill
or memory is not a module. It holds no context, is never summarized and is never
transferred; a new instance starts with nothing bound and re-reads what it
wants.

## Transfer

Handing a live module to an agent running under a different profile is a
transfer, and it happens two ways. An [FSM transition](/gg/fsms/) carries
exactly the modules the edge names, and everything else the outgoing instance
held is dropped. An [`exec`](/gg/fork-and-exec/) carries every kind both
profiles have, drops what the successor's profile turns off, and starts fresh
whatever only the successor has.

Per kind, one of four things happens:

1. Carried. The module moves across live, with its contents, and is
   re-resolved against the receiving profile: its caps, its mode, and its
   ownership where it has one.
2. Dropped. The receiving profile does not enable the capability.
3. Dropped and re-initialized. The receiving profile configures the
   capability in a shape the contents cannot be read under, so a fresh module is
   started and the successor is told why in its opening note. The concrete case
   is a [memory strategy](/gg/memories/) mismatch: a scratchpad is not
   re-rendered as a markdown index, because that would change both what the
   store means and which tools read it.
4. Initialized fresh. The receiving profile enables a capability the
   predecessor did not hold.

Two rules govern limits. A transfer re-points a store's caps only when the
module's holder is its sole holder, since a store several agents curate together
has one set of limits by construction. And caps tighten forward only: contents
already over a newly resolved cap are kept, and it is the next write that is
refused.

The window's system prompt is never inherited. A system prompt states the
toolset, the roster and the ending calls of the agent it was rendered for, and
it sits in a slot of its own that renders first on every request rather than in
the thread. A window crosses a transfer or a fork with that slot empty, and the
successor's loop fills it with its own before its first turn. The whole thread
is what the successor keeps, and the turn counter is never renumbered.

Only an FSM transition names modules explicitly, and the six kind names are the
vocabulary its `transfer` list is written in. The console's state editor renders
them as a checkbox each. A name that is not one of the six is dropped with a
launch warning rather than failing the machine, and a name the outgoing agent
does not hold is reported the same way.

## Telemetry

A module's telemetry is attributed to its holder, which is what keeps the
console's per-agent panels honest when a store has more than one. A write is
reported once, on the stream of the agent that made it. Every other holder
re-emits its own state snapshot instead, because its panel changed while the
work was not its own. An unowned module reports everything an owned one does:
ownership decides what reaches the model, never what reaches the record.

A module that is dropped is drained onto the outgoing agent's stream before it
goes, and every module the successor ends up with re-states itself on the
successor's stream as soon as it arrives. The console reduces per agent, so a
module that arrived silently would leave the successor's panel empty for the
rest of the run.

## Store identity

Every backing store carries an id, such as `memories-2`, `tasks-0` or `board-0`,
minted once per kind for the life of the run. The id belongs to the store rather
than to the holder: two holders reporting the same id are holding one store, and
two ids are two stores that may merely happen to agree.

The id follows the store through every operation above. A share keeps it, a fork
mints a new one, and a transfer carries the one it was handed. The one transfer
that swaps the store underneath a successor, a `shared` memories binding
re-pointing to the successor's own profile, reports the new id.

Each agent instance reports its whole set as it opens: one roster row per kind,
naming the store it bound, whether the capability is on, whether its prompt
carries it, how it came by it (created, inherited, profile, run, transferred or
forked), and, for memories, the scope it declared and whether it may write. A
roster cannot change within an incarnation, since every operation that changes
what an agent holds mints a new agent id, so it is stated once and never
restated. See [Telemetry](/gg/telemetry/overview/) for the events.

## Inspecting modules in the console

A module instance is not one-to-one with an agent instance, so three surfaces
read the same folded model at three grains. Between them they answer which
instances share a store, when it was handed on or copied, whether it is owned or
reachable through its tools alone, and whether anything is in it. A store
described as shared by four holders on one surface reads the same way on the
other two.

### Instances tab

Every agent instance's folder carries a `modules` folder, closed by default,
holding one file per module it holds in kind order. It sits after the agent's
own files (Overview, Prompt, Surface, Activity, Context, Requests, Metrics and
Compaction) and before that instance's successors and its `subagents`.

A row whose store is held by more than one instance at once carries a link glyph
and that count. A store that merely passed from one instance to the next is
annotated handed on and is counted as shared nowhere. Sharing is read off
the holders whose origin is not `transferred`, the ones that joined the store
rather than replacing its previous holder; without that rule every `exec` would
look like sharing and an [FSM](/gg/fsms/) run would turn one conversation window
into an N-holder store.

The `history` file carries the window's message log itself, the same
turn-by-turn view the Requests file renders. Every other kind's file states its
figures the way the Modules tab's overviews do: a row of large values over muted
labels.

Each file leads with an identity strip carrying the store's id, its kind, its
ownership, how this holder came by it, its read access, everything that has
happened to it, what it costs this window every turn and what it costs across
every live holder, and a chip per co-holder that opens that instance's same
file. An unowned module says in words that this agent holds it while its prompt
does not carry it. A store every holder has let go of is badged dropped.

The strip's link to the Modules tab is offered only when the run has that tab.
Every instance of every run holds a window, so a `modules/history` file exists in
runs the tab is not offered for.

### Modules tab

The Modules tab sits between Instances and Project and is offered whenever any
profile enables a module-backed capability. It groups module instances by kind,
and a store shared by four agents is one row however many hold it.

Each kind's group leads with an overview covering how many stores exist, how
many holders they have between them and how many are still running, how many are
genuinely shared and how widely, what they cost every turn summed over the
windows carrying them, how many were never written to, and every store side by
side.

Two figures are withheld where they would be a lie rather than a zero. History
reports no "holding nothing" figure, because a window reports itself per turn as
a context breakdown rather than as a snapshot of a store. And a per-turn cost of
zero is distinguished both from an unmeasured one and from the archive, which
has no context band by construction.

Selecting a store reads it in five sections: its identity; its holders, each
with its origin, read access, ownership and what the module costs that
instance's window; its lifetime, oldest first, each entry naming the succession
that caused it; its cost per holder against the summed live figure; and its
contents, taken from the store's own snapshot. History and archive report no
snapshot, so their contents are read off their holder's stream.

Holder ids link into the Instances tab at that agent's own `modules/<kind>`
file, and profile names into the Agents tab. The Instances module file links
back.

### Agents tab

The Agents tab reads the run per configured profile, which is the grain a
configuration is tuned at. A Modules section under each profile's instance
chips carries one row per kind, badged by how the stores are distributed:

| Badge | What it means |
| --- | --- |
| agent-scoped | One store, bound by every instance at once. The contents belong to the agent, so they are shown inline. |
| per instance | Every instance holds its own. Nothing is shown inline; Compare in Modules puts them side by side. |
| handed on | One store, held one instance at a time. It has several holders and is not sharing. |
| run-global | The store reaches beyond this profile: the board, or a store a spawner of another profile owns. |
| split | Several stores, at least one genuinely shared. Usually worth opening. |

Where the declared configuration and the observed distribution disagree, the row
carries a note naming both and the likely cause: a `scope: inherited` whose
instances each got their own, a `shared` profile re-bound mid-run by a
succession, or holders disagreeing about ownership after a transfer. Each of
those is a legal configuration, so it is a note rather than an error. Notes are
written only for a run that reported its rosters.
