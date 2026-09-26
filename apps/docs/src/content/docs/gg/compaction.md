---
title: "Compaction"
---

Compaction summarizes a thread that has filled the window it was given and
restarts it from the summary, so one gg session continues past the active
model's context window. It is an opt-in capability (`compaction`), named per
agent in a [configuration](/gg/configurations/).

Requirements:

- Fire at a turn boundary, never between an assistant message and the results of
  the tool calls it made.
- Fire when window fullness reaches the trigger and there is ephemeral history
  to reclaim.
- Summarize the ephemeral history and carry the pinned state across the boundary
  verbatim.
- Complete once triggered. A failed summarization restarts the thread from a
  fixed note and records that it did.
- Give the window back. A boundary that leaves the window still at the trigger
  is retried while `maxRetries` allows one, and ends the agent as failed when it
  does not.

## The reserved headroom and the trigger

Condensing a thread is itself a model call over nearly the whole thread: at the
trigger the summarizer has to fit the transcript and write a summary inside the
same window. So the window an agent is given, which is the denominator of every
fullness figure and the basis of the trigger, is the model's window less the
`summaryHeadroom` fraction. The held-back slice is the room the summarization
round-trip runs in. Against a 200k model at a headroom of `0.2` the agent works
against 160k.

`summaryHeadroom` is the capability's main tuning parameter, and an enabled
compaction capability writes it. It accepts `0.0` to `0.9`; a value outside that
range, one gg cannot read as a fraction, and an absent one each refuse the
launch. The fullness threshold that fires a compaction is `1 - summaryHeadroom`,
so at `0.2` the trigger is `0.8` and fires at roughly 128k of that 160k working
window. Setting the headroom to `0` hands the agent the whole window and
triggers only at 100% full.

Compaction is a per-agent capability, and so is the window it reserves out of:
each agent's headroom comes off its own profile, so a run may compact its
implementer at `0.8` of a narrowed window while its reviewer is measured against
its model's whole one.

With compaction off nothing is reserved and the agent is measured against the
model's whole window. A run configured that way overflows rather than
compacting.

## What crosses a boundary

Compaction summarizes the history. The following state is carried verbatim and
forms the fixed prefix of the restarted window:

- [Skills](/gg/skills/): the list of available skills, plus the full contents of
  any that have been used.
- [Tasks](/gg/tasks/): the active task list.
- [Memories](/gg/memories/): the list, plus the contents of those in play.
- The [project board](/gg/project-management/).
- Locked [autoloaded specifications](/gg/autoload-specifications/), pictures
  included.

That list is what the agent's [modules](/gg/modules/) pin, so a module the agent
does not hold contributes nothing.

Two further things cross without being pinned material:

- The files a `compact` call named. They are re-read fresh and placed before
  the summary as ordinary evictable file views, so the recap is the last thing
  the model reads.
- Documentation views. Each open view is re-derived from its key and
  re-opened, in the order it was first opened, without the model naming it. The
  documentation for one key is a pure function of that key and the agent's
  scope, so what crosses is the key and the body is rendered again on the far
  side. A key that no longer resolves is dropped.

