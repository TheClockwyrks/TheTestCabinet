---
title: "Memories"
---

A memory is a durable note the model writes and maintains itself: a slug, a
one-line description, and a body. It takes the same shape as a
[skill](/gg/skills/), with a description shown up front and a body that survives
[compaction](/gg/compaction/). The model curates the set as the run goes.

Because the model controls them, gg bounds them, so that self-curated notes
cannot crowd out the working context. A mutation that would breach a limit is
refused with a message telling the model to revise, evict or delete. Nothing is
truncated.

## Where memories are stored

Under every strategy the memories live inside gg. The memory calls are the only
way to create, read, revise or remove one, and nothing is written to the
workspace. Two of the strategies talk about an index file and memory files
because that is the mental model a model already has. Since a model cannot
rewrite its own index by writing over a file, gg's accounting of what the window
holds always agrees with what is stored.

A slug is up to 64 characters of letters, digits, `-`, `_` and `.`.

## The three strategies

The capability's `implementation` selects the memory strategy. The strategies
differ in what is always in the context window. A name gg does not recognize
refuses the launch, naming the three that exist.

| Strategy | Always in context | Tools |
| --- | --- | --- |
| `scratchpad` (default) | every memory, body and all | `write_memory`, `update_memory`, `delete_memory` |
| `markdown` | the index (one `slug` — `description` line per memory) | `create_memory`, `read_memory`, `edit_memory`, `delete_memory` |
| `keyword-search` | nothing | `create_memory`, `read_memory`, `edit_memory`, `delete_memory`, `search_memories` |

All three work in both execution modes. Under
[responses-as-code](/gg/responses-as-code/overview/) the same calls are the
`gg.memories` module (`gg.memories.createMemory`, `gg.memories.searchMemories`),
and a call the active strategy does not offer is
[refused](/gg/languages/static-sdks/) as `unavailable`.

### `scratchpad`

Every memory's body is pinned in the window and crosses a compaction boundary
verbatim. The count and the per-body length bound it. The aggregate ceiling
`maxTotalLen` is available and off by default.

### `markdown`

A pinned index over memory files, one `` - `slug` — description `` line each.
The bodies stay out of the window until `read_memory` brings one in.
`create_memory` adds the entry and `delete_memory` removes it, so the model never
writes the index directly.

The index bounds the population: a create whose entry would push the index over
its limit is refused. There is no separate count limit, because every memory must
have a line in the index anyway.

### `keyword-search`

Memory files with no index, so nothing about them is in the window until the
model looks. `search_memories` takes an array of keywords and ranks the matches
by how many distinct keywords a memory mentions, then by how often, over
case-insensitive substring matching across each memory's slug, description and
body. Each hit carries a short excerpt. A description is optional under this
strategy and is shown with search results.

### Editing

The two file-shaped strategies revise a memory by search/replace, exactly as
`edit_file` does: the model quotes the text it is changing, which must appear
exactly once. Appending means quoting the last line and replacing it with itself
plus what is being added. An edit that would leave the memory empty is refused,
and the model is told to delete it instead.

## Features

One slider sits in the capability's Features box, per agent.

| Feature | Default | What switching it changes |
| --- | --- | --- |
| Revise memories | on | Off withholds `update_memory`, `edit_memory` and `delete_memory`, so memories are append-only. |

## Limits

Every limit is set through the capability's `params`, and `0` disables it. A
param a strategy does not use is accepted, so one sweep can hand every arm the
same params block. A param name the capability does not know refuses the launch,
as does a value gg cannot read as a whole count.

| Param | Applies to | Default |
| --- | --- | --- |
| `maxCount` | `scratchpad`, `keyword-search` | 64 / unlimited |
| `maxLenPerMemory` | all three | 4 096 / 8 192 / 8 192 |
| `maxTotalLen` | `scratchpad` | unlimited |
| `maxLenIndex` | `markdown` | 16 384 |
| `maxLenDescription` | all three | 256 |
| `maxResults` | `keyword-search` | 25 |

