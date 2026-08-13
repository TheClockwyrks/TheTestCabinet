---
title: "Console surfaces"
---

The live monitor and a finished run's gg tab are one view over one stream: live,
then rebuilt from the recording, laid out identically down to the order of the
cards. Five surfaces read a run.

## Dashboard

The whole-run read-out: status, the token and cost tally with its caching (cached
against uncached input) and reasoning (reasoning against non-reasoning output)
splits shown as rings, an overview of the agents that ran, and the configuration
the run's [independent variable](/gg/overview/) is.

Beside the status sit the turns the session has spent across every agent and its
tokens per second, which is everything the run generated over the time it spent
inside its model calls, averaged across every model it used. A multi-model run's
card names each model's own rate on hover. The two counts say how much a run has
done and spent; the rate says whether the wall-clock behind them went into
generating or into waiting.

Under the turn count sits the errors row, which shares its denominator: one tile
for how many of those turns failed and what fraction that is, one for the longest
failing streak any one agent reached, and one ranking
[the types they failed with](/gg/telemetry/turn-outcomes/).

The clocks take a row of four tiles. Runtime is the wall clock, measured over the
run's execution, and it is what the ceiling on the
[time limit](/gg/execution-limits/) tile beside it is measured against. Active is
every agent's own time summed, and the gap between it and the wall clock is the
parallelism the configuration bought. Active means working: an agent blocked
waiting on its [subagents](/gg/subagents/) or on a
[board issue](/gg/project-management/) has freed its running slot, so its wait is
subtracted from that sum and reported on the Waiting tile instead, since folded
in a delegating run whose parents mostly wait would report a figure several times
the work it did. The count under those two tiles is how many agents are in that
state at this moment rather than how many contributed to the total.

Each agent in the overview reads as a row carrying its own turn count, the peak
its context window reached, its share of the run's tokens, and what it called,
chipped in that agent's own vocabulary. A tool-calling agent's chips name its
tools; a [code-shaped](/gg/responses-as-code/overview/) one's name the API
functions its programs wrote (`gg.files.readFile`). Each row links into that
agent's files in the Instances explorer.

The cost read-out leads the row it shares with the token tally and is the taller
tile, carrying the run's whole account of its spend with the configuration
slotted in under the tokens beside it. That account is the total; the split per
class (input, cached input, reasoning, output), pricing each token against the
model that produced it rather than at one blanket rate; the input-against-output
ring; and where the money went, as bars per slot, each naming the model that slot
was bound to, and bars per model, the same spend folded onto the models that did
it. Both are always shown. A run that binds one model per slot lists the same
rows twice, which is a fact about that configuration.

A run binds one model per [agent profile](/gg/configurations/), so every `usage`
event names the profile and model that spent it and every split above is derived
from the delta stream, from the run's first turn. The `slot_usage` rollups, one
per `(slot, model)` the run touched and all of them emitted once the run's last
agent has joined, carry the same figures for the durable record; a consumer sums
the deltas, never both.

## Agents

The run read per configured agent rather than per running one. A configuration
declares agent [profiles](/gg/configurations/) and the run makes as many
instances of each as the work calls for, so a profile that spawns twelve
implementers is one arm of the experiment. This panel groups the instances by the
profile they ran under and sums them.

It is one collapsible row per agent, all closed to begin with. Closed, a row is
the comparison line: instances, turns, tokens, cost, and peak context, each with
its share of the run. The panel is therefore a short list to read down a column
of. A profile the configuration declares but the run never instantiated still
gets a row, because "the reviewer never ran" is a result.

Clicking a row opens that agent's detail, and only that agent's: how many
instances ran and how they ended, what a typical one cost, how full a typical
window got against the worst one, how often they compacted, the same Tokens and
Cost widgets the Dashboard uses, what they called between them, and the
[context spend](/gg/telemetry/context-spend/).

The detail leads with the profile's instances, one chip each, opening that
instance in the Instances explorer. Every figure under them is a sum over them.
What the profile asked for (the capability chips) and what gg resolved out of
them annotate those instances, in that order. The offered set is headed Tools or
APIs by the mode the instances reported answering in.

That offered set is a union across the profile's instances rather than a sum. An
offered set is not a quantity, and instances of one profile legitimately differ,
since where an instance stands in its [machine](/gg/fsms/) gates what it may
call. An entry only some of them were offered carries the fraction that says so.
An entry the profile never called reads a real `0×` and is muted rather than
removed, which is the contrast the section exists for.

The observed-usage section at the foot of the detail is the other half of that
contrast and is a separate read-out. It is headed by the surface its instances
called on: API calls for a [code-shaped](/gg/responses-as-code/overview/)
profile, Tool calls for a tool-calling one, the same naming an instance's
Overview gives its Failed API calls and Failed tool calls ranking, and it
itemizes the profile in that surface's own vocabulary.

Under the offered set sits the one read-out on the panel that is not a sum: what
this profile's instances hold. Module state does not fold, since twelve instances
may be reading one store or twelve, and which of those it is is the configuration
under test. Each [module](/gg/modules/) kind therefore states its distribution.
The one shape whose contents belong to the agent, a single store every instance
binds at once, shows them inline.

## Instances

Everything else, one running agent at a time. The rich views are per agent: the
prompt the agent was given, activity, the context-window breakdown, the message
log, and the [metric graphs](/gg/telemetry/turn-timing/). Which agent's window
filled, and which agent's requests these were, are the questions they answer.

