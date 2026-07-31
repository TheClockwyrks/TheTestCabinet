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
- **`unowned`** — none of that reaches the prompt. No pinned block, no catalog listing, no
  [linked-memory notice](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote)
  — and no system-prompt section either: the capability's own paragraphs, its limits and its
  vocabulary are all withheld. Everything else is untouched: the tools are still offered,
  the store is still read and written through them, the telemetry still reaches the console,
  and the module is still copied and transferred like any other.

An unowned module is therefore reachable through its **tools and nothing else**. What the
model still gets is each tool's own schema and description, which is what every tool is
documented by; what it stops getting is a section of every request explaining a store it
may never need, plus the contents of that store on top. That is the whole of the knob, and
it is the reason [skills](/gg/skills/) look no different from the rest here even though for
skills the catalog *is* the state: an unowned skills module has no menu in the prompt, and
`read_skill` reads a skill by name for an agent that was never shown the list.

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

## Identity: which store is this?

Every **backing store** carries an id — `memories-2`, `tasks-0`, `board-0` — minted once
per kind for the life of the run. The id belongs to the store, not to the agent holding
it, and that is the whole of it: **two holders reporting the same id are holding one
store**, and two ids are two stores that may merely happen to agree.

That is a distinction nothing else in the record can make. A share and a fork produce
identical-looking panels on two agents; a scope is a *declared* value, and one that gg
resolves differently in several legal cases (an `inherited` agent with no spawner to
inherit from, a `shared` successor re-bound to its own profile's store). So the id follows
the store through every operation above: a **share** or an **alias** keeps it, a **fork**
mints a new one, a **transfer** carries it, and the one case where a transfer swaps the
store underneath a successor — `shared` memories re-binding to the successor's own profile
— reports the new id, which is what makes the swap visible rather than something to be
inferred from a notebook that changed contents.

Each agent instance reports the whole set as it opens: one **roster** row per kind, naming
the store it bound, whether the capability is on, whether its prompt
[carries](#ownership) it, how it came by it (created, inherited, bound the profile's
instance, bound the run's, carried from its predecessor, received from a fork), and — for
memories — the scope it declared and whether it may write. A roster cannot change within
an incarnation, since every operation that changes what an agent holds mints a new agent
id, so it is stated once and never restated. See
[Telemetry → What an agent holds](/gg/telemetry/#what-an-agent-holds) for the events.

## Inspecting modules in the console

Because a module instance is no longer one-to-one with an agent instance, no per-agent
view can answer the questions a module raises: *which instances share this store, when was
it handed on or copied, is it owned (in the prompt) or reachable through its tools alone,
and is anything actually being put in it?* Three surfaces answer them, at three grains,
over the same folded model — so a store described as "shared by 4 holders" on one reads
the same way on the other two.

### The Instances tab: a `modules` folder per agent

Every agent instance's folder gains a **`modules`** folder — closed by default, sitting
after the agent's own files and before its successors and its `subagents` — with one file
per module it holds, in kind order. A row whose store is held by more than one instance
**at once** carries a link glyph and that count, so *is this shared?* is answered in the
tree without opening anything; a store that merely passed from one instance to the next is
annotated **handed on** instead, and is nowhere counted as shared.

That distinction is the one thing a holder *count* can never make, and it is made the same
way on all three surfaces: sharing is read off the holders whose origin is not
`transferred` — the ones that *joined* the store rather than replacing its previous holder.
Without it every `exec` looks like sharing, and an [FSM](/gg/fsm/) run, where each state is
a succession, turns one conversation window into an N-holder "agent-scoped" store.

What moved, and what did not, follows one rule: a file about the **agent** stayed where it
was, and a file that was really a view onto a **module** moved in. So Overview, Prompt,
Activity, Context, Requests, Metrics and Compaction are unchanged (compaction is not
module-backed — there is no `compaction` module), **Tasks** moved to `modules/tasks`, and
the old joint **Knowledge** file split into `modules/skills` and `modules/memories`, which
were always two independently gated modules shared on entirely different terms. Three
files are new: `modules/board` (this agent's handle on the run's board, with a link to the
Project tab rather than a second copy of it), `modules/history` (how much of the run this
window has seen, over the messages that are in it — the fill graph stays on Context, one
file over), and `modules/archive` (newly possible at all, since the archive reported
nothing before this release).

A window's contents *are* its messages, so the file carries the message log itself — the
same turn-by-turn view the Requests file renders, fed this holder's own stream — rather
than a link to the file that has it. Every other kind's file states its figures the same
way the Modules tab's overviews do: a row of large values over muted labels (a window's
turns and compactions, a memory store's totals and peaks, an archive's entries and what it
reclaimed), so a store's numbers read at one weight wherever they are met.

Each file leads with the same identity strip: the store's id, its kind, owned or unowned,
how *this* holder came by it, its read access, everything that has happened to it, what it
costs this window every turn and what it costs across every live holder, and a chip per
co-holder that opens that instance's same file. An **unowned** module says so in words —
"this agent holds it but its prompt does not carry it" — because that configuration's
effect is otherwise invisible everywhere.

Two more things the strip says out loud rather than leaving to be inferred. A store every
holder has let go of is badged **dropped** — *every* holder, not merely the one whose
succession reported the drop, since the run-global board and a profile-scoped notebook are
routinely dropped by one instance while the rest of the run keeps writing them. And a
record written before module identity existed is badged **inferred**, because its store ids
are placeholders this console minted rather than names the run ever used.

The strip's way out to the Modules tab is offered only when the run *has* one. Every
instance of every run holds a window, and the window has no capability behind it, so a
`modules/history` file exists in runs that tab is not offered for; the link is withheld
there rather than switching to a tab the selector immediately falls back out of.

### The Modules tab: the run read by the state it holds

A new tab, between Instances and Project, offered whenever any profile enables a
module-backed capability. It groups **module instances by kind**, and a store shared by
four agents is **one** row however many hold it.

Each kind's group leads with an **Overview** — the capability's whole-run read-out, and
the thing to open first: how many stores exist, how many holders they have between them
and how many are still running, how many of them are genuinely shared (and how many were
only handed on) and how widely, what they cost every turn summed over the windows actually
carrying them, how many were never written to at all, and every store side by side.
"Twelve private notebooks holding two notes each" and "one store four agents curate" are
the same capability configured two ways, and neither reads as anything one store at a time.

Two of those figures are deliberately withheld where they would be a lie rather than a
zero. **History has no "holding nothing"** figure at all: a window reports itself per turn
as a context breakdown rather than as a snapshot of a store, so counting its absent
snapshot would report every conversation window in every run as unused — the inverse of the
truth about the fullest thing an agent holds. And a **per-turn cost of zero** is
distinguished from an unmeasured one and from the archive, which has no context band by
construction because being out of the window is what it is *for*.

Selecting a store reads it in five sections: its **identity**, its **holders** (each with
its origin, read access, ownership and what the module costs that instance's window),
its **lifetime** (created, carried, copied, linked, dropped — oldest first, each naming
the succession that caused it), its **cost** per holder against the summed live figure,
and its **contents**, taken from the store's own snapshot rather than from any one agent's
— a shared store has one content, which is the point. The two kinds that report no
snapshot read their contents off their holder's stream instead: a window's messages and an
archive's entries, shown here exactly as they are in the holder's own `modules` folder.

Holder ids link into the Instances tab at that agent's own `modules/<kind>` file, and
profile names into the Agents tab; the Instances module file links back.

### The Agents tab: what a profile's instances hold

The Agents tab reads the run per **configured profile**, which is the grain a
configuration is tuned at — and the module question at that grain is *does one store serve
all twelve instances of this profile, or twelve?* A **Modules** section under each
profile's instance chips answers it with one row per kind, badged by how the stores are
distributed:

| Badge | What it means |
| --- | --- |
| **agent-scoped** | One store, bound by every instance at once. The only shape whose contents belong to the *agent*, so they are shown inline, framed as the agent's. |
| **per instance** | Every instance holds its own. Nothing is shown: any single rendering would be a lie about the others — **Compare in Modules** puts them side by side instead. |
| **handed on** | One store, held one instance at a time — a succession carried it. It has several holders and is *not* sharing, which a holder count alone gets wrong. The Instances and Modules tabs annotate the same store the same way. |
| **run-global** | The store reaches beyond this profile — the board, or a store a spawner of another profile owns. |
| **split** | Several stores, at least one genuinely shared: some instances bound it and some did not. Usually worth opening. |

Where the **declared** configuration and the **observed** distribution disagree, the row
says so in a note naming both and the likely cause — a `scope: inherited` whose instances
each got their own (nothing to inherit from), a `shared` profile re-bound mid-run by a
succession, holders disagreeing about ownership after a transfer. Every one of those is a
legal configuration, so it is a note and never an error; being loud about it is the point,
because these are precisely the cases where a configuration reads as working while it is
not.

These notes are only written for a run that actually reported its rosters. A record from
before module identity has no observations to compare a declaration against — its holders'
origins and ownership are placeholders the console synthesized — so it gets no notes rather
than notes with nothing behind them.
