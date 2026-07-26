---
title: "Configurations"
---

A gg run is configured by a [capability set](/gg/overview/#the-capability-set), not
by a `(harness, model, orchestrator)` tuple. A **configuration** is that capability
set, *named* — the "named / preset-able" requirement the overview sets out, made
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

| Built-in | What it is |
| --- | --- |
| `minimal` | The default capability set — the launchable baseline. |
| `full` | Every capability on, with the standard compaction and subagent params. |
| `no-compaction` | Everything on except the compaction backstop — the context-overflow arm. |
| `shell-only` | Shell and nothing else — the ablation extreme. |

Creating or editing one opens the capability-set editor: the full capability
catalogue grouped by concern (each capability's on/off toggle, its swappable
implementation, and its params), the **model slots** and the **role bindings** that
consume them (below), and the per-tool [ablation](/gg/toolset-ablation/) overrides.
**Duplicate** seeds a new configuration from an existing one — the usual way to build
an ablation arm is to duplicate the arm beside it and change the one thing under
test.

Above the capability groups sits the **Run limits** fieldset — the
[execution ceilings](/gg/execution-limits/) the whole run is bounded by: turns per agent,
wall-clock seconds, consecutive errors, error rate and its window, and cost. They are not
capabilities (they apply to every capability and to both execution modes at once), so
they sit above the catalogue rather than inside a group of it. **Leaving a field empty
leaves that ceiling off**, and an untouched fieldset writes no `limits` key at all, so
every configuration saved before limits existed round-trips unchanged. The one field with
a default is turns per agent, which is 50 when empty.

One param is worth knowing about before you run a compaction study: context
visibility's [**window limit**](/gg/context-visibility/#the-window-a-run-is-measured-against)
narrows the window a run is measured against, so a compaction arm can be exercised
against a million-token model without spending a million tokens of input to reach a
boundary. It can only narrow — the model's real window is a hard limit.

A configuration is deliberately **test-case-free**, and it does not have to name the
models it runs on.

## Model slots

A configuration is meant to be reusable across models, so the models it runs on are
not all baked into it. It declares named **model slots** — launch-time model
parameters — and each [role binding](/gg/multi-model/#slots) either:

- **pins a model** outright, an *internal* binding that is identical on every run of
  the configuration and is never asked about again; or
- **defers to a model slot**, leaving the model to be supplied when a run is
  launched.

A model slot may carry a **default**, which the launch form pre-fills. Model slots are
named separately from the roles they feed precisely so two roles can share one: "run
the reviewer *and* the judge on whatever I pick for `critic`" is one launch input, not
two. gg routes every live model through OpenRouter and infers its provider from the
model id, so a slot never needs a provider pinned onto it.

The default a fresh configuration starts from is the simple case — one `primary`
model slot, with the `primary` role deferred to it — so a configuration that says
nothing about models still asks for exactly one at launch. A configuration saved
before model slots existed reads as that same shape.

Declaring a slot is an authoring-time concern only. **Launching resolves every
deferred binding to a concrete model**, so the capability set a run carries — and
records — is fully pinned, which is what keeps
[result aggregation](/gg/result-aggregation/) sliceable by "which model ran this
role". The backend rejects a launch that leaves one unresolved, naming the role.

## Storage

Configurations are per-account and private, stored by the backend:

| Endpoint | Purpose |
| --- | --- |
| `GET /gg/configs` | The account's configurations. |
| `POST /gg/configs` | Register one. |
| `PUT /gg/configs/{id}` | Update one in place. |
| `DELETE /gg/configs/{id}` | Delete one. |

Deleting a configuration does not disturb runs launched from it: every gg run
records its own resolved capability set, so the analysis surfaces keep slicing by
what actually ran.

## Launching one

gg is launched from the **ordinary New run page**, not a separate form. Picking
**gg** in the *Orchestrator* selector switches the form into the gg run mode:

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
selector because that is where an operator says *how a run is conducted*, which
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
- Inside the Agents explorer, a **file appears only where that agent produced that
  kind of data** — gg announces its configuration on the stream's first event, so an
  agent with no board and no planning pass simply has no board or plan file, rather
  than an empty panel. Every agent always has an **overview** and an **activity** file.
- The **activity** file is gg's telemetry rendered through the *same* feed every
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
