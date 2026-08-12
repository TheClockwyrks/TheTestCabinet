---
title: "Agent holdings and surface"
---

Two events open every incarnation and answer two different questions.
`agent_modules` says what the instance holds; `agent_surface` says what it may
call. Both are emitted once per incarnation, for the root, every subagent and
every successor alike. Neither is re-emitted, because everything that changes
what an agent holds or may call mints a new agent id, and the arriving instance
reports its own.

## Module identity on the stream

A [module](/gg/modules/) instance is not one-to-one with an agent instance. One
store can be held by several agents at once, carried whole to a successor, or
copied when its holder forks, so the stream carries the store's identity rather
than leaving a reader to infer sharing from panels that happen to match. Four
things carry it.

`agent_modules` is the roster: one row per module kind, naming the store the
instance bound (`memories-2`), whether the capability is on, whether the prompt
[carries](/gg/modules/) it, how this holder came by it (`created`, `inherited`,
`profile`, `run`, `transferred`, `forked`), whether this holder may write it
(always so for the kinds with no access model of their own), and, for memories,
the declared `scope`. It is emitted immediately after that instance's
`agent_spawned`, and after its `fsm_state` where it stands in a machine.

It is the only event that reports a module an agent holds but has not yet
touched, which is what makes a read-only inherited holder that never writes
appear in the record. It carries no holder count: a count is stale the moment a
sibling spawns, while every instance's roster together is the exact holder set,
live status included. Rows are emitted for the kinds the profile switched off as
well, so an [ablation](/gg/toolset-ablation/)'s off arm is legible.

The `scope` and `origin` pair is the only place a declared binding rule and the
resolved answer to it appear side by side, so a holder reporting
`scope: inherited` with `origin: created` is one whose inheritance fell back,
which the console reports as a divergence.

`module_id` rides on every state snapshot. `memory_state`, `tasks_state`,
`board_state` and `skills_state` each name the store they are a snapshot of
rather than only the agent that emitted them. That lets a consumer attribute two
agents' identical panels to one store, and lets a store's contents be shown once
under the store rather than once per holder.

`archive_state` is what `archive_thread` has put away, emitted as an agent
opens with the capability on, and again after every archival, beside the
`context_managed` event that records the act. The two answer different questions:
that one says the window was reclaimed by this much, this one says what is now
out of it. Entries carry the ordinal, band, role and length, plus a bounded
preview. Bodies stay out: the [archive](/gg/agent-managed-context/) exists so
that material is out of the request, and the searchable body is recoverable
through `search_archive`.

`agent_transition.modules` is the per-kind account of a
[succession](/gg/fork-and-exec/), carrying both store ids, so a fork's linked
board and its copied task list are distinguishable and a store swapped underneath
a successor is visible as the two different ids it is.

## The offered surface

`agent_surface` is the offered set. It carries how the instance answers a turn
(`executionMode`, `tool_calling` or `responses_as_code`), which language its
programs are written in (`programLanguage`), which SDK types its documentation
lookups open beside a function (`docViewTypes`), every gg tool it was offered
(`tools`), the capability modules a
[responses-as-code](/gg/responses-as-code/overview/) agent's programs bind
(`apis`), and the ablation gg applied to it (`withheld`). It is un-gated: an
agent offered nothing at all still says so, which is a finding rather than an
absence.

### `tools`

The resolved set, read off the registry gg hands the provider: after the
capabilities this profile has, the [modules](/gg/modules/) it bound, the
[memory](/gg/memories/) strategy behind them, where the instance stands in its
[machine](/gg/fsms/), and the per-tool `disabledTools`
[ablation](/gg/toolset-ablation/) that strikes a tool whose capability is on.
Re-deriving it from the run's capability set can know none of those, which is why
it is a fact the run reports rather than one a console computes. It is populated
in both execution modes: a code agent reaches these same tools through its
modules, and its calls are recorded under these names.

It ends with the ending calls the agent's dispatched role may finish on:
`finish`, or a reviewer's `approve` and `request_changes`. Those are appended by
the loop rather than contributed by a capability, and the model is offered them
every turn, so a surface that left them out would answer "was `finish` offered?"
with silence.

### `apis`

Present only for a code agent, and empty for a tool-calling one, which has no
such surface. One entry per capability module, named twice: gg's cross-arm id for
it (`module`: `files`) and this arm's own spelling of it (`path`: `gg.files` in
TypeScript, `gg::files` in Rust). A reader comparing two language arms groups by
the id; a reader quoting what the model wrote uses the spelling.

Each entry carries the one-line description the agent's own system prompt
introduced the module by, and the functions this instance bound. A module nothing
bound is absent rather than listed empty. What is reported is exactly the
catalogue's own entries, so the read-out and what a program's scope binds are one
projection of one array.

Each function names the operation it serves (`files.read_file`,
`views.open_docs_view`, `session.finish`), and that field is load-bearing: every
call a program makes is recorded as an `api_call` under exactly that id, so it is
the join from a bound function to how many times it was called. No gg tool name
appears here. A responses-as-code agent writes `gg.views.openFile`, and the
`read_file` underneath is gg's business.

The join is at the grain of the operation, which makes both directions of the
contrast trustworthy. A function with no tool behind it is counted like any
other, so an ending call and a view call have figures instead of blanks, and
three functions over one core (`gg.files.readFile`, `gg.files.readTextFile` and
`gg.views.openFile` all run a `read_file`) are three figures, so a function the
model ignored reads as ignored rather than inheriting its neighbour's calls.
Where one arm offers two spellings of one operation, both rows carry the same
figure, because gg counts what was done rather than which synonym did it. An
entry with no figure comes from a record written before gg counted per function,
and the console says so.

