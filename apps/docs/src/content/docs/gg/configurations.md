---
title: "Configurations"
---

A gg run is configured by a [capability set](/gg/overview/#the-capability-set), not
by a `(harness, model, orchestrator)` tuple. A **configuration** is that capability
set, _named_ — the "named / preset-able" requirement the overview sets out, made
concrete: a study is then a sweep over configurations rather than hand-assembled
flag soup, and every run records which configuration produced it, so
[result aggregation](/gg/result-aggregation/) can slice by it natively.

Because gg is [headless](/gg/overview/), the console is the only place a
configuration is authored. It lives where the rest of an operator's saved,
reusable, account-scoped tooling lives — the **account section**, beside
[coverage plans](/components/web/overview/) — rather than being re-assembled inside
every launch form.

## Registering one

**Account → gg** lists the configurations on the signed-in account, plus the
read-only **built-ins** every operator shares:

| Built-in        | What it is                                                               |
| --------------- | ------------------------------------------------------------------------ |
| `minimal`       | The default capability set — the launchable baseline.                    |
| `full`          | Every capability a single agent can run on its own.                      |
| `no-compaction` | Everything on except the compaction backstop — the context-overflow arm. |
| `shell-only`    | Shell and nothing else — the ablation extreme.                           |

A built-in is one agent, and it is offered as something you can launch without editing it,
which shapes the two "everything on" ones in three ways worth knowing. Their one agent is
a **RaC** [agent](#agent-type) — "everything on" includes
[responses as code](/gg/responses-as-code/), which is a type rather than a capability, and
the type that reads the most of the catalogue. They leave out any capability that is inert
or refused without something authored beside it. And their one agent lists **itself** in its
roster, in every scope, because that is the only profile it can name: without it
`spawn_subagent` and `exec` would be offered nothing to target, and an agent that may file
issues with no implementer to assign them to is refused at launch.

Creating or editing one opens the capability-set editor. At the top sit the two
run-level fieldsets — the **Run limits** (below) and the **model slots** (below) —
followed by the **Agents** section (below), where the capabilities themselves are
configured, since in gg they are **per agent**. **Duplicate** seeds a new
configuration from an existing one — the usual way to build an ablation arm is to
duplicate the arm beside it and change the one thing under test.

Above the capability groups sits the **Run limits** fieldset — the
[execution ceilings](/gg/execution-limits/) the whole run is bounded by: turns per agent,
wall-clock seconds, consecutive errors, error rate and its window, and cost. They are not
capabilities (they apply to every capability and to both execution modes at once), so
they sit above the catalogue rather than inside a group of it. **Leaving a field empty
leaves that ceiling off**, and an untouched fieldset writes no `limits` key at all, so
every configuration saved before limits existed round-trips unchanged. The one field with
a default is turns per agent, which is 50 when empty.

One capability is worth knowing about before you run a compaction study: the
[**Context Window Override**](/gg/context-visibility/#the-window-a-run-is-measured-against)
narrows the window a run is measured against, so a compaction arm can be exercised
against a million-token model without spending a million tokens of input to reach a
boundary. It can only narrow — the model's real window is a hard limit — and it is off
by default, so a normal run uses the model's full window.

A configuration is deliberately **test-case-free**, and it does not have to name the
models it runs on.

## Agents

gg's capabilities are configured **per agent**, not once for the whole run. A
configuration declares one or more **agent profiles**, exactly one of which is
flagged as the **root agent** — the profile that drives the run's top-level session
and the default for the [merge agent](/gg/project-management/) and
[speculation judging](/gg/speculative-execution/). Adding more profiles is how a
study gives different agents different tools, models, prompts, or execution modes —
a cheap-and-fast scout, a careful reviewer, a code-writing implementer.

Being the root is a **flag, not a name and not a position**: a fresh configuration
starts with one profile called `Root`, but it can be renamed to anything, the flag
can be handed to another profile ("Make root"), and any profile can be removed —
including the root, which passes the flag to whatever is left. The only rule is that
a configuration must have **at least one agent** to be saved. (On the wire the root
is `agents[0]`, so saving writes the flagged profile first; nothing reads the name.)

Every reference between the parts of a configuration — a roster entry, a merge or
judge agent, an agent's model-slot binding — is held by identity rather than by the
name shown in the form, so **renaming an agent or a model slot moves every reference
to it** instead of leaving one spelling the old name.

Opening an agent switches the editor into that profile's own view. That view is
saved (or discarded) on its own: **Save agent** returns to the configuration keeping
the edits, **Cancel** returns discarding them, and the configuration itself is only
written to your account by the Save button on the configuration view. Each profile
carries:

- an **agent type** (below), chosen above everything else because it decides what the
  rest of the form even offers — everything after this point describes a *worker*, and
  an **FSM** profile is offered none of it;
- its own enabled **capabilities**, their implementations and params, and per-tool
  [ablation](/gg/toolset-ablation/) overrides;
- **one model**, either pinned outright or deferred to a run-level [model
  slot](#model-slots) (below), and the
  [prompt-cache lifetime](#prompt-cache-lifetime) its requests ask for;
- optional **custom instructions** — operator prose inserted into the agent's
  [system prompt](/gg/prompts/) — and, for full control, a complete **system-prompt
  template override** (the editor seeds it with gg's built-in template so the normal
  edit is just the custom-instructions field);
- a **roster** — the other profiles this agent may put to work, each with a
  caller-scoped description telling it when to use that target and one or more
  **scopes** saying what it may be used **for**: `subagent` (spawnable with
  `spawn_subagent`, a [workflow](/gg/workflows/) stage, or a
  [speculation](/gg/speculative-execution/)), `implementer` (assignable as a
  [board issue](/gg/project-management/)'s agent), and `reviewer` (namable among an
  issue's reviewers). The three are independent — a profile trusted to write code is
  not automatically trusted to review it, and an agent with no
  [subagents](/gg/subagents/) capability still uses its roster to staff issues. Every
  such call names its target **by name** and refuses one the roster does not list in
  the right scope; a profile may list itself, allowing recursion. The `subagent` scope
  does double duty: it is also the allowlist [`exec`](/gg/fork-and-exec/) is checked
  against, since becoming a profile and briefing one are both putting it to work.

One more thing is worth knowing before reading the rest of this page: two capabilities
backed by a [module](/gg/modules/) — project management and agent-managed context — carry
an **`ownership`** param deciding whether the agent's prompt carries that module or only
its tools do. Left alone it is `owned`. The other module-backed capabilities have no such
param: a task list, a memory store and a skills catalogue are about the agent holding
them, so they are always in its prompt.

### Agent type

**How** an agent is implemented is a different question from **what** it can do, and it
is asked first — as a three-way selector above the capabilities, because the answer
decides which capabilities the form offers at all:

- **Tools** — tool calling: gg offers each capability's functions as tools and the model
  calls them one at a time, a turn per round trip.
- **RaC** — [responses as code](/gg/responses-as-code/): the model's whole reply is a
  TypeScript program over the same functions, run in a wasm sandbox, so one turn can make
  dozens of calls, branch on their results, and loop.
- **FSM** — a [state machine](/gg/fsms/) over the configuration's _other_ profiles. Not a
  worker at all: it takes no turns, so it is given no model, no prompt, no roster and no
  capabilities — each state runs the profile it names, with that profile's configuration.

It is a per-agent choice, so one run can mix code-emitting and tool-calling agents, and
swapping a profile between Tools and RaC is the single biggest lever a study has. A
machine is namable everywhere an ordinary profile is: as the root, as a roster target, as
an issue's implementer.

The selected type opens its own settings where a capability's would sit — the sandbox
ceilings and [response healing](/gg/response-healing/) for **RaC**, the state table for
**FSM** — and filters the capability list below it. A capability only one type reads is
listed only under that type: [program library](/gg/program-library/) is offered to a RaC
agent and not to a Tools one, because there are no programs in a tool-calling session to
keep.

An **FSM** profile is offered no capabilities whatever — and no model binding, no prompt
cache lifetime, no custom instructions, no system-prompt override and no roster either.
Its configuration _is_ the machine. The rule the whole form follows is that a control
exists only where gg would read what it sets: a field an operator can fill in and the
harness ignores invites them to configure a run that does not exist, and then to read the
recorded set as though it had. So a machine is never asked for a model, the save gate
never demands one of it, and a launch collects no [model slot](#model-slots) on its
behalf. What the machine runs on is each state's own profile — and when the machine is the
root, the run is recorded under the model its **entry state** runs, which is the model its
first turn is actually charged to.

On the wire there is no type field — gg reads the type off the `responses-as-code` and
`fsm` capabilities, which is what the editor writes. That has one consequence worth
stating: **a saved agent carries the configuration of the type it was saved under, and
none of any other.** Switching type while an agent is open loses nothing (flip back and
forth freely; everything is still there), but once **Save agent** is pressed the types
you switched away from are wound back to their defaults — so reopening the agent and
switching to one of them shows what a fresh agent of that type would have been, not what
was on screen before.

## Model slots

A configuration is meant to be reusable across models, so the models its agents run
on are not all baked into it. It declares run-level named **model slots** —
launch-time model parameters — and each model binding either:

- **pins a model** outright, an _internal_ binding that is identical on every run of
  the configuration and is never asked about again; or
- **defers to a model slot**, leaving the model to be supplied when a run is
  launched.

An agent's own model is one such binding, and so is every capability param that names a
model — today, [compaction](/gg/compaction/)'s handoff model. Both offer the same
_Model from_ selector, and both are resolved by the same launch step.

A model slot may carry a **default**, which the launch form pre-fills. Model slots are
named separately from the agents they feed precisely so two agents can share one: "run
the reviewer _and_ the judge on whatever I pick for `critic`" is one launch input, not
two. gg routes every live model through OpenRouter and infers its provider from the
model id, so a slot never needs a provider pinned onto it — and because each agent
carries its own model, a run can span **several, possibly cross-provider models** at
once, which is why gg accounts usage and cost **per agent profile** rather than as one
figure for one model.

The default a fresh configuration starts from is the simple case — one `primary`
model slot, with the root agent deferred to it — so a configuration that says nothing
about models still asks for exactly one at launch. A configuration saved before
capabilities were per-agent reads as a single root agent bound that same way. A slot's
name is only its label: agents bind slots by identity, so renaming `primary` to
`critic` keeps every agent bound to it, and deleting a slot leaves the agents that
deferred to it deferring to nothing — which the save gate names, rather than silently
re-pointing them at another model.

Declaring a slot is an authoring-time concern only. **Launching resolves every
deferred binding to a concrete model** — an agent's, and a capability param's — so the
capability set a run carries — and records — is fully pinned, which is what keeps
[result aggregation](/gg/result-aggregation/) sliceable by "which model ran this
agent". The backend rejects a launch that leaves one unresolved, naming the agent.

## Prompt cache lifetime

Each agent chooses how long the provider is asked to keep its **stable**
[prompt-cache](/gg/overview/#prompt-caching) entries — its opening context and the
cached points a later turn reads:

- **5 minutes (provider default).** What every agent takes unless told otherwise, and
  what every configuration written before this setting existed reads as.
- **1 hour (extended).** The stable entries survive a long gap between two of the
  agent's turns, at a higher write premium — on Anthropic, 2× the base input rate
  against the default's 1.25×.

It is per agent because the trade comes out differently for each one in the same run. An
agent that delegates and then waits, or whose turns run builds and test suites, routinely
comes back to its own context more than five minutes later; under the default it re-sends
that whole prefix at full price, and the extended lifetime pays for itself the first time
it does not. An agent that answers quickly and is never resumed never reaches the
five-minute expiry in the first place, so buying it an hour is premium paid on entries
that would have been read — or discarded — anyway.

The rolling **tail** marker always takes the provider default, whatever the agent is set
to: it is rewritten every turn and read exactly once, so an hour would buy nothing and be
charged for it. Setting this on an agent bound to a model that caches implicitly
(everything outside the Anthropic family) changes nothing — gg sends those providers no
markers at all.

## Storage

Configurations are per-account and private, stored by the backend:

| Endpoint                  | Purpose                       |
| ------------------------- | ----------------------------- |
| `GET /gg/configs`         | The account's configurations. |
| `POST /gg/configs`        | Register one.                 |
| `PUT /gg/configs/{id}`    | Update one in place.          |
| `DELETE /gg/configs/{id}` | Delete one.                   |

Deleting a configuration does not disturb runs launched from it: every gg run
records its own resolved capability set, so the analysis surfaces keep slicing by
what actually ran.

## Launching one

gg is launched from the **ordinary New run page**, not a separate form. Picking
**gg** in the _Orchestrator_ selector switches the form into the gg run mode:

- The per-row **Harness** column becomes a **gg configuration** column, offering
  the built-ins and the account's own configurations.
- The row grows one **model picker per model slot** the chosen configuration
  declares and something in it defers to, labelled with the slot's name and pre-filled
  with its default. A binding the configuration pinned itself is already decided, so it
  never appears here.
- The submission goes to gg's own enqueue endpoint (`POST /gg/runs`) with the
  resolved capability set, rather than the flat launch body.

gg is not really an orchestrator — it is its own executor, and the
[orchestrator](/orchestrators/overview/) dimension does not apply to a gg run (see
[Overview](/gg/overview/#how-gg-fits-into-the-test-cabinet)). It is offered in that
selector because that is where an operator says _how a run is conducted_, which
makes it the one place the choice belongs. gg is offered for every test type: it
replaces the harness, not the session strategy.

The fan-out is unchanged, and it is exactly what an ablation study wants:
`configurations × models × run count` runs from one submission. Fixing the model
and varying the configuration is an ablation; fixing the configuration and varying
the model is a model comparison.

A launched gg run is watched on gg's own live monitor, which renders its
[telemetry](/gg/telemetry/) through a set of surfaces, led by a tab selector:
**Dashboard** — the whole-run read-out (status, the token/cost tally with its
caching and reasoning splits as rings, how many agents ran, and the configuration it
is running under); **Agents** —
the run read per _configured_ agent, each profile's instances summed into one
read-out (how many ran, what they spent between them, which files and tools
filled their windows, and what [state](/gg/modules/) they held between them), which is
the grain an ablation is read at;
**Instances**, the per-running-agent explorer that lays the run out as a filesystem
(an instance is a folder, the things you can monitor about it are its files — including
a `modules` folder for what it holds — and a spawned agent is a folder under
`subagents`); and **Modules**, the run read by the _state_ it holds rather than by the
agents holding it, grouped by kind so that one store four agents share reads as one
store. That view is not only for the session that launched the run:

- The **Runs** list opens an in-flight gg run on gg's monitor, not the generic
  harness feed.
- A finished gg run keeps a **gg tab** on its detail page, which rebuilds the very
  same surfaces from the recorded telemetry stream.
- Inside the Instances explorer, a **file is offered when the run's capability set
  justifies it**, not when data happens to have arrived — gg announces its
  configuration on the stream's first event, so a run with the tasks capability
  always has a **modules → tasks** file (empty until the model builds its list), while
  a run with compaction off has no compaction file. Every agent always has **overview**,
  **activity**, and **context** files. The [Project management](/gg/project-management/)
  board is **not** a per-agent file — because it is shared run-wide it surfaces as a
  run-global **Project** section, present only when that capability is on, and an
  agent's own `modules → board` file links through to it rather than drawing a second
  copy.
- The **activity** file is gg's telemetry rendered through the _same_ feed every
  other harness's events render through, so it honors the layout picked in
  **Settings → Appearance** and a gg run doesn't read differently from every other
  run.

## Analyzing across them

The topbar's **analyze** control (beside the notifications bell and the settings
gear) enters the **gg analysis** UI: the same chrome, with the app mark replaced by
a back arrow out of the mode and the section nav replaced by gg's own tabs.

- **Dashboard** — the default tab: general metrics across every recorded gg
  session (score, cost, runtime, tokens, context-overflow rate, agents, and
  compactions), how those sessions ended, and average score broken down by
  configuration and by primary model.
- **Aggregate** — the Kibana-style query builder described in
  [Result aggregation](/gg/result-aggregation/).
- **Sessions** — every recorded gg run, newest first, as the bridge from an
  aggregate to the individual sessions behind it. This lists gg runs whatever
  their state and whether or not they were published — gg runs are experiment
  material, so most never are — which is exactly the set the other two tabs
  aggregate.
