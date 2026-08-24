---
title: "Configurations"
---

A gg run is configured by a [capability set](/gg/overview/#the-capability-set)
rather than a `(harness, model, orchestrator)` tuple. A configuration is a
capability set saved under a name. A run records the name of the configuration
it was launched from, so a study is a sweep over configurations and the [query
language](/gg/analysis/query-language/) can slice results by one.

gg is headless, so the console is the only place a configuration is authored. It
lives in the account section, with the rest of an operator's saved, reusable,
account-scoped tooling, rather than being reassembled inside every launch form.

## Registering one

Account → gg Configs lists the configurations on the signed-in account, in a tab
beside gg Agents. Every configuration an operator can pick is one that account
wrote.

Creating or editing one opens the capability-set editor, which is organized into
three tabs:

- Configuration — the configuration's name and one-line purpose, the [run
  limits](#run-limits) every agent runs under, and the run's own [session
  hooks](/gg/hooks/).
- Slots — the [configuration slots](#configuration-slots) it asks for at launch
  and the agent slots each one fills.
- Agents — its [agent profiles](#agents). The capabilities themselves live in
  here, since in gg they are per agent.

Duplicate seeds a new configuration from an existing one. The usual way to build
a comparison arm is to duplicate the arm beside it and change the one thing under
test.

A configuration names no test case, and it does not have to name the models it
runs on.

### Run limits

The Configuration tab carries the [execution ceilings](/gg/execution-limits/)
the whole run is bounded by: max parallel agents, turns per agent, wall-clock
seconds, consecutive errors, error rate and its window, cost, and the size of
the session journal. They apply to every capability and to both execution modes
at once, so they sit beside the configuration's identity rather than inside a
capability group.

Max parallel agents and the session journal's size are required: gg runs under
both on every run, and neither has an off it could take instead. Turns per agent,
wall-clock seconds, cost, consecutive errors, and the error rate with its window
are each armed by writing a figure and unarmed by leaving the field empty. A
fresh configuration seeds the error ceilings (5 consecutive errors, a 0.2 rate
over 50 turns) for the operator to keep, change, or clear; gg itself arms no
ceiling the saved configuration did not write. [Execution
limits](/gg/execution-limits/) states what each one bounds.

One capability is worth knowing before running a compaction study. The [context
window override](/gg/context-visibility/#the-window-a-run-is-measured-against)
narrows the window a run is measured against, so a compaction arm can be
exercised against a million-token model without spending a million tokens of
input to reach a boundary. It can only narrow, since the model's real window is
a hard limit, and a profile that leaves the capability off is measured against
the model's own window.

## Agents

gg's capabilities are configured per agent rather than once for the whole run. A
configuration declares one or more agent profiles, exactly one of which is
flagged as the root agent: the profile that drives the run's top-level session
and the default profile for issue dispatch and helper agents. More profiles are
how a study gives different agents different tools, models, prompts or
execution modes, such as a cheap-and-fast scout, a careful reviewer and a
code-writing implementer.

A profile is declared either inline, belonging to this configuration alone, or
imported from a [saved agent](/gg/agents/) authored on its own. An imported
profile follows the saved agent in every field the configuration does not
override, and is resolved into an ordinary profile before the configuration is
stored or launched.

Being the root is a flag rather than a name or a position. A fresh configuration
starts with one profile called `Root`, it can be renamed to anything, the flag
can be handed to another profile, and any profile can be removed, including the
root, which passes the flag to whatever is left. A configuration must have at
least one agent to be saved.

Opening an agent switches the editor into that profile's own view, itself
organized into tabs: Agent, then whichever of Tools, APIs, Slots, Roster, Hooks
and States the profile's type has. That view is saved or discarded on its own. Save
agent returns to the configuration keeping the edits, Cancel returns discarding
them, and the back chevron beside the title does the same as Cancel but asks
first if there is anything to lose. The configuration itself is written to the
account only by the Save button on the configuration view.

Each profile carries:

- an [agent type](#agent-type), chosen above everything else because it decides
  what the rest of the form offers;
- its own enabled capabilities, their implementations and params, and the
  [calls it is granted](#granting-calls) out of them;
- its own [model slots](#agent-slots), and one model either pinned outright or
  deferred to one of them, with the
  [prompt-cache lifetime](#prompt-cache-lifetime) its requests ask for;
- optional custom instructions, operator prose inserted into the agent's [system
  prompt](/gg/prompts/), and a complete system-prompt template override for full
  control (the editor seeds the override with gg's built-in template, so the
  normal edit is just the custom-instructions field);
- a roster, the other profiles this agent may put to work, each with a
  caller-scoped description telling it when to use that target and one or more
  scopes saying what it may be used for;
- its own [hooks](/gg/hooks/), the gates gg runs around this agent's file
  writes, shell commands, compactions, and its own start and stop. The run's own
  two ends, session start and session end, belong to the configuration rather
  than to any agent.

A roster entry's scopes are `subagent` (spawnable with `spawn_subagent`),
`implementer` (assignable as a [board issue](/gg/project-management/)'s agent),
and `reviewer` (namable among an issue's reviewers). The three are independent:
a profile trusted to write code is not automatically trusted to review it, and
an agent with no [subagents](/gg/subagents/) capability still uses its roster to
staff issues. An entry naming no scope permits nothing at all and refuses the
launch — gg grants none of the three on an operator's behalf, and the editor
removes a roster row by clearing its last scope rather than saving one that can
be used for nothing. Every such call names its target by its
[slug](#identity), and gg refuses one the roster does not list in the right
scope. A profile may list itself, which allows recursion. The `subagent` scope is
also the allowlist [`exec`](/gg/fork-and-exec/) is checked against.

### Identity

An agent profile carries three names, and each answers a different question.

Its **id** is internal. It is minted when the profile is created, is never
rewritten, and is shown to nobody: it is opaque text whose only job is to be the
same text tomorrow. Everything inside the configuration that points at a profile
points at its id — a roster entry, a machine's state, the merge agent, a
[configuration slot](#configuration-slots)'s target, and a configuration's link
to the [saved agent](/gg/agents/) a profile follows. That is what makes renaming
free and importing safe: no reference breaks because a name changed, and two
profiles that have landed on one slug are still two profiles the editor can tell
apart while an operator separates them.

Its **slug** is the name the model reads. It is written by the operator, unique
within the configuration, and made of lowercase letters and digits in groups
separated by single hyphens. A roster in a prompt names slugs, and the slug is
what the model passes back as the `agent` argument of `spawn_subagent`, `exec`
and `create_issue`. A run's telemetry, its
[session record](/gg/analysis/session-records/) and the
[query language](/gg/analysis/query-language/) name a profile by its slug too, so
what an operator writes is what they later slice by.

Its **name** is display text. An operator renames a profile freely and two
profiles may carry one name, because nothing resolves a reference by reading one.

Launching resolves the internal ids away. Every reference in the capability set a
run carries and records names a profile by its slug, and the ids are dropped, so
what gg reads and what a run's analysis surfaces read are the same names. gg
refuses a set that still carries one, on the same terms it refuses a
[model slot](#model-slots) a launch left unbound.

A launch is refused when a profile's slug is empty or malformed, when two
profiles share one, or when a reference names a profile the set does not declare.
Names are not checked.

### Granting calls

An enabled capability says which calls exist for an agent. A second, per-agent
allowlist says which of them the agent is given, and that list is the whole
grant: an agent's surface is exactly the calls its allowlist names, out of the
capabilities it holds.

There are two allowlists, one per surface, and each is checked against its own
vocabulary:

- `tools` names gg tool names, and is the surface a Tools agent is offered.
- `operations` names operation ids, such as `files.read_file` and
  `memories.update_memory`, and is what a RaC agent's programs may call.

The two vocabularies are scoped. A tool name is never callable from a program and
an operation id is never callable as a tool, so a name written under the wrong
field, or one gg does not have at all, refuses the launch — and the refusal says
which of the two lists the name does belong in, when it belongs in one. It cannot
be resolved to the other list's spelling, and an agent narrowed by a typo reads
exactly like one narrowed on purpose. A name that *is* in the right vocabulary but
that this agent's capabilities do not offer is silently fine: it grants nothing,
and one shared configuration document naming a call only some of its agents hold
is ordinary.

The API surface is strictly the larger of the two: every tool has an operation
behind it, and operations exist that no tool does.

A granted call is withheld when the run cannot service it. The capability and the
allowlist are properties of the configuration; whether the agent holds a bound
store, a writable memory handle, a memory strategy with named memories, a
compaction strategy the model itself performs, a non-empty roster, or a position
in a machine is a property of the instance. Both surfaces apply those conditions,
so a call the run cannot make is neither offered as a tool nor documented,
searchable or callable from a program. The [Reference](/gg/reference/) states each
condition per call.

`delegation.transition_state` is the one call a configuration cannot grant at all.
An agent holds it when it stands in a [machine](/gg/fsms/) state with somewhere to
go, and the machine is declared on the shell profile driving it rather than on the
agent's own.

The editor asks for neither list directly. Switching a capability on grants that
capability's whole set of calls for the agent's type, and the capability's
Features sliders take back one bundle at a time, such as evicting file views,
revising memories or creating issues. Each capability page states the sliders it
offers.

An enabled capability that grants none of its calls for the agent's type is named
on its card in the editor, since the resulting run is indistinguishable from one
where the model was offered the capability and left it alone. It is the editor's
to point out rather than the launch's: several capabilities contribute exactly one
call, so refusing it would make "narrow the allowlist to nothing" and "switch the
capability off" the same edit, and a run's
[agent surface](/gg/telemetry/agent-surface/) exists to record the difference.

Studying a narrower surface is therefore a comparison of two configurations:
duplicate the arm, take the calls out of the copy, and run both against the same
test case and model.

### Agent type

How an agent is implemented is asked before what it can do, as a three-way
selector above the capabilities, because the answer decides which capabilities
the form offers at all:

- Tools — tool calling. gg offers each capability's functions as tools and the
  model calls them one at a time, a turn per round trip.
- RaC — [responses as code](/gg/responses-as-code/overview/). The model's whole
  reply is a program over the same functions, run in a wasm sandbox, so one turn
  can make dozens of calls, branch on their results, and loop. The capability's
  `language` param picks the [language](/gg/languages/overview/) the program is
  written in, and every RaC agent names one.
- FSM — a [state machine](/gg/fsms/) over the configuration's other profiles. It
  takes no turns, so it is given no model, no prompt, no roster, and no
  capabilities. Each state runs the profile it names, with that profile's
  configuration.

The type is a per-agent choice, so one run can mix code-emitting and
tool-calling agents, and swapping a profile between Tools and RaC is the single
biggest lever a study has. A machine is namable everywhere an ordinary profile
is: as the root, as a roster target, as an issue's implementer.

The selected type opens its own settings where a capability's would sit, being
the sandbox ceilings for RaC and
the state table for FSM, and filters the capability list below it. A capability
only one type reads is listed only under that type. [Program
library](/gg/program-library/) and Close documentation are offered to a RaC
agent and not to a Tools one, because there are no programs in a tool-calling
session to keep and nothing in one opens a documentation view.

An FSM profile is offered no capabilities, no model binding, no prompt-cache
lifetime, no custom instructions, no system-prompt override, and no roster. Its
configuration is the machine. The rule the whole form follows is that a control
exists only where gg would read what it sets, since a field the harness ignores
invites an operator to configure a run that does not exist and then to read the
recorded set as though it had. So a machine is never asked for a model, the save
gate never demands one of it, and a launch collects no [model
slot](#model-slots) on its behalf. What the machine runs on is each state's own
profile, and when the machine is the root the run is recorded under the model
its entry state runs, which is the model its first turn is charged to.

A saved agent carries the configuration of the type it was saved under, and none
of any other. Switching type while an agent is open loses nothing, and flipping
back and forth is free. Once Save agent is pressed the types switched away
from are wound back to their defaults, so reopening the agent and switching to
one of them shows what a fresh agent of that type would have been.

## Model slots

A configuration is meant to be reusable across models, so the models its agents
run on are not all baked into it. Each model binding either:

- pins a model outright, an internal binding identical on every run of the
  configuration and never asked about again; or
- defers to a named model slot, leaving the model to be supplied when a run is
  launched.

An agent's own model is one such binding, and so is every capability param that
names a model, today [compaction](/gg/compaction/)'s handoff model. Both offer
the same Model from selector and are resolved by the same launch step. gg routes
every live model through OpenRouter and infers the provider from the model id,
so a slot never pins a provider. Because each agent carries its own model, a run
can span several models across several providers, which is why gg accounts usage
and cost per agent profile rather than as one figure for one model.

### Agent slots

An agent declares the slots its own bindings defer to, on its Slots tab, and its
bindings name them. A slot belongs to the agent that declares it, so a
[saved agent](/gg/agents/) carries its slots into every configuration that
imports it, and two agents may each declare a `critic` without meaning one
launch input. A slot may carry a default model.

An agent slot is either mapped by the configuration or marked passthrough. A
slot that is neither leaves a binding with no model to take, and one that is
both asks twice for the same binding. Both refuse the save and the launch.

### Configuration slots

A run asks for exactly one set of models, and the configuration decides what
that set is. A configuration slot is one launch input, and it names the agent
slots it fills. One configuration slot filling several agent slots is how "run
the reviewer and the merge agent on whatever I pick for `critic`" stays one
launch input rather than two.

A configuration slot may carry a default, which the launch form pre-fills. A
slot that carries none takes the default of the first agent slot it fills, so
importing an agent that defaults its own slot keeps that default working.

Marking an agent slot passthrough exposes it at launch on its own, under
`<agent slug>.<slot name>`, which spares the configuration a slot whose only job
is to forward one. A passthrough slot pre-fills from its own default.

Slots are named separately from the agents they feed, and the launch form asks
for the configuration's slots and its passthrough slots and nothing else. A
fresh configuration starts from the simple case: the root agent declares one
`primary` slot, marked passthrough, so a configuration that says nothing about
models still asks for exactly one model at launch.

Agents bind slots by identity, so renaming a slot carries every binding along.
Deleting one leaves the bindings that named it deferring to nothing, which the
save gate names rather than silently re-pointing them at another model.

Declaring slots is an authoring-time concern. Launching resolves every deferred
binding to a concrete model, an agent's and a capability param's alike, so the
capability set a run carries and records is fully pinned and declares no slot.
That is what keeps results sliceable by which model ran which agent. The backend
rejects a launch that leaves a binding unresolved, naming the agent.

## Prompt cache lifetime

Each agent chooses how long the provider is asked to keep its stable
[prompt-cache](/gg/overview/#prompt-caching) entries, meaning its opening
context and the cached points a later turn reads:

- 5 minutes (provider default). What every agent takes unless told
  otherwise.
- 1 hour (extended). The stable entries survive a long gap between two of
  the agent's turns, at a higher write premium: on Anthropic, 2× the base input
  rate against the default's 1.25×.

It is per agent because the trade comes out differently for each one in the same
run. An agent that delegates and then waits, or whose turns run builds and test
suites, routinely comes back to its own context more than five minutes later,
and under the default it re-sends that whole prefix at full price. An agent that
answers quickly and is never resumed never reaches the five-minute expiry, so an
hour is premium paid on entries that would have been read or discarded anyway.

The rolling tail marker always takes the provider default, whatever the agent is
set to: it is rewritten every turn and read exactly once. Setting this on an
agent bound to a model that caches implicitly, meaning everything outside the
Anthropic family, changes nothing, because gg sends those providers no markers.

## Storage

Configurations are per-account and private, stored by the backend:

| Endpoint                  | Purpose                       |
| ------------------------- | ----------------------------- |
| `GET /gg/configs`         | The account's configurations. |
| `POST /gg/configs`        | Register one.                 |
| `PUT /gg/configs/{id}`    | Update one in place.          |
| `DELETE /gg/configs/{id}` | Delete one.                   |

A configuration is stored with every agent written out in full, alongside the
saved agent each imported profile follows and the fields it overrides.

Deleting a configuration does not disturb runs launched from it: every gg run
records its own resolved capability set, so the analysis surfaces keep slicing
by what actually ran.

## Launching one

gg is launched from the ordinary New run page rather than a separate form.
Picking gg in the Orchestrator selector switches the form into the gg run
mode:

- The per-row Harness column becomes a gg configuration column, offering
  the account's configurations.
- The row grows one model picker per launch slot the chosen configuration
  exposes: its [configuration slots](#configuration-slots), then the
  [passthrough](#configuration-slots) slots of its agents. Each is labelled with
  the slot's name and pre-filled with its default. A binding the configuration
  pinned itself never appears here.
- The submission goes to gg's own enqueue endpoint (`POST /gg/runs`) with the
  resolved capability set rather than the flat launch body.

A launch refuses a capability set carrying any value gg cannot honour exactly as
written, and names every one of them at once, so a single pass over the
configuration fixes them all. gg substitutes nothing for a value the document
leaves out:

- An enabled capability is fully specified. It writes an `implementation`
  wherever the capability offers arms, and it writes every param that capability
  requires.
- A required value that is absent refuses the launch, named at its own locus
  beside every other defect in the document.
- An optional value's absence is itself a setting: no ceiling, no override, no
  summarizer model. gg records the absence and runs without the thing the value
  would have configured.
- A capability the agent's list leaves out configures nothing, and so does one
  written into the list and switched off. Neither requires anything.

Each capability page states which of its params are required and what an optional
one's absence turns off.

The check runs at the top of gg's own session frame, inside the run container and
before the first turn, so a refusal costs no model spend. It lives there and
nowhere else on purpose: it is the one place that can call gg's own resolvers, and
a second copy of the vocabulary anywhere else is exactly the drift these refusals
exist to delete.

The console pre-fills a fresh capability with an implementation and a starting set
of params. That is authoring: it writes figures into the document for the operator
to keep or change, and the document that reaches gg carries whatever they left
there. gg reads that document and chooses nothing on its own, so every figure a
run is conducted and recorded under is a figure the configuration states.

Every value is read whether its capability is switched **on or off**. A disabled
capability still records the configuration the arm would have used — which is
what keeps the on and off arms of one comparison symmetric, and is what the
editor writes — so a typo in it is a typo an operator hears about now rather than
on the launch where they flip the switch. What a disabled capability does not
carry is an obligation to be complete, since it configures nothing.

Five of those refusals are about the **shape** of a set rather than about one
value, and each of them is a declaration gg would otherwise read past:

- A capability id declared twice on one agent. A capability is looked up by id
  and the first declaration answers, so the second one's switch, arm and params
  would configure nothing while the run's record carried them.
- An `implementation` on a capability that offers no implementations to choose
  between. Only Compaction, Memories, Read File, Shell and Autoload
  Specifications read one; anywhere else the name selects nothing. Each of those
  five pages states whether the capability names an arm wherever it is enabled.
- A run-level param that **diverges** from the one in force. The subagent
  recursion bound is read once for the whole run, off the first profile, and the
  [board](/gg/project-management/)'s three ceilings once off the first profile
  with that capability on. Writing the *same* value on every profile is fine and
  is what the editor does; writing a *different* one is a document that says two
  things.
- Two agents naming two different merge agents, or one naming something gg
  cannot read as a name. The board is the run's, so it has one merge agent.
- A roster entry naming no scope. What a target may be used for is the whole of
  what a roster entry says, and an entry permitting nothing is a delegation the
  document describes and the run cannot make.

The [orchestrator](/orchestrators/overview/) dimension does not apply to a gg
run (see [Overview](/gg/overview/#how-gg-fits-into-the-test-cabinet)). gg is
offered in that selector because that is where an operator says how a run is
conducted, which makes it the one place the choice belongs. gg is offered for
every test type: it replaces the harness rather than the session strategy.

The fan-out is the same as any other run's, and it is what a study wants:
`configurations × models × run count` runs from one submission. Fixing the model
and varying the configuration measures the configuration; fixing the
configuration and varying the model measures the model.

## Watching a run

A launched gg run is read on gg's own monitor, which renders its
[telemetry](/gg/telemetry/overview/) through tabs:

- Dashboard — the whole-run read-out: status, the token and cost tally with its
  caching and reasoning splits as rings, how many agents ran, and the
  configuration it is running under.
- Agents — the run read per configured agent, each profile's instances summed
  into one read-out: how many ran, what they spent between them, which files and
  tools filled their windows, and what [state](/gg/modules/) they held. This is
  the grain two configurations are compared at.
- Instances — the per-running-agent explorer, which lays the run out as a
  filesystem. An instance is a folder, the things you can monitor about it are
  its files, and a spawned agent is a folder under `subagents`.
- Modules — the run read by the state it holds rather than by the agents holding
  it, grouped by kind, so one store four agents share reads as one store. It is
  offered when any profile enables a [module](/gg/modules/)-backed capability.
- Project — the run-global epic and issue board, offered when any profile has
  the [project management](/gg/project-management/) capability. An agent's own
  `modules → board` file links through to it rather than drawing a second
  copy.

That view is not only for the session that launched the run. The Runs list opens
an in-flight gg run on gg's monitor rather than the generic harness feed, and a
finished gg run keeps a gg tab on its detail page that rebuilds the same
surfaces from the recorded telemetry stream.

Inside the Instances explorer, a file is offered when the run's capability set
justifies it rather than when data happens to have arrived. gg announces its
configuration on the stream's first event, so a run with the tasks capability
always has a `modules → tasks` file, empty until the model builds its list,
while a run with compaction off has no compaction file. Overview, prompt,
activity, context, requests, and metrics are offered for every agent. Two files
are gated on the instance rather than on the configuration. The first is what
the instance was [offered to call](/gg/telemetry/agent-surface/), named tools
for a tool-calling agent and apis for a
[code-shaped](/gg/responses-as-code/overview/) one; it appears only where that
instance reported its resolved surface, because a file showing an empty toolset
would assert the very thing it exists to distinguish. The second, programs,
appears only for a code-shaped instance: one collapsed row per turn carrying the
reply as the program it was, with a status of success, compile, or runtime, so
the rows worth opening stand out, and each opens onto the program and the
compiler or runtime error it met. It is the same turns the requests file shows,
read one level up: requests lists every message of every turn; programs answers
whether each response ran.

The activity file is gg's telemetry rendered through the same feed every other
harness's events render through, so it honors the layout picked in Settings →
Appearance.

## Analyzing across them

The topbar's analyze control enters the [gg analysis](/gg/analysis/overview/)
UI, which reads across every recorded gg session: the sessions themselves, the
[query language](/gg/analysis/query-language/) over their records, saved
queries, and dashboards built from them. It lists gg runs whatever their state
and whether or not they were published, since gg runs are experiment material
and most are never published.