### `withheld`

The other side of `tools`: what this instance's per-agent `disabledTools`
[ablation](/gg/toolset-ablation/) took away, which is the names it lists that
are gg tools. A name gg does not know is absent, because it withheld nothing; gg
warns about it at startup and offers the agent exactly the surface it would have
had. That is why the field is reported rather than re-read from the
configuration, where a mistyped ablation is indistinguishable from an applied
one, and why a consumer may state each of these as an applied ablation.

A name here was asked for, which is not the same as taken: an ablation may name
a real tool no enabled capability was contributing, which withholds nothing in
practice and is still a deliberate arm of a sweep. What was offered is `tools`,
and the two together say which of the two happened. The field is empty for an
agent that ablates nothing.

### Per-agent arm fields

`executionMode`, `programLanguage` and `docViewTypes` are per agent, which is
what makes a within-run comparison possible: one run may drive its root in one
language and at one documentation mode and a subagent in another, so both arms
share the task, the workspace, the models and the wall clock. Each instance
reports its own, so "which arm was this agent on, and what did it cost?" is a
join by `agentId` from this event to that agent's `context_breakdown` bands
(`docs_view` and `search_results`) and to its `api_call` counts.

`docViewTypes` is the mode gg resolved, never the string the profile wrote: an
unreadable one falls back to the default and is warned about at launch. Its
values are `off`, `return` and `return-and-parameters`.

One caveat a study has to carry: `api_call` counts lookups, not the views a
lookup placed, and views per lookup is exactly what `docViewTypes` changes. One
`openDocsView` is one `api_call` under every mode, while it places the function's
view alone under `off` and that view plus the types the mode selects otherwise.
To count what a lookup cost, read the placed views: each is a `context_message`
on the `docs_view` band whose `label` names what it documents and whose `tokens`
say what it cost, and each turn's `prompt` event points at the ones resident that
turn.

The [Reference](/gg/reference/) section answers a neighbouring question. It is
what gg can offer, catalogue-wide, projected out of gg's own definitions; this
event is what one instance of one run was offered, after every gate the
configuration and the run's own shape imposed. A tool present in the reference
and absent from an instance's surface is the interesting case.

## Model-facing calls

A `tool_call` says what ran, not what the model wrote. The two are separate
surfaces over one core of typed functions, so a program's `gg.views.openFile`
runs a `read_file`, a `gg.files.readTextFile` runs the same one, and a
`gg.docs.search` runs no tool at all. gg therefore records the model-facing call
in its own right, as an `api_call` and `api_result` pair per call a program
makes.

The pair names the `operation` it resolved to (`files.read_file`) beside the
grouping and key gg files it under (`fs` and `read_file`), and nothing else. No
tool name, and no arguments: the `ToolCall` beside a bridged call already carries
those, and a carve-out's are either trivial (`session.finish()`) or enormous
(`views.openText(label, body)`).

`operation` is the field a study joins on, and it exists because eleven
[language arms](/gg/languages/overview/) legitimately spell one surface eleven
ways. A program that wrote `readFile`, one that wrote `read_file` and one that
wrote `ReadFile` are one operation, `files.read_file`, and it is the same string
the agent's `agent_surface` reports the bound function under. It is absent only
for a pair no operations row covers, and on a stream recorded before gg carried
it.

The `object` and `function` pair is legacy and joins to nothing. It disagrees
with the module vocabulary on eight of its twelve entries: `fs` against the
module `files`, `view` against `views`, `harness` and `review` both against
`session`, `memory` against `memories`, `agents` against `delegation`, `project`
against `board`, and `system` against `shell`. Grouping `api_call` by `object`
and looking those groups up among an agent's `apis` therefore finds nothing, and
reads as though every function was offered and none was called. It is retained
because older records carry it and because it is the whole identity of a
carve-out. It is not a key.

The opening half is emitted before the call runs, so a bridged
`tool_call`/`tool_result` pair and a delegation's whole subtree of child events
land inside the bracket. `ok` on the result is the verdict the program saw,
settled after the result was converted into what the program was handed, which
can legitimately differ from the `tool_result` beside it. A tool-calling agent
emits none of these. A call the sandbox refused emits a pair with `ok: false`
where the tool layer emits nothing at all, because the model made the call and
that it went nowhere is a fact about the run's capability set.
[`code_execution.apiCalls`](/gg/telemetry/code-execution/) is the turn's total,
and legitimately exceeds `toolCalls` by exactly those two populations.

### Failure classes

The class a failed call was raised with, such as `not-found`,
`invalid-argument` or `limit-exceeded`, is computed where the failure happened,
handed to the program to branch on, and carried on both halves of the call's
record.

- `tool_result.failure` is what ran. Present on exactly the results whose `ok` is
  `false`, with `other` for a failure raised outside a tool implementation.
- `api_result.failure` is what the model wrote. It is the only record of the
  class for the calls that never reach a tool: a
  [carve-out](/gg/responses-as-code/overview/) no tool backs, and a call the
  membrane refused before dispatch, such as a spent wall-clock budget or a name
  this run does not offer.

The two overlap for a bridged call, for the same reason `code_execution`'s
`apiCalls` and `toolCalls` do: they are two surfaces over one core and neither is
derived from the other. They are not summed.
