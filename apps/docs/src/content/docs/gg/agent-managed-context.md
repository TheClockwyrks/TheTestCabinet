---
title: "Agent-managed context"
---

Agent-managed context gives an agent agency over its own context window. It is
an opt-in capability (`agent-managed-context`).

- The agent is told how full its window is and what is filling it, as an
  explicit signal it can act on.
- The agent can evict file views it no longer needs, reclaiming their tokens.
- The agent can archive whole turns of its thread, which removes them from the
  live window and keeps them searchable.

When the capability is off none of the tools below are offered and no
context-usage signal is rendered, so a configuration that leaves it off behaves
as a run without the feature.

Under [responses as code](/gg/responses-as-code/overview/) the capability also
buys the view call that manages the window — [closing a view](#closing-views) —
so everything on this page is a privilege a study may withhold. Opening a view
is not one: a program may always show its model something.

This is the model-facing complement to [compaction](/gg/compaction/): compaction
is the automatic backstop when the window fills, and agent-managed context lets
a disciplined agent avoid reaching it.

## The context-usage signal

Each turn, after the pinned blocks are refreshed and after any compaction, gg
rebuilds a short block from the current window accounting and renders it after
every conversation item, so the last thing the agent reads before it acts is
where its window has gone.

```text
Context Usage:
- Overall: 80.1%
- System Prompt: 4.9%
- Task Prompt: 1.2%
- Your Messages: 3.1%
- Tool Output: 6.8%
- File Views: 62.1%
- Top File Views:
  - `src/main.rs`: 12.7%
  - `src/sim/world.rs`: 4.6%
- Text Views: 3.4%
- Tasks: 2.0%
```

The figures are followed by one line per reclaim call this agent holds, naming
the call and the trade using it makes: a file view can be read again, a text
view holds the only copy of what the agent composed, and archived turns are
named by the turn numbers on the agent's results. Eviction and archiving are
separately [grantable](/gg/configurations/#granting-calls) and are read off what
this agent was given, and the close line appears only under responses as code,
where that call exists at all.

Each reclaim call is spelled for the arm reading it. A code agent is shown the
method its own SDK binds, resolved from that
[language](/gg/languages/overview/)'s catalogue, and a tool-calling agent is
shown gg's tool name (`evict_file_view`, `archive_thread`), which is the
identity it actually requests.

The block reports the share of the window each
[source](/gg/context-visibility/#the-bands) holds, as a percentage to one
decimal place, in the same fixed source order the context graph uses, with the
per-file list nested inside the file-view band. A category holding nothing is
left out rather than listed at `0.0%`. Compiler and runtime error lines
therefore appear only in a run whose programs are failing, directly after `Tool
Output` where the fixed order puts them. The figures are computed over the
system prompt and the conversation items, so the block never accounts for
itself.

Text Views is the band a responses-as-code agent fills itself with
`gg.views.openText`. It carries no nested list, because its selectors are labels
the agent chose, and every open view is already in front of it in the window
itself.

### Shares and per-file breakdown

The block reports shares, and names files under the file-view band, because most
of what fills a window is not something the agent can act on. It cannot reclaim
the system prompt or the task list. What it can act on is the file views it has
open and its own thread. A share says how much of the problem each category is;
the nested list says which reads to drop first, since `evict_file_view { path }`
takes a path.

That list names the [`topFileViews`](#parameters) most expensive open files,
largest first, and appears only for an agent that actually has
`evict_file_view`. Repeated reads of one path are summed into a single entry,
since one call reclaims all of them at once. A locked
[autoloaded specification](/gg/autoload-specifications/) is excluded, because
eviction is the removal locking exists to prevent.

### When the block appears

The block costs the window it reports on, so it is held back until the window is
worth reporting. `signalThresholdPercent` is how full the window has to be
before the agent is shown it at all, and it defaults to 75. Below that there is
no block, and a window a reclaim brought back under the threshold loses the one
it had.

The share is of the window the agent may actually fill: the model's window, less
what an enabled [compaction](/gg/compaction/) holds back for its summarization
call. That is the same denominator every figure in the block is a share of and
the same one the compaction trigger reads, so the threshold that puts the block
in front of the agent and the `Overall:` figure it then reads are one
measurement.

Set it to `0` for the block on every turn.

### The signal's slot

The signal occupies a single slot rendered after the conversation, and each
turn's rebuild overwrites it, so a window never holds two of them. A compaction
empties the slot, so a reading taken before a boundary is never read after one.
Because the whole conversation sits before the signal, rewriting it every turn
invalidates no cached prefix, which is why it reports its figures exactly rather
than rounding them. See [context visibility](/gg/context-visibility/).

## Evicting file views

`evict_file_view` drops the contents of files the agent has read from the live
window, reclaiming their tokens. This is safe: the files are unchanged on disk
and can be re-read at any time.

- `evict_file_view { path }` evicts the views of that one workspace path,
  including every page of a file read in pages.
- `evict_file_view {}` evicts every file view.

A locked autoloaded specification is spared even by the blanket form. The tool
result reports what was reclaimed, and the next
[context breakdown](/gg/context-visibility/) shows the file-view band fall.

## Closing views

Under responses as code a program opens the material in its own window, and
`gg.views.close(selector)` closes it again: every view carrying that selector,
including every page of a file path, returning how many it closed. Closing
something that is not open returns `0` rather than failing, so a program that
tidies up unconditionally does not have to guard every call.

The sweep reaches the file, agent-view and doc-search bands. A selector is what
the model wrote, and it need not say which band it meant. A used
[skill](/gg/skills/)'s body is pinned material an operator put in front of the
agent and is not reachable, by the same rule that keeps an eviction off a locked
autoloaded specification. The documentation views a code skill's module opened
are ordinary documentation views, closable by an agent that holds
`docview-close`.

`gg.views.close` — closing a view — is one of this capability's calls, exactly
as `evict_file_view` is: closing material is context management, and a
configuration that keeps the capability off withholds it. A program that
calls it without the capability, or whose agent's allowlist omits the
operation, is refused by name with the `unavailable` error every other withheld
call raises. `gg.views.close` still sits beside `evict_file_view` rather than
inside it, because the trade is not the same: an evicted file view is
recoverable by re-reading the path, where a closed text view held the agent's
only copy of something it computed, so closing one discards it unless the agent
wrote it down first.

### Closing documentation views

Closing a documentation view is `gg.docs.close` and `gg.docs.closeAll`, bought
by the `docview-close` capability, which an agent holds only where its profile
enables it. An agent that lacks the capability is refused by name.
`gg.views.close` reaches the documentation band in no configuration.

The reason is a property nothing else in the window has: opening documentation
only ever appends to the prompt, since re-opening a page whose text is unchanged
does nothing, so a provider's cached prefix survives every lookup an agent makes
for a whole session. A close removes an item from the middle and costs the run every
cached token after it. Whether that reclaim pays for the invalidation is a
measurement, so it is a toggle. Keeping the call separate also keeps the
telemetry attributable: `close_docs_views` has exactly one producer, so a
comparison of two capability sets can say which call reclaimed a documentation
view.

## Turn headers

An agent that can archive is handed the two facts an archival needs. Every tool
result in its window is prefixed with a turn header:

```text
Turn #123
1,234 tokens
----
```

The number is the agent's session turn. It is one-based; turn 0 is the
unnumbered opening context (the system prompt, the build prompt, the
[opening turn](/gg/responses-as-code/views/#the-opening-turn)'s program and the
views its own calls placed, any
[autoloaded specifications](/gg/autoload-specifications/), and the file views
[persistence](/gg/agent-persistence/) re-opens), which carries no header. It is
monotonic for the whole life of the agent: neither a compaction nor an archival
renumbers it, so an agent that read `Turn #37` and later archives turns 12 to 20
is naming the same turns it saw.

The token figure is the estimate of the result without its own header, so the
header does not account for itself.

Headers are attached only for an agent that actually has `archive_thread`.
Without archival they would be a per-result tax on the window buying the model
nothing.

Under responses as code hardly anything carries one, because a program's calls
return into the program and the turn leaves no tool results behind. Everything
gg puts in such a window is a headed `user` message: a `File: <path>:<lines>`,
a `View: <label>` or a `Documentation: <name>` view the program opened, or one
of gg's own messages, each named by its selector rather than by a turn number. The exception
is a window carried over from a tool-calling agent by an
[`exec` or an FSM transition](/gg/fork-and-exec/), whose tool results keep the
headers they were pushed with.

## Archiving the thread

`archive_thread` moves whole turns out of the live window into a searchable
archive, and `search_archive { query }` recovers them on demand as full text
rather than as a summary.

Selection model. `archive_thread { ranges }` takes a required, non-empty
list of inclusive `[from, to]` turn-number pairs: `[[4, 19], [22, 25]]` archives
turns 4 through 19 and turns 22 through 25. At most 32 ranges in one call. The
numbers are the ones on the [turn headers](#turn-headers) the agent has been
reading, so a range is something it can see rather than an offset it has to
compute. Ranges may be given in any order and may overlap; an item leaves the
window if any range contains it. A reversed range is refused rather than
normalized, since the two readings of `[19, 4]` differ by the entire call.

Only the results are archived. An archived turn's own assistant message is
removed from the window and is not written to the archive. What is worth
recovering later is what the turn found: the file it read, the command's output,
the error.

The pinned prefix is never touched, however wide a range is. That covers the
system prompt, the build prompt, used skill bodies, locked autoloaded
specifications, and the live memory, task-list and board blocks, along with the
context-usage signal, which is not a thread item. Superseded copies of those
blocks are ordinary history by then, so they archive like any other thread
material.
Documentation views are retained whatever range is named, so a close remains the
only removal that reaches them.

The call reports back the turns it actually emptied, so a range naming turns
that are no longer in the window says so rather than reading as a success.

The archive is append-only and grows for the life of the session.
`search_archive` does a case-insensitive substring match over each archived
message's text, including the tool calls it made, and returns up to eight
matching entries so a broad query cannot itself refill the window.

The archive is a [module](/gg/modules/), and it travels the way modules do:
a [`fork`](/gg/fork-and-exec/) gets an independent copy, and an `exec` or an
[FSM transition](/gg/fsms/) that names `archive` hands it to the successor
whole. An entry's ordinal is carried rather than restarted across either, so a
search result quoting an entry is unambiguous about which thread it came from.

This capability is one of the two that read an
[`ownership`](/gg/modules/#ownership) param, the other being
[project management](/gg/project-management/). The archive is by definition out
of the window, so `"ownership": "unowned"` has no pinned block to withhold. It
is recorded, carried across a transfer, and otherwise changes nothing.

## Features

Two sliders sit in the capability's Features box, and each is per agent.

| Feature | Default | What switching it changes |
| --- | --- | --- |
| Evict file views | on | Off withholds `evict_file_view`, leaving the signal and the archive. |
| Archive & search the thread | on | Off withholds `archive_thread` and `search_archive`. The two move together, since an archive the agent cannot search back is unreadable. |

## Parameters

| Param | Meaning |
| --- | --- |
| `topFileViews` | Files named under Top File Views, largest first. |
| `signalThresholdPercent` | How full the window must be, `0` to `100`, before the block is rendered. |
| `ownership` | `owned` or `unowned`, on the terms above. |

All three are set per agent. An enabled capability writes `topFileViews` and
`ownership`; how many reads a window holds at once differs enormously between an
agent that opens two specs and one crawling a codebase, so `topFileViews` is a
figure the profile states. An absent one, and any of the three carrying a value
gg cannot honour exactly as written, refuse the launch alongside every other such
value in the capability set.

`signalThresholdPercent` is the one param in gg an absence names a figure for: a
document that leaves it out runs at 75. It is written into every new
configuration, so a run's record says the share it was conducted under whether or
not the operator had an opinion about it.

## Telemetry and the console

Evict, close and archive each emit a `ContextManaged` telemetry event carrying
the `action`, the `reclaimedTokens`, the number of `items` removed, a
human-readable `detail`, and the position of the earliest item removed. That
position is what says whether a reclaim took tokens from the head of a long
window or from its tail, which is the trade the `docview-close` capability is
measured on.

A `gg.views.close` reports one action per band it actually emptied:
`evict_file_views` for a path, `close_text_views` for a label, and
`close_search_views` for the search results. Closing documentation reports
`close_docs_views`. The console names all five apart in the feed, so a reader
can tell a discarded working note from a re-readable file or a shelved reference
page. The underlying tool call and result still stream too; the `ContextManaged`
event carries the effect, which the console draws on the timeline and the
context graph next to the band drop the following breakdown shows.
`search_archive` reclaims nothing, so it is reported only as an ordinary tool
result.

The archive reports its contents as an `archive_state` snapshot when the agent
opens and again after every archival, listing each entry's ordinal, band, role
and length with a bounded preview of its text, never the bodies. The console
reads it as the agent's `modules/archive` file and as an archive group on the
[Modules](/gg/modules/#inspecting-modules-in-the-console) tab.
