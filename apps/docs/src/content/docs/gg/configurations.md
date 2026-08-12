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

Account → gg lists the configurations on the signed-in account. Every
configuration an operator can pick is one that account wrote.

Creating or editing one opens the capability-set editor, which is organized into
three tabs:

- Configuration — the configuration's name and one-line purpose, the [run
  limits](#run-limits) every agent runs under, and the run's own [session
  hooks](/gg/hooks/).
- Slots — the [model slots](#model-slots) it asks for at launch.
- Agents — its [agent profiles](#agents). The capabilities themselves live in
  here, since in gg they are per agent.

Duplicate seeds a new configuration from an existing one. The usual way to build
an ablation arm is to duplicate the arm beside it and change the one thing under
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

An empty field takes gg's own default for that ceiling. Turns per agent,
wall-clock seconds and cost are the three that are absent when left empty; every
other field has a value gg applies whether or not the configuration states one.
Each default is listed in [Execution limits](/gg/execution-limits/).

One capability is worth knowing before running a compaction study. The [context
window override](/gg/context-visibility/#the-window-a-run-is-measured-against)
narrows the window a run is measured against, so a compaction arm can be
exercised against a million-token model without spending a million tokens of
input to reach a boundary. It can only narrow, since the model's real window is
a hard limit, and it is off by default.

## Agents

gg's capabilities are configured per agent rather than once for the whole run. A
configuration declares one or more agent profiles, exactly one of which is
flagged as the root agent: the profile that drives the run's top-level session
and the default profile for issue dispatch and helper agents. More profiles are
how a study gives different agents different tools, models, prompts or
execution modes, such as a cheap-and-fast scout, a careful reviewer and a
code-writing implementer.

Being the root is a flag rather than a name or a position. A fresh configuration
starts with one profile called `Root`, it can be renamed to anything, the flag
can be handed to another profile, and any profile can be removed, including the
root, which passes the flag to whatever is left. A configuration must have at
least one agent to be saved.

Every reference between the parts of a configuration is held by identity rather
than by the name shown in the form. That covers a roster entry, a merge agent
and an agent's model-slot binding, so renaming an agent or a model slot moves
every reference to it.

Opening an agent switches the editor into that profile's own view, itself
organized into tabs: Agent, then whichever of Tools, APIs, Roster, Hooks and
States the profile's type has. That view is saved or discarded on its own. Save
agent returns to the configuration keeping the edits, Cancel returns discarding
them, and the back chevron beside the title does the same as Cancel but asks
first if there is anything to lose. The configuration itself is written to the
account only by the Save button on the configuration view.

Each profile carries:

- an [agent type](#agent-type), chosen above everything else because it decides
  what the rest of the form offers;
- its own enabled capabilities, their implementations and params, and per-tool
  [ablation](/gg/toolset-ablation/) overrides;
- one model, either pinned outright or deferred to a declared [model
  slot](#model-slots), and the [prompt-cache lifetime](#prompt-cache-lifetime)
  its requests ask for;
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
staff issues. Every such call names its target by name, and gg refuses one the
roster does not list in the right scope. A profile may list itself, which allows
recursion. The `subagent` scope is also the allowlist
[`exec`](/gg/fork-and-exec/) is checked against.

Two capabilities backed by a [module](/gg/modules/), project management and
agent-managed context, carry an `ownership` param deciding whether the agent's
prompt carries that module or only its tools do. Left alone it is `owned`. The
other module-backed capabilities always sit in the agent's prompt.

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
  written in, defaulting to TypeScript.
- FSM — a [state machine](/gg/fsms/) over the configuration's other profiles. It
  takes no turns, so it is given no model, no prompt, no roster, and no
  capabilities. Each state runs the profile it names, with that profile's
  configuration.

The type is a per-agent choice, so one run can mix code-emitting and
tool-calling agents, and swapping a profile between Tools and RaC is the single
biggest lever a study has. A machine is namable everywhere an ordinary profile
is: as the root, as a roster target, as an issue's implementer.

The selected type opens its own settings where a capability's would sit, being
the sandbox ceilings and [response healing](/gg/response-healing/) for RaC and
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
run on are not all baked into it. It declares run-level named model slots,
which are launch-time model parameters, and each model binding either:

- pins a model outright, an internal binding identical on every run of the
  configuration and never asked about again; or
- defers to a model slot, leaving the model to be supplied when a run is
  launched.

An agent's own model is one such binding, and so is every capability param that
names a model, today [compaction](/gg/compaction/)'s handoff model. Both offer
the same Model from selector and are resolved by the same launch step.

A model slot may carry a default, which the launch form pre-fills. Slots are
named separately from the agents they feed so that two agents can share one:
"run the reviewer and the merge agent on whatever I pick for `critic`" is one
launch input rather than two. gg routes every live model through OpenRouter and
infers the provider from the model id, so a slot never pins a provider. Because
each agent carries its own model, a run can span several models across several
providers, which is why gg accounts usage and cost per agent profile rather than
as one figure for one model.

A fresh configuration starts from the simple case: one `primary` model slot with
the root agent deferred to it, so a configuration that says nothing about models
still asks for exactly one at launch. A slot's name is only its label. Agents
bind slots by identity, so renaming `primary` to `critic` keeps every agent
bound to it, and deleting a slot leaves the agents that deferred to it deferring
to nothing, which the save gate names rather than silently re-pointing them at
another model.

Declaring a slot is an authoring-time concern. Launching resolves every deferred
binding to a concrete model, an agent's and a capability param's alike, so the
capability set a run carries and records is fully pinned. That is what keeps
results sliceable by which model ran which agent. The backend rejects a launch
that leaves a binding unresolved, naming the agent.

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

Deleting a configuration does not disturb runs launched from it: every gg run
records its own resolved capability set, so the analysis surfaces keep slicing
by what actually ran.

## Launching one

gg is launched from the ordinary New run page rather than a separate form.
Picking gg in the Orchestrator selector switches the form into the gg run
mode:

- The per-row Harness column becomes a gg configuration column, offering
  the account's configurations.
- The row grows one model picker per model slot the chosen configuration
  declares and something in it defers to, labelled with the slot's name and
  pre-filled with its default. A binding the configuration pinned itself never
  appears here.
- The submission goes to gg's own enqueue endpoint (`POST /gg/runs`) with the
  resolved capability set rather than the flat launch body.

The [orchestrator](/orchestrators/overview/) dimension does not apply to a gg
run (see [Overview](/gg/overview/#how-gg-fits-into-the-test-cabinet)). gg is
offered in that selector because that is where an operator says how a run is
conducted, which makes it the one place the choice belongs. gg is offered for
every test type: it replaces the harness rather than the session strategy.

The fan-out is the same as any other run's, and it is what an ablation study
wants: `configurations × models × run count` runs from one submission. Fixing
the model and varying the configuration is an ablation; fixing the configuration
and varying the model is a model comparison.

## Watching a run

A launched gg run is read on gg's own monitor, which renders its
[telemetry](/gg/telemetry/overview/) through tabs:

- Dashboard — the whole-run read-out: status, the token and cost tally with its
  caching and reasoning splits as rings, how many agents ran, and the
  configuration it is running under.
- Agents — the run read per configured agent, each profile's instances summed
  into one read-out: how many ran, what they spent between them, which files and
  tools filled their windows, and what [state](/gg/modules/) they held. This is
  the grain an ablation is read at.
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
activity, context, requests, and metrics are offered for every agent. One file
is gated on the instance rather than on the configuration: what the instance was
[offered to call](/gg/telemetry/agent-surface/), named tools for a tool-calling
agent and apis for a [code-shaped](/gg/responses-as-code/overview/) one. It
appears only where that instance reported its resolved surface, because a file
showing an empty toolset would assert the very thing it exists to distinguish.

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
