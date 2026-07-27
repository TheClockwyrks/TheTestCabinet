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
| `full`          | Every capability on, with the standard compaction and subagent params.   |
| `no-compaction` | Everything on except the compaction backstop — the context-overflow arm. |
| `shell-only`    | Shell and nothing else — the ablation extreme.                           |

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
configuration declares one or more **agent profiles**; the first is always the
**Root agent**, which drives the run's top-level session and cannot be removed.
Adding more profiles is how a study gives different agents different tools, models,
prompts, or execution modes — a cheap-and-fast scout, a careful reviewer, a
code-writing implementer.

Opening an agent switches the editor into that profile's own view (with a back
control to the run-level form). Each profile carries:

- its own enabled **capabilities**, their implementations and params, and per-tool
  [ablation](/gg/toolset-ablation/) overrides — so [responses as
  code](/gg/responses-as-code/) is a per-agent choice too, and one run can mix
  code-emitting and tool-calling agents;
- **one model**, either pinned outright or deferred to a run-level [model
  slot](#model-slots) (below);
- optional **custom instructions** — operator prose inserted into the agent's
  [system prompt](/gg/prompts/) — and, for full control, a complete **system-prompt
  template override** (the editor seeds it with gg's built-in template so the normal
  edit is just the custom-instructions field);
- a **subagents allowlist** — the other profiles this agent may spawn, each with a
  caller-scoped description telling it when to use that target. This is what governs
  [delegation](/gg/subagents/): an agent is spawned **by name**, and only names in
  the allowlist can be spawned (a profile may list itself, allowing recursion).

## Model slots

A configuration is meant to be reusable across models, so the models its agents run
on are not all baked into it. It declares run-level named **model slots** —
launch-time model parameters — and each agent's model either:

- **pins a model** outright, an _internal_ binding that is identical on every run of
  the configuration and is never asked about again; or
- **defers to a model slot**, leaving the model to be supplied when a run is
  launched.

A model slot may carry a **default**, which the launch form pre-fills. Model slots are
named separately from the agents they feed precisely so two agents can share one: "run
the reviewer _and_ the judge on whatever I pick for `critic`" is one launch input, not
two. gg routes every live model through OpenRouter and infers its provider from the
model id, so a slot never needs a provider pinned onto it — and because each agent
carries its own model, a run can span **several, possibly cross-provider models** at
once, which is why gg accounts usage and cost **per agent profile** rather than as one
figure for one model.

The default a fresh configuration starts from is the simple case — one `primary`
model slot, with the Root agent deferred to it — so a configuration that says nothing
about models still asks for exactly one at launch. A configuration saved before
capabilities were per-agent reads as a single Root agent bound that same way.

Declaring a slot is an authoring-time concern only. **Launching resolves every
deferred binding to a concrete model**, so the capability set a run carries — and
records — is fully pinned, which is what keeps
[result aggregation](/gg/result-aggregation/) sliceable by "which model ran this
agent". The backend rejects a launch that leaves one unresolved, naming the agent.

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
  declares, labelled with the slot's name and pre-filled with its default. A role
  the configuration pinned itself is already decided, so it never appears here.
- The submission goes to gg's own enqueue endpoint (`POST /gg/runs`) with the
  resolved capability set, rather than the flat launch body.

gg is not really an orchestrator — it is its own executor, and the
[orchestrator](/orchestrators/overview/) dimension does not apply to a gg run (see
[Overview](/gg/overview/#how-gg-fits-into-the-test-cabinet)). It is offered in that
selector because that is where an operator says _how a run is conducted_, which
makes it the one place the choice belongs. Unlike `ralph`, gg is offered for every
test type: it replaces the harness, not the session strategy.

The fan-out is unchanged, and it is exactly what an ablation study wants:
`configurations × models × run count` runs from one submission. Fixing the model
and varying the configuration is an ablation; fixing the configuration and varying
the model is a model comparison.

A launched gg run is watched on gg's own live monitor, which renders its
[telemetry](/gg/telemetry/) through **two** surfaces, led by a tab selector:
**Dashboard** — the whole-run read-out (status, the token/cost tally with its
caching and reasoning splits as rings, how many agents ran, the enforced
[FSM](/gg/fsms/) process, and the configuration it is running under) — and
**Agents**, the per-agent explorer that lays the run out as a filesystem (an agent
is a folder, the things you can monitor about it are its files, and a spawned agent
is a folder under `subagents`). That view is not only for the session that launched
the run:

- The **Runs** list opens an in-flight gg run on gg's monitor, not the generic
  harness feed.
- A finished gg run keeps a **gg tab** on its detail page, which rebuilds the very
  same two surfaces from the recorded telemetry stream.
- Inside the Agents explorer, a **file is offered when the run's capability set
  justifies it**, not when data happens to have arrived — gg announces its
  configuration on the stream's first event, so a run with the tasks capability
  always has a per-agent **tasks** file (empty until the model builds its list), while
  a run with no planning pass has no plan file. Every agent always has **overview**,
  **activity**, and **context** files. The [Project management](/gg/project-management/)
  board is **not** a per-agent file — because it is shared run-wide it surfaces as a
  run-global **Project** section, present only when that capability is on.
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