Lengths are in characters of a memory's body. A description is bounded
separately, by `maxLenDescription` under every strategy, because it is the one
field every turn pays for: on a `markdown` run every description is a line of the
pinned index, and a search hit is mostly description. An over-long description is
refused rather than truncated, and is checked before the body limits, so a call
that breaches both is told about the cheaper fix first. A memory's
[code](#code-memories) counts against none of these limits.

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

A memory can carry code beside its body, exactly as a [skill](/gg/skills/) can.
Both halves are [responses-as-code](/gg/responses-as-code/overview/) only: the
native tool schemas carry no code fields, so a tool-calling run sees a memory's
description and body alone.

```ts
gg.memories.writeMemory({
  name: "csv-tools",
  description: "Parsing the vendor CSV exports, which quote inconsistently.",
  body: "The third column is sometimes quoted and sometimes not; parseCsv handles both.",
  code: "export function parseCsv(text: string) { /* … */ }",
  onUse: 'gg.views.openText("csv-notes", "Row 1 is a header on exports after March.");',
});
```

`createMemory` and `updateMemory` take the same shape. An update replaces both
halves, so omitting them clears them, on the rule the description and the body
already follow. A native-mode update leaves both alone, since its schema has no
way to say anything about them.

- `code` is a module whose exports are bound at `lib.<key>` in every program the
  agent writes from then on, `key` being the slug in camel case (`csv-tools` →
  `lib.csvTools`), deduplicated if something else holds it. The reply names the
  key and lists the exports.
- `onUse` is a script gg runs once, when the memory first comes into use, after
  the turn's program has ended, so the views it opens arrive on the next turn. It
  cannot end the session, it has no program library, and its source is never
  shown back to the model.

### Code loading

A memory's code loads by the rule its strategy already sets for what is in
context.

| Strategy | The code loads on |
| --- | --- |
| `scratchpad` | the write, since every memory is in the window from the moment it exists |
| `markdown`, `keyword-search` | the read, since a memory's code follows its body into context |

Under the two file-shaped strategies, a write carrying code is answered with a
line saying the code is stored and will load, and be named, on the read.

Registration survives a compaction: a loaded module costs no tokens and is never
summarized, so a boundary leaves it bound and nothing makes an agent re-read a
memory to get back a helper it already has. A [`fork`](/gg/fork-and-exec/) and a
succession start with nothing bound.

Each half is bounded at 32 768 characters, refused in the same `limit-exceeded`
voice every other cap uses. That limit protects the transpiler, which parses
untrusted source.

### Code that does not compile

Both halves are compiled at the moment they load, and what happens next depends
on which moment that is.

- A write that loads (the scratchpad's) is refused, with a located diagnostic.
  Storing a module that can never be bound would store something that only fails
  later.
- A read that loads (the two file-shaped strategies') returns the memory, with
  the diagnostic appended to the body. The body is what the model asked for.

A compiler that could not finish is gg's own defect and ends the run under
`internal_error`, on the terms in
[gg's own defects](/gg/execution-limits/#a-compiler-that-could-not-finish). The
compiler's crash detail goes to the run's operator. The call that met it is
refused as an `io-error` rather than an `invalid-argument`, since the model's
argument was never the thing that failed, and the turn that refusal fails is
recorded against gg rather than against the model.

## Scoping

By default a memory instance belongs to one agent instance: a subagent starts
with an empty notebook, and nothing it writes is seen by anyone else. The `scope`
param binds the instance differently.

| `scope` | Which instance the agent binds |
| --- | --- |
| `isolated` (default) | A fresh one, per agent instance |
| `shared` | One per agent profile: every instance of it in the run, including those running in parallel |
| `inherited` | Its spawner's, read/write, when it was spawned as a subagent; its own otherwise |
| `read-only` | As `inherited`, but this agent may not write |

```json
{
  "id": "memories",
  "enabled": true,
  "implementation": "markdown",
  "params": { "scope": "inherited", "maxLenIndex": 4096 }
}
```

A value gg does not recognize refuses the launch, and the refusal names every
such value in the configuration at once. Setting `scope` on a capability that is
switched **off** does not: a disabled capability records the configuration the
arm would have used, so the on and off arms of one comparison stay symmetric.

Two rules make the four coherent. `read-only` restricts an inherited handle and
nothing else: an agent that ends up with an instance of its own under `read-only`
may write it. And write access belongs to the holder rather than to the store,
so a `read-only` agent's own `inherited` subagent gets a read/write handle onto
that same store, and inheritance chains through a subagent of a subagent to
whatever the top of the chain created.

### Which instance each kind of agent binds

`inherited` and `read-only` are defined against how the agent was started, so the
four scopes read differently at each of the places gg starts one.

| Started as | `isolated` | `shared` | `inherited` | `read-only` |
| --- | --- | --- | --- | --- |
| The run's root | its own | the profile's instance | its own (nothing spawned it) | its own, and writable |
| An issue's implementer | its own | the profile's instance | its own (it is top-level, not a subagent) | its own, and writable |
| A [subagent](/gg/subagents/) | its own | the profile's instance | its spawner's, read/write; its own if the spawner keeps no memories | its spawner's, read-only |
| A reviewer or merge agent | its own | the profile's instance | its own (dispatched directly, not through a spawner) | its own, and writable |
| A [`fork`](/gg/fork-and-exec/) | an independent copy | the same instance | its forker's, read/write | its forker's, read-only |
| A successor ([`exec`](/gg/fork-and-exec/) or an [FSM transition](/gg/fsms/)) | transferred | its own profile's instance, re-bound | transferred | transferred, read-only |

The last row is a [transfer](/gg/modules/) rather than a binding, so it obeys the
transfer rules first: a successor whose profile turns memories off gets none, and
one that organizes them under a different strategy gets a fresh instance and is
told why. `shared` overrides the transfer, because `shared` means bound to the
profile: a successor running a `shared` profile re-binds that profile's instance
instead of keeping the one it was handed. Otherwise one profile would curate two
notebooks at once, which is the situation the scope exists to prevent.

### Read-only holders

Exactly the read calls: `read_memory` under the two file-shaped strategies, plus
`search_memories` under `keyword-search`. The write calls are never contributed
to the toolset, so the model is shown no schema for one, no program has one in
scope, and the system prompt says the memories are another agent's. A write that
reaches gg anyway is refused with an explanation naming the calls the agent does
have.

Under `scratchpad` a read-only holder gets no memory tools at all. That strategy
has no read call, because its memories are the pinned block; it reads them by
having them in its window.

A profile configured for [`memory-compaction`](/gg/compaction/) that declares its
memories read-only refuses the launch. It has no call that could satisfy a memory
compaction, and a run that could never satisfy its own compaction gate would
wedge against a full window. An instance whose live scope resolves read-only
under that strategy is gg's own defect and ends the run under `internal_error`.

### Forking

A [`fork`](/gg/fork-and-exec/) copies almost everything its agent holds, and
memories follow the scope rather than the copy. An `isolated` notebook is copied
and the two diverge. Every scope that links agents stays linked across the fork:
the original and its copy hold one store, and each is told what the other writes.

### Inheritance and the strategy

A store is read by the calls its own strategy offers, so an `inherited` or
`read-only` agent organizes its memories the way its spawner does.

An inheriting profile that names **no** `implementation` takes exactly that: it
binds its spawner's store however that store is organized, and its memory calls
are that store's strategy's. This is the ordinary shape, and it is the one case
where "absent" does not mean `scratchpad` — an agent whose whole configuration
is "work in my spawner's notebook" has said nothing about how the notebook is
kept.

A profile that *does* name one is asking for a store organized that way. A roster
pairing whose two profiles both name a strategy and name different ones refuses
the launch. Where only the live spawner settles the pairing, a disagreement is
gg's own defect and ends the run under `internal_error`.

### Resolved scopes in the console

A scope is what the configuration asked for, and several rows above are cases
where gg resolves it to something else. Every memory store therefore carries an
[id](/gg/modules/), and the console reads scoping off the ids rather than off the
declaration. The Modules tab lists each store once with every instance holding
it. A profile's row on the Agents tab says whether its instances share one store
or take one each, and names the divergence where that is not what the scope asked
for. Each instance's `modules/memories` file marks the store it bound and who
else is in it.

## Linked instances

Under every scope but `isolated`, several agents can hold one store at once. When
one of them adds, revises or removes a memory, every other holder is told in its
next prompt:

```
Another agent sharing your memories has made changes since your last turn:

- added `deploy-runbook` — how the staging cluster is rolled
- updated `api-conventions` — error envelope + pagination rules
- deleted `scratch-notes`

Read one with `read_memory` if it bears on what you are doing.
```

Deletions are included, since acting on a memory that has since been deleted is
the failure the notice exists to prevent. Each memory gets one line saying where
it ended up, however many writes touched it. Under `scratchpad`, where there is
no read call, the notice carries each memory's body inline.

Three properties hold:

- The pinned index does not change. It is rebuilt at a compaction boundary and
  nowhere else. The notice is appended at the tail of the window as an ordinary
  message, so the whole previous request stays a byte-identical prefix of the
  next one and the prompt cache is undisturbed.
- Each notice is delivered exactly once per holder. Every holder keeps its own
  watermark, a holder is never told about its own writes, and a holder that joins
  late starts at the store's head rather than being handed a backlog.
- Notices are ephemeral, so a compaction boundary sweeps them and they are not
  re-issued. The boundary rebuilds the pinned block first, so everything a notice
  announced crosses in the block or, under `keyword-search`, stays findable by
  search.

## Compaction

Memories survive a compaction boundary under every strategy. What crosses in the
window is what the strategy pins: every body under `scratchpad`, the index alone
under `markdown`, nothing under `keyword-search`, where the memories are still
stored and still findable on the other side.

The [`memory-compaction`](/gg/compaction/) strategy, which asks the agent to
record its working state instead of writing a summary, asks for the calls the
run's memory strategy offers.

The pinned block is rebuilt at a boundary and only there. Between boundaries the
thread carries the news, as the call the model made and the confirmation that
answered it. What the thread cannot carry is a compaction, which drops the very
tool results the model read its memories out of, so gg rebuilds the block
immediately before the window is rewritten.

A pinned index can therefore lag: a memory created since the last compaction is
stored and readable but is not listed there yet. The system prompt says so, so
the model does not read a missing line as a lost memory.

An agent's first turn is the other point at which the block is built. Some
holders bind a store somebody else filled: an inheriting subagent, the second
instance of a `shared` profile, a successor handed the module by a transfer. Such
a holder opens on memories it never made a call for, so gg builds the block once
as the window is opened. An empty store renders nothing.

## Telemetry

Two events are streamed, and they answer different questions.

`memory_state` is the set as it stands: every memory currently held with its
description, character count and line count, the totals, the limits in force, and
the run's peaks. The peaks are the most memories, characters and lines ever held
at once, and they are reported because the live figures alone are misleading: a
model that curates well spends its budget, prunes, and finishes holding almost
nothing. The event also carries how the emitting agent holds the store, its
`scope` and whether it may write, which distinguishes two agents curating one
shared store from two agents that happen to hold the same notes.

`memory_revision` is one entry of an append-only record of what the model did:
every successful mutation, in order, carrying the memory's text as of that
revision. It is what a snapshot cannot show, such as a memory written and later
deleted, or the earlier wording of one that was revised. Revision numbers are per
slug and keep counting across a delete, so a name that is discarded and
re-created reads as the history it is. A refused mutation records nothing.

A revision is reported once, on the stream of the agent that made it, however
many agents hold the store it landed in. Every other holder re-emits its own
`memory_state` instead: its panel changed, but the write was not its work.

The console folds the two together into the Memories panel: current-and-peak
totals, a treemap of every memory ever held sized by its character count, and
each memory, deleted ones included, expandable into its revision history.
