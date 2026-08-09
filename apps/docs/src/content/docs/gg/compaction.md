---
title: "Compaction"
---

When a thread approaches the active model's context-window limit, gg **summarizes
the thread and restarts it from the summary**, so the model can keep working
"beyond" its context window. Compaction is what lets a gg run continue *within* one
logical session instead of needing an [orchestrator](/orchestrators/overview/) to
loop it.

Requirements:

- Trigger when the thread nears the **active model's** window (the threshold is
  defined by the `summaryHeadroom` capability parameter, not a constant — and note
  that [agents](/gg/configurations/#agents) on different models have different window
  sizes).
- Produce a summary that preserves enough working state for the model to continue
  without losing the thread of what it was doing.
- **Preserve pinned state across the boundary.** Compaction is not just
  summarization — several other capabilities have state that must *survive*
  compaction verbatim rather than be summarized away. Compaction is the capability
  that makes "retained across compaction" mean something.

## Compaction strategies

*Who* condenses the thread, and *what* the restarted context is rebuilt from, is a
**swappable strategy** — so a study can compare which one retains the most useful
state without changing anything else about a run. The compaction capability's
**Summarization strategy** field selects it (empty picks the default).

Five ship, and they divide along two axes: who does the condensing, and what the
answer is.

### The agent condenses its own thread

Performed *by the agent*, across a turn boundary: gg appends an instruction, the
agent's **next turn** supplies the answer, and until it does **every other tool
call is refused** — the window is already full, so anything else only makes it
worse. A model that never complies stops on the run's
[error ceilings](/gg/execution-limits/) rather than looping.

- **Self-summarization** (`self-summarization`, the default) — gg asks the agent to
  summarize the work done and the work remaining, and its next reply (plain text, no
  tool calls) *is* the summary the thread restarts from. Under
  [responses-as-code](/gg/responses-as-code/) that one turn is prose rather than a
  program, and gg says so in the request.
- **Self-compaction** (`self-compaction`) — the agent calls a **`compact` tool** with
  a `summary` **and** a `files` list of workspace paths, which gg re-reads into the
  restarted context as fresh file views. It is the only strategy where the model
  chooses not just what the recap says but which material it keeps in hand. The tool
  is offered on **every** turn of such a run (a model may compact itself whenever it
  likes), which is also what keeps the offered tool set — and so the provider's
  prompt cache — stable at the moment the window is fullest. In code mode it is
  `context.compact(summary, files)`.
- **Memory compaction** (`memory-compaction`) — there is no summary at all. gg
  requires the agent to record its working state as [memories](/gg/memories/), which
  are retained verbatim across the boundary, and accepts only memory calls until one
  whole reply's calls have all succeeded. It **requires memories the agent may write**;
  an agent with no memories at all — or one holding somebody else's
  [read-only](/gg/memories/#what-a-read-only-holder-is-offered) — falls back to the
  default, with a warning, rather than stalling on a gate it could never satisfy. A
  read-only holder is offered no write call, so the pending compaction would wait for a
  reply it had no way to compose and the run would wedge against a full window.

### A separate model condenses it, out of band

The two **handoff** strategies are the ones performed *between* the agent's turns, by
a call it never sees — the working agent is never interrupted, is never offered the
`compact` tool, and its next turn simply finds a smaller window. They condense on a
*different* model, named by the capability's **Compaction model** (`model`) param and
resolved through the same client factory every agent's model is.

The thread is rebuilt before the handoff model sees it: the working agent's system
prompt, skills and memories are dropped (they are retained anyway, so restating them
only invites the summarizer to summarize state that is not being dropped), and
**every message is converted to a `user` message under a `<label>\n----\n`
heading** — the same headings [responses-as-code](/gg/responses-as-code/) uses, with
an assistant turn labelled `Assistant`. That last transform is load-bearing: left as
assistant messages, the working model's turns read to the compaction model as its
*own* prior output, and a model summarizing what it believes it just wrote produces a
first-person account of work it never did.

- **Handoff summarization** (`handoff-summarization`) — the compaction model is given
  no tools and answers with prose.
- **Handoff compaction** (`handoff-compaction`) — the compaction model is given only
  the `compact` tool, and the request *requires* the call, so it chooses the files to
  re-read as well as the summary.

A handoff whose named model cannot be resolved condenses on the agent's own model
instead and says so in a `warn`: a misconfiguration is not a reason to stop
compacting, and a run that stopped compacting would overflow its window a few turns
later.

#### Picking the model at launch

The compaction model can be **deferred to a [model slot](/gg/configurations/)** instead
of pinned in the configuration, exactly the way an agent's own binding is: the editor's
*Model from* selector offers "a model slot (at launch)" beside "a specific model (fixed
here)", and the launch form then asks for that slot along with every other one the
configuration declares. Deferring writes a `modelSlot` param beside `model`; launching
fills the slot in, writes the collected id to `model`, and drops `modelSlot` — so the set
a run records is fully pinned, and one configuration can sweep the summarizer across
models without being edited.

