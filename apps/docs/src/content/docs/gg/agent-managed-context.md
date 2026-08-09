---
title: "Agent-managed context"
---

Give each agent **agency over its own context window** rather than managing it
implicitly.

- An agent is **told how full its context window is and what is filling it**, as an
  explicit signal it can act on (this signal comes from
  [context visibility](/gg/context-visibility/)).
- An agent can **evict file views** it no longer needs, reclaiming context.
- An agent can **archive whole turns of its thread** (its history): the data is
  removed from the live context but **remains searchable**, so it is recoverable
  without occupying the window.

This is the model-facing complement to [compaction](/gg/compaction/): compaction is
the automatic backstop when the window fills; agent-managed context lets a
disciplined agent avoid ever hitting it.

Agent-managed context is an **opt-in** capability (`agent-managed-context`), like
compaction — a run must name it in its capability set. When it is off, none of the
tools below are offered, no context-usage signal is rendered, and the ablation's off arm
behaves exactly as a run without the feature.

One reclaim call is deliberately **outside** the capability:
[`view.close`](#closing-views-which-no-capability-gates), which a
[responses-as-code](/gg/responses-as-code/#showing-yourself-things) program uses to close the
views it opened itself. Everything else on this page is a privilege a study may withhold;
undoing your own act is not.

## The context-usage signal

Each turn — after the pinned blocks (skills, memories, tasks, the board) are refreshed
and after any [compaction](/gg/compaction/) — gg rebuilds a short block from the
*current* window accounting and renders it **after every conversation item**, so the last
thing the agent reads before it acts is where its window has actually gone:

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
Use `context.evictFileView` to drop file views you no longer need; you can always read the file again.
Use `view.close` to close views you no longer need, naming a file view's path or a text view's label. A file view you can always open again; a text view holds the only copy of what you composed, so write anything you still need to a file before closing it.
Use `context.archiveThread` to move whole turns into the searchable archive, naming them by the turn numbers on your results.
```

That sample is a [responses-as-code](/gg/responses-as-code/) agent's, writing TypeScript. A
tool-calling agent reads the same block with the same numbers and the closing lines spelled
`evict_file_view` and `archive_thread` — and without the `view.close` line at all.

It reports the share of the window each [source](/gg/context-visibility/) holds, as a
percentage to one decimal place, in the same fixed source order the context graph uses,
with the per-file list nested inside the file-view band rather than added to it. A category
holding nothing is **left out** rather than listed at `0.0%`: the block exists to say where
the window is going, and a column of zeroes says nothing. That is why the sample above has no
`Compiler Errors` or `Runtime Errors` line — the two bands a
[responses-as-code](/gg/responses-as-code/) run fills with programs that did not work, which
a run whose programs are running leaves empty. When they do appear they sit directly after
`Tool Output`, where the fixed order puts them, so a run that is losing its window to failing
programs says so in the same place every turn. The figures are computed over the
conversation items alone, so the block never accounts for itself. The closing lines name
only the reclaim calls this agent actually has — eviction and archiving are separately
[ablatable](/gg/toolset-ablation/) and are read off the registry, the close line appears only
under [responses-as-code](/gg/responses-as-code/) because that is where the `view` object
exists at all, and pointing an agent at a call it was not given is worse than saying nothing
at all.

Each of the three is also spelled for the arm reading it. A code agent is shown the method its
own SDK binds, [resolved from that language's catalogue](/gg/program-languages/#nothing-quotes-a-call-by-hand)
rather than typed into the template; a tool-calling agent is shown gg's tool name, which is
the identity it actually requests. The block spent its whole life naming two gg tools at every
code agent gg had ever run, which is a name a program cannot call.

**Text Views** is the band a [responses-as-code](/gg/responses-as-code/) agent fills itself,
with `view.openText`, and — together with the documentation it looked up — it is what such an
agent can always act on: `view.close` is bound into every program's scope whatever the rest
of the capability set says, so the block can always name it. Unlike the file-view band it carries no nested
list, because its selectors are labels the agent chose and `view.current()` answers the same
question on demand, for free, without spending a slot of the window every turn to do it.

### Shares of named categories, and the files inside them

The block reports **shares**, and it names **files** under the file-view band, because
most of what fills a window is not something the agent can do anything about. Being told
the system prompt is 6,000 tokens, or the task list 2,000, is a figure it can read but not
use: it cannot reclaim either of them. What it *can* act on is precisely the file views it
has open and its own thread. A share says how much of the problem each category **is**;
the nested list says which reads to drop first, since `evict_file_view { path }` takes a
path and the per-*file* split is therefore the actionable unit.

That list names the [`topFileViews`](#parameters) most expensive open files, largest
first, and appears **only for an agent that actually has `evict_file_view`** — a ranked
list of reads it cannot drop is exactly the noise this block exists to remove. Repeated
reads of one path are summed into a single entry, because one `evict_file_view { path }`
reclaims all of them at once and three separate entries would understate what dropping the
file buys. A **locked** [autoloaded specification](/gg/autoload-specifications/) is
excluded: eviction is the removal locking exists to prevent, so listing it would be an
offer gg would refuse.

### It lives in a slot, not in the thread

The signal is **not** a thread item. It occupies a single **slot** rendered after the
conversation, and each turn's rebuild **overwrites** it, so a window can never hold two of
them. A [compaction](/gg/compaction/) empties the slot, so a reading taken before a
boundary can never be read after one.

A thread item could do neither, and both failures are worth naming because they are the
ones the slot exists to prevent. An item in the thread has to be retired *in place* when it
changes — deleting from the middle of a prompt invalidates everything after it — so every
refresh would leave the previous reading behind as history, a growing trail of superseded
figures the agent has to read past to find the current one. And a pinned item survives a
compaction, so a freshly emptied window would open by telling the agent it was still 80%
full.

The slot also settles the [append-only](/gg/context-visibility/) question outright. The
whole conversation — everything a provider's prompt cache can read — sits *before* the
signal, so rewriting it every turn changes only the **last message** of the prompt.
Nothing behind it moves and no cache prefix is invalidated. So the signal reports its
figures **exactly**: it has no position in the thread to hold still for, and rounding them
would buy nothing.

## Evicting file views

`evict_file_view` drops the contents of files the agent has read (the
`FileView`-sourced items `read_file` produced) from the **live** window, reclaiming
their tokens. This is safe: the files are unchanged on disk and can be re-read at any
time.

- `evict_file_view { path }` evicts the views of that one workspace path.
- `evict_file_view {}` (no `path`) evicts **every** file view.

The tool result reports what was reclaimed, and the next
[context breakdown](/gg/context-visibility/) shows the file-view band fall.

## Closing views, which no capability gates

Under [responses as code](/gg/responses-as-code/#showing-yourself-things) a program opens the
material in its own window, and `view.close(selector)` closes it again: every view carrying
that selector — for a file, every page of that path — returning how many it closed. Closing
something that is not open returns `0` rather than failing, so a program that tidies up
unconditionally does not have to guard every call.

The file and text bands are both swept. A selector is what the *model* wrote, and it has no
obligation to tell gg which of the two it meant, so one call reaches both rather than making
the agent pick. A read [skill](/gg/skills/) is not reachable at all — it is pinned material an
operator put in front of the agent, and the removal path spares every pinned item, by the same
rule that keeps an eviction off a locked
[autoloaded specification](/gg/autoload-specifications/).

**Documentation is bought, and not part of what `view.close` is *for*.** Closing a
documentation view is its own call, on the `docs` module, and it is bought by its own
capability — `docview-close`, **off by default**. The reason is a property nothing else in the
window has: opening documentation only ever *appends* to the prompt (re-opening something
already open does nothing whatever), so a provider's cached prefix survives every lookup an
agent makes for a whole session. A close removes an item from the middle and costs the run
every cached token after it. Whether that reclaim pays for the invalidation is a measurement
rather than an answer, so it is a toggle.

Until every program language's SDK spells that call, `view.close` also sweeps the
documentation band **for an agent that holds the capability**, and only for one — so a run
without `docview-close` still cannot reclaim a documentation view by any route, which is the
arm of the comparison the toggle exists to measure. The sweep is transitional: each arm's own
`docs.close` replaces it, and the sentence goes with it.

`view.close` sits **beside** `evict_file_view` rather than inside it, and the two differences
are the whole reason it is documented separately:

- **It is not gated.** `evict_file_view` is one of this capability's tools and an ablation
  can withhold it. `view.close` is bound whatever a run enables, because closing material the
  agent opened *itself* is not a privilege gg has any business withholding — an agent that
  could open views but never close them would have a window it can only fill.
- **The trade is not the same.** An evicted file view is recoverable: the file is unchanged
  on disk and can be read again. A closed **text** view held the agent's only copy of
  something it computed, so closing one discards it unless the agent wrote it down first. The
  telemetry keeps the bands apart for that reason — a close naming a workspace path is
  reported as an `evict_file_views` action, one naming a view label as `close_text_views`,
  and one naming a documentation lookup as `close_docs_views`, which is recoverable again
  (the lookup can simply be re-opened).

`view.close` reclaims from the live window exactly as an eviction does, so it resets the
provider's cache prefix from that point on, and the next
[context breakdown](/gg/context-visibility/) shows the band fall.

## Every result says which turn it is and what it costs

An agent that can archive is handed the two facts an archival needs. Every tool result in
its window is prefixed with a **turn header**:

```text
Turn #123
1,234 tokens
----
```

Without it the agent can see that its window is full but has no way to name *which* part
of the thread to move out of it: the turns are unnumbered, and what each one costs is
invisible. With it, "archive turns 4 through 19" is a decision the model makes from what
is in front of it.

The number is the agent's **session** turn. It is one-based — turn 0 is the un-numbered
opening context (the system prompt, the build prompt, any
[autoloaded specifications](/gg/autoload-specifications/), and the file views
[persistence](/gg/agent-persistence/) re-opens), which belongs to no turn the agent took
and so carries no header. And it is **monotonic for the whole life of the agent**: neither
a [compaction](/gg/compaction/) nor an archival ever renumbers it. An agent that read
`Turn #37` and later archives turns 12–20 has to be naming the same turns it saw, and a
counter that restarted at a compaction boundary would silently point that call at
different material.

The token figure is the estimate of the result **without** its own header, so the header
does not have to account for itself. It understates the result by the header's dozen or so
tokens, which is well inside what "estimate" already means here.

Headers are attached **only** for an agent that actually has `archive_thread`, so nothing
pays for them that cannot use them: without archival they would be a per-result tax on the
window buying the model nothing. Under
[responses-as-code](/gg/responses-as-code/) hardly anything carries one, and that follows
from what a code turn produces: a program's calls return **into the program**, so the turn
leaves no tool results behind. Everything gg puts in such a window is a headed `user`
message — a `File`, a `View: <label>` or a `Documentation: <fn>` view the program
[opened itself](/gg/responses-as-code/#showing-yourself-things), or one of the harness's own
messages — and each carries its heading alone, named by its selector rather than by a turn
number. The exception is a window **carried over from a tool-calling agent** by an
[`exec` or an FSM transition](/gg/fork-and-exec/): the tool results already in it keep the
headers they were pushed with, and `Output` is the heading such an item takes when a
[compaction](/gg/compaction/) re-frames it as a `user` message. That is what `Output` is for,
and equally why it is **not** one of the headings the code-mode system prompt
[lists](/gg/prompts/): a code-native agent will never be sent one.

## Archiving the thread, and searching it back

`archive_thread` moves whole turns out of the live window into a **searchable archive**,
then `search_archive { query }` recovers them on demand — the full text, never a summary,
reachable without occupying the window.

**Selection model.** `archive_thread { ranges }` takes a required, non-empty list of
**inclusive** `[from, to]` turn-number pairs: `[[4, 19], [22, 25]]` archives turns 4
through 19 and turns 22 through 25. At most **32** ranges in one call — generous relative
to any real archival, and present only so a malformed program cannot hand gg an unbounded
list. The numbers are the ones on the
[turn headers](#every-result-says-which-turn-it-is-and-what-it-costs) the agent has been
reading all along, so a range is something it can see rather than an offset it has to
compute. Ranges may be given in any order and may overlap; an item leaves the window if
**any** range contains it. A **reversed** range (`from` past `to`) is refused rather than
normalized: the two readings of `[19, 4]` — "nothing" and "turns 4 to 19" — differ by the
entire call, and guessing would archive a span the agent never asked for.

**Only the results are archived.** An archived turn's own **assistant message** is removed
from the window but is *not* written to the archive. What is worth recovering later is what
the turn *found* — the file it read, the command's output, the error — not the model's
narration of what it was about to do, which is the half of the thread that ages worst and
would otherwise be most of what a `search_archive` query matched.

The **pinned** prefix is never touched, however wide a range is: the system prompt, the
build prompt, read skills, locked [autoloaded specifications](/gg/autoload-specifications/),
and the *live* memory, task-list, and board blocks. Neither is the context-usage signal,
which is not a thread item at all. Superseded copies of those blocks are ordinary history
by then ([append-only](/gg/context-visibility/)), so they are archived and summarized like
any other thread material.

The call reports back the turns it actually emptied, so a range naming turns that are no
longer in the window — already archived, or summarized away by a compaction — says so
rather than reading as a success.

Under [responses-as-code](/gg/responses-as-code/) the same call is
`context.archiveThread([{ from: 4, to: 19 }])`.

The archive is append-only and grows for the life of the session; `search_archive` does
a case-insensitive substring match over each archived message's text (including the tool
calls it made) and returns the matching entries, capped so a broad query cannot itself
refill the window.

**The archive is a [module](/gg/modules/)**, and it travels the way modules do: a
[`fork`](/gg/fork-and-exec/) gets an independent copy, and an
[`exec`](/gg/fork-and-exec/) or an [FSM transition](/gg/fsms/) that names `archive` hands
it to the successor whole. One thing is deliberately carried rather than restarted across
either: an entry's **ordinal**. Two copies that both numbered from zero would each print an
entry as `#0`, and a search result quoting one would be ambiguous about which thread it came
out of.

This capability is one of the two that read an [`ownership`](/gg/modules/#ownership) param
(the other is [project management](/gg/project-management/)), and it is the one place the
answer barely shows: the archive is by definition *out* of the window, so
`"ownership": "unowned"` has no pinned block to withhold and takes away only the prose about
it. It is recorded, carried across a transfer, and otherwise changes nothing.

## Parameters

| Param | Default | Meaning |
| --- | --- | --- |
| `topFileViews` | 5 | How many individual files the context-usage signal names under **Top File Views**, most expensive first. |

It is set **per agent**, because how many reads a window holds at once differs enormously
between an agent that opens two specs and one crawling a codebase. The default is enough
that the reads actually worth dropping are in the list, and short enough that the block
stays a glance rather than a directory listing.

## What the console sees

Evict, [close](#closing-views-which-no-capability-gates) and archive each emit a
`ContextManaged` telemetry event carrying the `action`,
the `reclaimedTokens`, the number of `items` removed, and a human-readable `detail`
(the evicted paths, the closed labels, or how many turns were archived and the archive's new
size). A `view.close` reports one action per band it actually emptied — `evict_file_views`
for a path, `close_text_views` for a label, `close_docs_views` for a documentation lookup —
so the console can draw a **close** marker where the trade is "the agent's only copy is gone"
and an **evict** marker where it is "the file can be read again". The
underlying `ToolCall`/`ToolResult` still stream too; the `ContextManaged` event carries
the *effect*, which the console draws as a marker on the timeline and the context graph
next to the band drop the following breakdown shows. `search_archive` reclaims nothing,
so it is reported only as an ordinary tool result.

The archive itself is a [module](/gg/modules/), and it reports its **contents** too: an
`archive_state` snapshot as the agent opens and again after every archival, listing each
entry's ordinal, band, role and length with a bounded preview of its text — never the
bodies, since the whole purpose of archiving was to get that material out of the request.
The console reads it as the agent's `modules/archive` file and as an archive group on the
[Modules](/gg/modules/#inspecting-modules-in-the-console) tab, beside the reclaim figures
the `ContextManaged` events carry. An archive is carried whole across an
[`exec`](/gg/fork-and-exec/) and copied on a `fork` with its ordinals continued rather than
restarted, so an entry's `seq` means the same thing for the whole lineage.
