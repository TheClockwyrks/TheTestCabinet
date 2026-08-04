---
title: "Memories"
---

Memories are **essentially the same as [skills](/gg/skills/)** — a description
shown up front, a body that survives [compaction](/gg/compaction/) — with one
difference: they are **curated by the model itself** rather than authored ahead
of time. The model writes and updates its own memories as it works.

Because the model controls them, gg must **bound them**, so that self-curated
memory cannot crowd out the working context. When a limit is hit, the model must
revise or evict rather than simply accrue.

This is deliberately analogous to how The Test Cabinet's own agent memory works
(one fact per file, with an index) — gg gives the *model under test* the same
affordance.

## The store is gg's, not the workspace's

Under every strategy the memories live **inside gg and nowhere else**. Two of the
strategies talk about an "index file" and "memory files" because that is the
mental model a model already has, but nothing is written to disk: the memory
tools are the only way to create, read, revise or remove one. That is what makes
the index trustworthy — a model cannot rewrite its own index behind gg's back by
writing over a file, and gg's accounting of what the window holds can never
disagree with what is stored.

## The three strategies

The capability's `implementation` selects the **memory strategy**. They differ in
what is *always* in the context window, which is the variable the strategies exist
to compare: memory you are handed every turn, memory you can see the titles of, or
memory you have to go looking for. An unrecognized name resolves to `scratchpad`
rather than failing the run.

| Strategy | Always in context | Tools |
| --- | --- | --- |
| `scratchpad` (default) | every memory, body and all | `write_memory`, `update_memory`, `delete_memory` |
| `markdown` | the index (one `slug` — `description` line per memory) | `create_memory`, `read_memory`, `edit_memory`, `delete_memory` |
| `keyword-search` | nothing | `create_memory`, `read_memory`, `edit_memory`, `delete_memory`, `search_memories` |

All three work in both execution modes. Under
[responses-as-code](/gg/responses-as-code/) the same functions are methods on the
`memory` object (`memory.createMemory`, `memory.searchMemories`, …), and only the
active strategy's are bound into a program's scope, so `memory.list()` is an
honest answer to "what can I do with memory here?".

### `scratchpad`

A small, curated set whose **bodies are all pinned** in the window and cross a
compaction boundary verbatim. Memory you never have to look up, and context you
pay for continuously — which is why it is bounded by a count and a per-body
length. (An aggregate ceiling across every memory at once is available as
`maxTotalLen` and is **off** by default: the other two already bound what the
window carries, and a total is the one limit an agent hits without being able to
say which write was too much.)

### `markdown`

An **index** over markdown files. The index is pinned; the memories themselves are
not, so the model reads one when it needs it. `create_memory` adds the entry and
`delete_memory` removes it — the model can never write the index directly.

The index is what bounds the population: a create whose entry would push the index
over its limit is refused, and the refusal tells the model to delete a memory
rather than to shorten the one it is writing. There is no separate count limit,
because every memory must have a line in the index anyway.

### `keyword-search`

Markdown files with **no index at all**: nothing about them is in the window until
the model looks. `search_memories` takes an array of keywords and ranks the
matches by how many distinct keywords a memory mentions, then by how often — plain
case-insensitive substring matching over each memory's slug, description and
contents. Each hit carries a short excerpt; the model reads the ones worth having
in full.

Because there is no index to put one in, a `description` is optional here (when
given, it is shown with search results).

### Editing

The two file-shaped strategies revise a memory by **search/replace**, exactly as
`edit_file` does: the model quotes the text it is changing, which must appear
exactly once. Appending is quoting the last line and replacing it with itself plus
what is being added. An edit that would leave the memory **empty** is refused and
told to delete it instead — a deletion is a decision, not something gg infers from
an edit.

## Limits

Every limit is set through the capability's `params`, and **`0` disables it**
(unlimited). A param a strategy does not use is ignored, so one sweep can hand
every arm the same params block.