The explorer lays the run out as a filesystem. Every agent is a folder, the
things you can monitor about it are its files, and every agent an agent spawned
is a folder under a `subagents` folder, so the [delegation tree](/gg/subagents/)
is the directory tree, rooted at the main agent. What the agent holds lives one
level in, under a [`modules` folder](/gg/modules/) of its own: a file per module,
each stating which store it is, who else is holding it, and what it costs this
window, so an agent's own files stay facts about the agent and a store four
agents share is legible as one store from any of them.

An agent that succeeded another through an [`exec`](/gg/fork-and-exec/) or an
[FSM transition](/gg/fsms/) hangs directly off its predecessor's folder, tagged
with where it came from (`⇢ verify`, `⇢ exec`), so a chain of incarnations reads
as one lineage. A [`fork`](/gg/fork-and-exec/) is a genuine child and goes under
`subagents`, tagged `⑂ fork`. Either way the arriving agent's Overview states
what it inherited: the state it entered, and which [modules](/gg/modules/) were
carried, copied, linked, dropped and started fresh. Both halves of the handoff
appear in the activity feed on the streams they landed on.

Each agent folder leads with its lifecycle dot (running, waiting, done, failed)
in place of a folder glyph and carries the profile it runs under on the row's
trailing edge. Only the main agent is named `root`. An agent the board
[dispatched for an issue](/gg/project-management/) is a top-level folder beside
it and reads by its own issue-derived name (`AUTH-1.0i`, its reviewers
`AUTH-1.0i.0r`) everywhere it is named: the tree, its Overview, and the
Dashboard's agent overview.

### Which files an agent has

A file is offered when the run's configuration justifies it rather than when data
happens to arrive. A capability the run has always has its file, showing its own
"nothing yet" state until the first event streams; a capability the run lacks has
none; Context is always offered, because every run has a window that fills.
Overview, Prompt and activity are unconditional, because every agent was given
something. A subagent was given the brief its parent handed it, which rides on
the always-present spawn event; the main agent was given its opening prompt.

Directly after Prompt sits the one file gated on the instance rather than on the
configuration: what that instance was
[offered to call](/gg/telemetry/agent-surface/). It is named `tools` for an agent
that answers in tool calls and `apis` for a
[code-shaped](/gg/responses-as-code/overview/) one, and it is offered exactly
when that instance reported a surface. An instance read before its surface event
arrives has no such file, since a file showing an empty toolset would assert the
very thing it exists to distinguish.

Every row reads count first (`12× read_file`), so the figures line up in a fixed
leading column that can be read straight down the list. A tool the instance never
reached for reads a real `0×` and is muted rather than dropped, which is the
point of the file; the row's hover text says the same zero in the same words
("offered, 0 calls") and spends the rest of its length saying that this is a
finding about something the agent held. The list is the resolved surface gg
reported on the instance's own event rather than a re-reading of the
configuration, so what the file shows is what the model was given.

A code agent reads the same thing through its modules: one card per module,
carrying the one-line description its own system prompt introduced the module by,
over the functions this instance bound, each carrying its own count. No gg tool
name appears on that file. gg records a model-facing call under the operation it
resolved to, so a view call, a documentation lookup, an ending call and a
[program-library](/gg/program-library/) call are counted exactly as a file read
is, and three functions over one implementation (`gg.files.readFile`,
`gg.files.readTextFile` and `gg.views.openFile` all perform one read) are three
figures rather than one shared between them. The file's own heading names the
documentation mode this instance ran under, because the tokens that mode cost are
this agent's own. Every row carries a figure, so a `0×` is a bound function the
model did not use rather than a gap in the record.

### The Overview file

The Overview carries the agent's own call breakdown: everything it called, how
many times, and how much each call's results added to its window. What it was
offered is the file above; the two are named apart because they are the two
halves of one question. Like every read-out of what an agent did, the breakdown
is taken on the surface that agent called on and says which in its caption: Tool
calls for a tool-calling instance, API calls for a code-shaped one. The API view
carries no per-entry token column: a code turn produces no tool-role messages, so
there is nothing in the window to attribute per function.

Beside it sits the agent's Errors widget: its errored turns against the turns it
took, its worst unbroken streak of them, its ranked
[error types](/gg/telemetry/turn-outcomes/), and the calls it failed, ranked by
class. The run-wide figures on the Dashboard are a sum, in which an instance that
failed every turn and one that failed none are indistinguishable. The call
ranking is captioned Failed API calls for a
[code-shaped](/gg/responses-as-code/overview/) instance and Failed tool calls for
a tool-calling one: the first is what the model's own programs were thrown,
including the calls no gg tool ever ran, and the second is what gg dispatched.
They are never summed with each other, and never mixed into the turn ranking
above them, which counts turns rather than calls.

The Overview also states the agent's working directory, which is the isolated
[worktree](/gg/project-management/) checkout its tools are rooted at or the
shared workspace. While the agent is blocked it states what the agent is waiting
on. `blocked` on its own is indistinguishable from stuck, so the wait names its
condition: the issue it suspended for, or the subagents it is collecting.

## Modules

The run read by the state it holds rather than by the agents holding it, sitting
between Instances and Project. Module instances are grouped by kind, one row per
backing store however many agents hold it, and each kind's group leads with a
whole-run [overview](/gg/modules/) of how that capability is being used: how many
stores exist, how widely they are shared, what they cost every turn, and how many
were never written to.

It exists because the Dashboard, the Agents panel and the Instances explorer are
all read per agent, which is the wrong axis for a thing several agents can hold
at once. Read per agent, one store shared by four reviewers looks exactly like
four stores that happen to agree, which is the difference between "the
shared-memory arm worked" and "it fell back to private notebooks". The surface is
offered whenever the run enables a module-backed capability.

## Project

The run-global [project management](/gg/project-management/) board. The board is
shared run-wide, so it is its own top-level section rather than a file under any
one agent.