The [code an agent has loaded](/gg/skills/#code-skills) from a code skill or
memory is not context and costs no tokens, so a boundary does not touch it and
`lib` stays loaded exactly as it was.

Everything else is ephemeral and is summarized away, including the text views a
[responses-as-code](/gg/responses-as-code/overview/) program opened. A `compact`
call's `files` list re-reads files and has no equivalent for a view whose
contents exist only in the window being emptied. An agent that wants composed
material to outlive a boundary writes it to a [memory](/gg/memories/), which is
retained verbatim, or to a file it can name in `files` or re-open afterwards, or
describes it in the summary itself.

## Compaction strategies

Who condenses the thread, and what the restarted context is rebuilt from, is the
capability's `implementation`, and an enabled compaction capability names one.
Five strategies ship. An `implementation` that is absent, or that names anything
else, refuses the launch, with the error naming the five that exist.

### In-loop strategies

Three strategies are performed by the agent across a turn boundary. gg appends
an instruction, the agent's next turn supplies the answer, and until it does
every other call is refused with a message naming what was refused and what is
wanted.

- Self-summarization (`self-summarization`). gg asks the agent
  to summarize the work done and the work remaining, and its next reply is the
  summary the thread restarts from. Under
  [responses as code](/gg/responses-as-code/overview/) every reply is a program,
  so the summary arrives as a `compact` call carrying it.
- Self-compaction (`self-compaction`). The agent calls `compact` with a
  `summary` and a `files` list of workspace paths, which gg re-reads into the
  restarted context. One call may name up to twelve paths, and paths past the
  cap are reported back rather than dropped silently. The tool is offered on
  every turn of such a run, which keeps the offered tool set and the provider's
  prompt cache stable at the moment the window is fullest.
- Memory compaction (`memory-compaction`). There is no prose recap. gg
  requires the agent to record its working state as [memories](/gg/memories/),
  which are retained verbatim, and accepts only memory calls until one whole
  reply's calls have all succeeded. The strategy requires memories the agent may
  write, so a profile that names it without the memories capability, or with a
  read-only memory scope, refuses the launch. An instance whose
  live scope resolves to read-only ends the run under
  [`internal_error`](/gg/execution-limits/#ggs-own-defects).

### Handoff strategies

The two handoff strategies run between the agent's turns. The working agent is
never interrupted and never offered the `compact` tool; its next turn finds a
smaller window. They condense on the model the capability's `model` parameter
names, resolved through the same client factory every agent's model is. The
parameter is optional, and a capability that names no summarizer condenses on the
working agent's own model. A named summarizer runs at its provider's default
reasoning, while one that falls back to the working agent's model carries that
agent's [reasoning setting](/gg/configurations/#reasoning-effort).

- Handoff summarization (`handoff-summarization`). The compaction model is
  given no tools and answers with prose.
- Handoff compaction (`handoff-compaction`). The compaction model is given
  only the `compact` tool and is required to call it, so it chooses the files to
  re-read as well as the summary. The call is pinned the way a responses-as-code
  turn's is, and asked for on `auto` for a model whose provider
  [refused the pin](/gg/responses-as-code/programs/#the-submission-gg-accepts).

The thread is rebuilt before the handoff model reads it. The working agent's
system prompt, skills and memories are dropped, since they are retained anyway
and restating them invites the summarizer to condense state that is not being
dropped. Every remaining message becomes a `user` message under a
`<label>\n----\n` heading, with an assistant turn labelled `Assistant`. Left as
assistant messages, the working model's turns read to the compaction model as
its own prior output, and it would then write a first-person account of work it
never did.

A `model` that is written is resolved at launch against the model catalog every
agent's own binding is resolved against, so a handoff strategy naming a model gg
cannot resolve refuses the launch. A model that resolves and then cannot be
reached during the run ends the run under
[`internal_error`](/gg/execution-limits/#ggs-own-defects), since a run that
condensed on a different model than the one it records is a run whose strategy
was never measured.

#### Picking the compaction model at launch

The compaction model can be deferred to one of the agent's own
[model slots](/gg/configurations/#agent-slots) instead of pinned in the
configuration, the same way the agent's own binding is. The editor's Model from
selector offers the agent's slots alongside a specific model, and the launch form
then collects that slot with every other launch input the configuration exposes.
Deferring writes a `modelSlot` parameter beside `model`;
launching writes the collected id to `model` and drops `modelSlot`, so the set a
run records is fully pinned and one configuration can sweep the summarizer
across models.

A set that reaches gg still carrying `modelSlot` named a slot nobody bound, and
refuses the launch.

## When a compaction does not relieve the window

A compaction exists to hand the agent back a window it can work in. One that
comes back still at the trigger did not: the next turn assembles the same
over-full window and asks for the same compaction, and an agent left to carry on
compacts at every boundary for the rest of the run without ever advancing.

So gg counts the boundaries that fire without getting the window back under the
trigger. `maxRetries` is how many of those are tried again, and it is optional:
absent, it is none, which means one compaction and an agent that compaction
could not relieve is **failed**. The
session ends with a terminal status of `compaction_failed`, which is a failure
status in exactly the sense `model_error` and `hook_error` are, and never a
ceiling ending: no bound of the operator's was crossed, the run's own backstop
stopped working.

The count is per agent and per incarnation, and it is cleared the moment the
window is seen below the trigger — so a compaction that worked, followed by an
honest refill hours later, is two first attempts rather than a second one.

Writing a figure arms a retry. It is worth arming only where the first pass can
plausibly do better on a second: a strategy whose summary can come back nearly
as long as the thread it replaced. It cannot help where the window is over the
trigger because the _pinned_ prefix alone fills it — skills, memories, the board
and locked specifications all cross the boundary verbatim, so no number of
retries reclaims a byte of them. That configuration wants a wider window or less
pinned state, and gg says so rather than compacting round in circles.

The retry is immediate for a handoff strategy, which gg performs at the boundary
itself: the window it produced is judged on the spot and the next attempt (or
the failure) happens without spending a model turn. For an in-loop strategy the
agent writes the summary, so the retry is the next boundary's — the same
attempt, one turn later.

## Failed condensations

A compaction that could not be produced, whether from a failed model call or an
agent that answered with nothing usable, still happens. The window is full
either way. The thread restarts from gg's fixed note, and the record flags the
summary as a fallback so a study reads it as the failure it is rather than as a
terse strategy.

## What a boundary records

Every compaction is recorded per agent, carrying the strategy that ran, the
fullness that triggered it, the tokens before and after, the per-source
composition just before and just after the drop, the retained-state counts, and
the summary text with its fallback flag. A boundary also fires the pre-compact
and post-compact [hook](/gg/hooks/) events.

The console renders this as the per-agent Compaction view, the detail behind
the compaction markers on the Context graph, where each summary is read beside
the bands it collapsed. The composition is on the compaction record itself, so
the view works live and after the run.

## Compaction at a succession

When an agent [becomes another agent](/gg/fork-and-exec/) through an `exec` or
an [FSM transition](/gg/fsms/), the window it hands on is measured against the
successor's compaction setup: its threshold, its strategy, its handoff model and
its own window limit. The check therefore runs before the successor's first
turn, and an agent that filled a million-token window and then moved into a
state on a 32k model is over its window on arrival and compacts immediately.

## Related

An agent can also reclaim window space itself rather than waiting for this
backstop. See [agent-managed context](/gg/agent-managed-context/).