| Param | Applies to | Default |
| --- | --- | --- |
| `maxCount` | `scratchpad`, `keyword-search` | 64 / unlimited |
| `maxLenPerMemory` | all three | 4 096 / 8 192 / 8 192 |
| `maxTotalLen` | `scratchpad` | unlimited |
| `maxLenIndex` | `markdown` | 16 384 |
| `maxLenDescription` | all three | 256 |
| `maxResults` | `keyword-search` | 25 |

The scratchpad's defaults describe a store an agent really curates — sixty-four
notes of a page each — rather than the handful of short lines they once did. What
bounds it is the count and the per-note length; the aggregate ceiling is off
unless a run asks for one.

Lengths are in characters of a memory's **body**; a description is a short
one-liner and is not counted against them (it is counted in the index, which is
what `maxLenIndex` measures). Neither is a memory's [code](#code-memories), which
is not context at all and is bounded separately.

`maxLenDescription` bounds the description itself, under every strategy. It is the
one field whose length is paid for by *every* turn rather than by the turn that
reads the memory: on a `markdown` run every description is a line of the pinned
index, and a search hit is mostly description too. A sentence fits comfortably in
256 characters; a pasted paragraph does not, which is the point. An over-long
description is refused, never truncated, and is checked before the body limits so
a call that breaches both is told about the cheaper fix first.

For example, a markdown run with a small index and no per-memory limit:

```json
{
  "id": "memories",
  "enabled": true,
  "implementation": "markdown",
  "params": { "maxLenIndex": 4096, "maxLenPerMemory": 0 }
}
```

## Code memories