A set that reaches gg still carrying `modelSlot` named a slot nobody bound. gg warns on
the root stream and treats the handoff model as unset, which is the ordinary fallback:
the agent condenses on its own model.

### Common to all five

Every strategy carries the pinned state forward verbatim (below); they differ only in
how the *history* is condensed. A run naming a strategy gg doesn't recognize falls
back to the default (**self-summarization**) rather than failing to launch, so a sweep
can reference a not-yet-built strategy without breaking. Adding an out-of-band
strategy is a drop-in behind the `Summarizer` trait in `crates/gg/src/compaction.rs`;
adding an in-loop one is a variant of `PendingCompaction` beside it.

A compaction that could not be produced — a failed model call, or an agent that
answered the request with nothing usable — still happens: the window is full either
way, and a run that declined to compact would simply overflow on its next turn. It
falls back to a fixed note and is **flagged as a fallback** on the record, so a study
reads it as the failure it is rather than as a terse strategy.

Every compaction is **recorded per agent** so the strategies can be compared by
what they actually retained. Each boundary carries the strategy that ran, the
fullness that triggered it, the window it reclaimed, the per-source composition
*just before* and *just after* the drop, the retained-state counts, and the
**summary text itself** (with a flag when a failed summarization fell back to
gg's fixed note). The console surfaces this as the per-agent **Compaction** view —
the detail behind the compaction markers on the Context graph — where you can read
each summary side by side with the bands it collapsed. Because the composition is
on the compaction record itself, the view works whether or not
[context visibility](/gg/context-visibility/) is on, live and after the run.

## Enabling compaction shrinks the window the agent gets

Summarizing is itself a model call over (nearly) the whole thread: at the trigger the
summarizer has to fit the transcript **and** write a summary within the same context
window. Measured against the model's full window, a run can therefore trip the
trigger at a point where the compaction meant to save it no longer fits.

So gg makes the reserve explicit. When compaction is on, the window the agent is
given — the denominator of every fullness figure, the graph's ceiling, and the
trigger's basis — is the model's window **less the `summaryHeadroom` fraction**,
20% by default. The agent works against the reduced window; the held-back slice is
the room the summarization round-trip runs in. Against a 200k model that is 160k of
working window.

The `summaryHeadroom` is the single knob: the fullness threshold that triggers a
compaction is **`1 - summaryHeadroom`** — the point at which the working window is
full and only the reserved headroom remains — not a separately configured value. At
the default 20% headroom the trigger is 0.8, firing at ~128k of that 160k working
window.

With compaction off nothing is reserved, since there is no summarization call to
make room for — which is also why the `no-compaction` [configuration](/gg/configurations/)
is a clean overflow arm: it gets the whole window and simply runs out of it.

`summaryHeadroom` is the compaction capability's one tuning parameter, accepting
`0.0`–`0.9` (a value outside that keeps the default). Set it to `0` to hand the
agent the whole window and accept the risk (and trigger only at 100% full); raise
it for a summarizer whose prompt is heavier than the default's — which also lowers
the trigger to match.

Compaction summarizes the *history* and carries the following state forward
verbatim, forming the fixed prefix of the post-compaction context window:

- **[Skills](/gg/skills/)** — the list of available skills, plus the full contents
  of any skills that have been **read**.
- **[Tasks](/gg/tasks/)** — the active task list.
- **[Memories](/gg/memories/)** — the same treatment as skills: the list, plus the
  contents of those in play.
- **Locked [autoloaded specifications](/gg/autoload-specifications/)** — a spec pinned
  into the window stays there, picture and all.
- **The files a `compact` call named** — re-read fresh, as ordinary (evictable,
  re-readable) file views, and placed before the summary so the recap is the last
  thing the model reads.

The [Project management](/gg/project-management/) board is likewise retained across a
compaction boundary. That list is not hand-maintained: what crosses is whatever the
agent's [modules](/gg/modules/) pin, so a module the agent does not hold contributes
nothing — and neither does an [unowned](/gg/modules/#ownership) board, which was never in
the window to carry over.

One thing crosses a boundary without being in that list at all: the
[code an agent has loaded](/gg/skills/#code-skills) from a code skill or memory. It is not
context — it costs no tokens and there is nothing of it in the window to summarize — so a
compaction simply does not touch it, and `lib` is bound after the boundary exactly as it was
before. Making an agent re-read its skills to get its helpers back would be friction with
nothing on the other side of it.

[Agent-managed context](/gg/agent-managed-context/) is the model-facing complement to
compaction: compaction is the automatic backstop when the window fills; agent-managed
context lets a disciplined agent avoid ever hitting it.

## A text view does not survive a compaction

Everything the retained list above does not name is ephemeral working material, and a
compaction summarizes it away. That includes the **agent views** a
[responses-as-code](/gg/responses-as-code/#showing-yourself-things) program opened with
`view.openText` — the summaries, diffs and tables it composed and showed itself. They are
dropped like any other ephemeral item, and nothing re-seeds them: a `compact` call's `files`
list re-reads **files**, and there is no equivalent for a view whose contents exist nowhere
but the window that is being emptied.

That asymmetry is the honest one rather than an oversight. A file view can be re-seeded
because the file is still on disk and gg can go and read it; a text view is the agent's only
copy of something it computed, so "re-seed it" would mean copying it across the boundary
verbatim, which is the one thing compaction exists **not** to do — carrying an unbounded set
of agent-composed text through a boundary would defeat the reclaim it was triggered for.

So an agent that wants working state to outlive a boundary writes it somewhere with a truth
of its own:

- a [memory](/gg/memories/), which is retained verbatim across every boundary and is the
  mechanism built for exactly this (the `memory-compaction` strategy above is that idea
  taken to its conclusion); or
- a **file** in the workspace, which it can then name in a `compact` call's `files` list, or
  simply re-open with `view.openFile` afterwards.

The summary itself is the third option and often the right one: a view worth keeping is
usually worth describing in the recap the thread restarts from.

Extending the `compact` request to name views was considered and is deliberately not done:
it would give the model a second list to curate at the moment its window is fullest, for
material it can already preserve through either of the two mechanisms above.

A **documentation view** is the exception, and it survives — **without the model naming it**,
unlike a file. It is ephemeral like every other view, so the reset takes it; gg then re-opens
each one, in the order it was first opened, before appending the summary.

It is carried across by its **key**, never by its bytes. The documentation for one name is a
pure function of that name, this agent's language and what its scope binds, and none of those
can change while an agent runs — so what crosses the boundary is the name, and the body is
rendered again on the far side. That is the same principle a re-read file follows, for a
different reason: a file is re-read because its truth can have moved, and a lookup is
re-rendered because there is no second copy of it worth storing.

Why it is carried at all, when a text view is not: documentation is neither the agent's
material nor the workspace's. It is the description of the surface the agent is working
through, and with on-demand lookup as the only route to it, an agent that compacted would come
back holding no reference to the API it was in the middle of using — and nothing in its window
to tell it that is what happened.

## A succession compacts before its first turn

When an agent [becomes another agent](/gg/fork-and-exec/) — an `exec`, or an
[FSM transition](/gg/fsms/) — the window it hands on is measured against the
**successor's** compaction setup: its threshold, its strategy, its handoff model, and
above all its own window limit. So the check runs once before the successor's first
turn, and an agent that filled a million-token window and then moved into a state on a
32k model is over its window the moment it arrives and compacts immediately.

gg deliberately does no more than that. If two profiles' windows differ greatly, the
answer is to configure a strategy whose summarizer runs on a **separate model** — the
`model` / `modelSlot` handoff above — because a summarization that has to fit inside
the smaller of the two windows is exactly the case the handoff strategies exist for.
That is a configuration decision and gg has no basis for guessing at it.