A memory can carry **code**, exactly as a [skill](/gg/skills/#code-skills) can — the
difference being that a skill's code was authored ahead of the run and a memory's was
written by the model, which is the whole point: a helper it got right on turn nine is a
helper it never has to write again.

Like a skill's, it is **[responses-as-code](/gg/responses-as-code/) only**. The native
tool schemas carry no code fields at all, so a tool-calling run can neither write a code
memory nor execute one; what it sees of a memory is its description and its body, as it
always did.

Every write accepts the two halves beside the body:

```ts
memory.writeMemory({
  name: "csv-tools",
  description: "Parsing the vendor CSV exports, which quote inconsistently.",
  body: "The third column is sometimes quoted and sometimes not; parseCsv handles both.",
  code: "export function parseCsv(text: string) { /* … */ }",
  onUse: 'view.openText("csv-notes", "Row 1 is a header on exports after March.");',
});
```

`createMemory` and `updateMemory` take the same shape. An update **replaces** both halves,
so omitting them clears them — the same rule the description and the body already follow,
and one a native-mode run cannot trip over, because its schema has no way to say anything
about them.

- **`code`** is a module whose exports are bound at `lib.<key>` in every program the agent
  writes from then on, `key` being the slug in camel case (`csv-tools` → `lib.csvTools`),
  deduplicated if something else has it. The reply names the key and lists the exports. What
  a module may contain and what it is refused for is documented under
  [responses-as-code](/gg/responses-as-code/#lib-code-the-agent-loaded).
- **`onUse`** is a script gg runs **once**, when the memory first comes into use, after the
  turn's program has ended — so the views it opens arrive on the next turn. It cannot end
  the session, has no program library, and its source is never shown back to the model. The
  rules are the same ones an
  [on-use skill script](/gg/skills/#an-on-use-script-that-runs-once) obeys, for the same
  reasons.

### When the code loads

By exactly the rule the strategy already sets for what is in context:

| Strategy | The code loads on |
| --- | --- |
| `scratchpad` | the **write** — every memory is in the window from the moment it exists, so there is no later moment at which it comes into use |
| `markdown`, `keyword-search` | the **read** — nothing is in context until `read_memory` brings it there, and its code follows its body |

Registration **survives a compaction**: a loaded module is not context — it costs no tokens
and is never summarized — so a boundary does not sweep it, and nothing makes an agent
re-read a memory to get back a helper it already has. What it does not survive is a
[`fork`](/gg/fork-and-exec/) or a succession, which start with nothing bound.

### Neither half is context, and neither counts against a body limit

`code` and `onUse` cost no window at all: one is transpiled and held by the host, the other
runs and is never shown. Bounding them against a *window* budget would be bounding the wrong
thing, so they are bounded on their own — **32 768 characters each**, refused in the same
`limit-exceeded` voice every other cap uses. What that limit protects is the transpiler,
which parses untrusted source, not the context window.

### Code that does not compile

Both halves are compiled at the moment they load, which is the moment the table above names
— and what happens next depends on which moment that is:

- A **write** that loads (the scratchpad's) is **refused** outright, with a located
  diagnostic. The model wrote that code on this call, so this is the one moment at which the
  error is exactly what it needs, and storing a module that can never be bound would be
  storing something that only fails later.
- A **read** that loads (the two file-shaped strategies') still **returns the memory**, with
  the diagnostic appended to the body. The body is what the model asked for, and withholding
  it because a separate half of the memory is broken would lose the thing that was fine.

The same is true of a [skill](/gg/skills/#code-skills), which only ever loads on a read:
broken code costs the model a diagnostic, never the prose it went looking for.

## Scoping: whose memories are these?

By default a memory instance belongs to **one agent instance**: a subagent starts
with an empty notebook, and nothing it writes is ever seen by anyone else. That is
still the default, and it is still the right answer for a study that wants each
agent measured on its own curation.

The `scope` param binds the instance differently.

| `scope` | Which instance the agent binds |
| --- | --- |
| `isolated` (default) | A fresh one, per agent **instance** |
| `shared` | One per agent **profile** — every instance of it in the run, including instances running in parallel |
| `inherited` | Its **spawner's**, read/write, when it was spawned as a subagent; its own otherwise |
| `read-only` | As `inherited`, but this agent may not write |

```json
{
  "id": "memories",
  "enabled": true,
  "implementation": "markdown",
  "params": { "scope": "inherited", "maxLenIndex": 4096 }
}
```

`scope` is only meaningful where the capability is **enabled** — an agent with no
memories binds none — and setting it on a disabled capability is reported as a
launch warning. A value gg does not recognize falls back to `isolated` and warns,
like every other unrecognized capability value.

### Two rules make the four coherent

**`read-only` only ever restricts an inherited handle.** An agent that ends up with
an instance of its own under `read-only` — the run's root, an issue's implementer,
a reviewer or judge, or a subagent whose spawner keeps no memories — may write it.
A private notebook nobody may write is not a feature.

**Write access belongs to the holder, not to the store.** Nothing on a store
records who may write it. So a `read-only` agent's own `inherited` subagent gets a
**read/write** handle onto the very same store, and inheritance chains: a subagent
of a subagent holds the instance the top of the chain created, however deep.

### Which instance each kind of agent binds

`inherited` and `read-only` are defined against *how the agent was started*, so the four
scopes read differently at each of the places gg starts one. This is the whole table:

| Started as | `isolated` | `shared` | `inherited` | `read-only` |
| --- | --- | --- | --- | --- |
| **The run's root** | its own | the profile's instance | its own (nothing spawned it) | its own, and **writable** |
| **An issue's implementer** ([auto-dispatched](/gg/project-management/#auto-dispatch)) | its own | the profile's instance | its own (it is top-level, not a subagent) | its own, and **writable** |
| **A [subagent](/gg/subagents/)** — an ad-hoc spawn | its own | the profile's instance | its **spawner's**, read/write — or its own, if the spawner keeps no memories | its spawner's, **read-only** |
| **A reviewer, judge or merge agent** | its own | the profile's instance | its own — gg dispatches these directly, not through a spawner | its own, and **writable** |
| **A [`fork`](/gg/fork-and-exec/)** | an independent copy | the same instance (already one) | its forker's, read/write | its forker's, read-only |
| **A successor** ([`exec`](/gg/fork-and-exec/) or an [FSM transition](/gg/fsms/)) | the predecessor's instance, transferred | **its own profile's** instance, re-bound | the predecessor's instance, transferred | transferred, with access from the **successor's** own scope |

The last row is a [transfer](/gg/modules/#transfer) rather than a binding, so it obeys the
transfer rules first: a successor whose profile turns memories off gets none, and one that
organizes them under a different [strategy](#the-three-strategies) gets a fresh instance and
is told why. `shared` is the one scope that overrides the transfer, and it has to: `shared`
means *bound to the profile*, so a successor running a `shared` profile re-binds that
profile's instance instead of keeping the one it was handed. Otherwise one profile could be
curating two notebooks at once — the store its predecessor passed it, and the store every
other instance of it resolved — which is the exact situation the scope exists to prevent.

Two more things fall out of the table that are easy to miss:

- **A second instance of a `shared` profile is the linked case.** Two implementers of the
  same profile running in parallel curate one store, and each is told what the other wrote.
  That is the difference between `shared` and `isolated`: not what an instance *may* do,
  but how many instances there are.
- **`inherited` chains.** A subagent of a subagent binds whatever the top of the chain
  created, however deep — each link passes on the handle it holds rather than the one it
  created.

### Reading a scope back off a run

A scope is what the configuration **asked for**; several of the rows above are cases where
gg legally resolves it to something else — an `inherited` agent with no spawner to inherit
from gets its own store, a `shared` successor re-binds its own profile's. Every memory
store therefore carries an [id](/gg/modules/#identity-which-store-is-this), and the
console reads scoping off the ids rather than off the declaration: the **Modules** tab
lists each store once with every instance holding it, the profile's row on the **Agents**
tab says whether its instances turned out to share one store or take one each — and names
the divergence where that is not what the scope asked for — and each instance's
`modules/memories` file marks the store it bound and who else is in it. See
[Inspecting modules in the console](/gg/modules/#inspecting-modules-in-the-console).

### What a read-only holder is offered

Exactly the read calls, and nothing else — `read_memory` under the two file-shaped
strategies, plus `search_memories` under `keyword-search`. The write calls are
never contributed to the toolset, so the model is never shown a schema for one, no
program has one in scope, and the system prompt says the memories are another
agent's rather than telling it to curate them. A write that reaches gg anyway (a
program written against a scope this agent no longer has) is refused with an
explanation naming the calls it does have.

Under `scratchpad` a read-only holder gets **no memory tools at all**, which is
coherent: that strategy has no read call because its memories *are* the pinned
block. It reads them by having them in its window.

One knock-on: an agent configured for [`memory-compaction`](/gg/compaction/) that
holds its memories read-only is demoted to the default strategy, with a warning. It
has no call that could satisfy a memory compaction, and a run that could never
satisfy its own compaction gate would wedge against a full window.

### What a fork carries

A [`fork`](/gg/fork-and-exec/) copies almost everything its agent holds, but memories
follow the scope rather than the copy: an `isolated` notebook is copied and the two
diverge, while every scope that links agents at all stays **linked** across the fork —
both the original and its copy hold the one store, and each is told what the other
writes. A fork is not a reason to split what a configuration deliberately joined.

### Inheritance needs a matching strategy

A store is read by the calls its own strategy offers, so a child organizing its
memories differently from its spawner cannot take the spawner's instance: it gets
one of its own. gg reports the pairing as a launch warning rather than leaving it
to be inferred later from a notebook that stayed empty.

## Linked instances: being told what somebody else wrote

Under every scope but `isolated`, several agents can hold one store at once. When
one of them adds, revises or removes a memory, every **other** holder is told in
its next prompt:

```
Another agent sharing your memories has made changes since your last turn:

- added `deploy-runbook` — how the staging cluster is rolled
- updated `api-conventions` — error envelope + pagination rules
- deleted `scratch-notes`

Read one with `read_memory` if it bears on what you are doing.
```

Deletions are included — acting on a memory that has since been deleted is the
failure the notice exists to prevent — and each memory gets **one line**, saying
where it ended up, however many writes touched it. Under `scratchpad`, where there
is no read call, the notice carries each memory's body inline instead of pointing
at a call the agent does not have.

Three properties are worth knowing, because they are what the notice was designed
around:

- **The pinned index does not change.** It is rebuilt at a compaction boundary and
  nowhere else, exactly as it always was. The notice is appended at the tail of the
  window as an ordinary message, so the whole previous request stays a byte-identical
  prefix of the next one and the prompt cache is not perturbed. A rebuilt index
  would rewrite the cached prefix on a turn this agent did nothing at all.
- **Delivered exactly once, per holder.** Each holder keeps its own watermark. A
  holder is never told about its own writes — they are already in its thread as a
  call and the confirmation that answered it — and a holder that joins late is not
  handed a backlog of everything that happened before it existed.
- **Not re-issued after a compaction.** The notices are ephemeral, so a boundary
  sweeps them; but the boundary rebuilds the pinned block first, so everything a
  notice announced crosses in the block (or, under `keyword-search`, stays findable
  by search). Announcing it again would tell the model twice about a memory it may
  already have read.

A run in which nothing is linked never produces a notice at all, and pays nothing
for the machinery.

## Compaction

Memories survive a compaction boundary under every strategy — that is the point
of them. What crosses *in the window* is what the strategy pins: every body under
`scratchpad`, the index alone under `markdown`, nothing under `keyword-search`
(where the memories are still stored, and still findable, on the other side).

The [`memory-compaction`](/gg/compaction/) strategy, which asks the agent to
record its working state instead of writing a summary, asks for the calls the
run's memory strategy actually offers.

### The pinned block is rebuilt at a boundary, and only there

A memory the model just wrote is already in front of it — the call it made and
the confirmation it got back are both in the thread — so re-sending the block the
turn after a write tells it nothing it does not already know. What it *does* cost
is a fresh copy of every memory (or of the whole index) every time the model
curates, which on a long run is most of what memory spends.

So between boundaries gg leaves the block exactly as it is, and lets the thread
carry the news. What the thread cannot carry is a compaction, which drops the very
tool results the model was reading its memories out of — so gg rebuilds the block
there, immediately before the window is rewritten. The stale copy is superseded
into the ephemeral history the boundary is about to sweep away, and the fresh one
crosses as part of the pinned prefix.

The consequence to know about is that a pinned index can lag: a memory created
since the last compaction is stored and readable but is not listed there yet. The
system prompt says so, so the model does not read a missing line as a lost memory.

The one boundary that is not a compaction is an agent's **first turn**. A holder that
binds a store somebody else filled — a subagent that inherited its spawner's, the second
instance of a `shared` profile, a successor handed the module by a
[transfer](/gg/modules/#transfer) — opens on memories it never made a call for, so there is
no thread carrying that news and nothing to leave alone. gg therefore builds the block once
as the window is opened. A store that is empty renders nothing, so an agent that starts with
nothing, as almost every agent does, is unaffected.

## What gg records

Two things are streamed, and they answer different questions.

The **`memory_state`** event is the set as it stands: every memory currently held
with its description, character count and line count, the totals, the limits in
force, and the run's **peaks** — the most memories, characters and lines ever held
at once. The peaks are there because the live figures alone are misleading: a model
that curates well spends its budget, prunes, and finishes holding almost nothing.

It also carries **how the emitting agent holds the store**: its `scope`, and whether
it may write. Without those, two agents curating one shared store and two agents that
happen to hold the same notes are indistinguishable, and the console badges the
difference.

The **`memory_revision`** event is one entry of an append-only record of what the
model *did*: every successful mutation, in order, carrying the memory's text as of
that revision. It is what a snapshot can never show — a memory written and later
deleted, and the earlier wording of one that was revised. Revision numbers are per
slug and keep counting across a delete, so a name that is discarded and re-created
reads as the history it is. A refused mutation records nothing; it did nothing.

A revision is reported **once**, on the stream of the agent that made it, however
many agents hold the store it landed in. Every other holder re-emits its own
`memory_state` instead — its panel changed, but the write was not its work.

The console folds the two together into the Memories panel: current-and-peak
totals, a treemap of every memory ever held sized by its character count, and each
memory — deleted ones included — expandable into its revision history.
