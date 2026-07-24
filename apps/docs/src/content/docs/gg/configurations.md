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
implementation, and its params), the [model slots](/gg/multi-model/#model-slots),
and the per-tool [ablation](/gg/toolset-ablation/) overrides. **Duplicate** seeds a
new configuration from an existing one — the usual way to build an ablation arm is
to duplicate the arm beside it and change the one thing under test.

A configuration is deliberately **test-case-free** and need not bind a model. The
primary slot is bound at launch (below), so one configuration serves a whole sweep
of models; only the non-primary role slots (reviewer, planner, judge, …) are worth
pinning here, and only when the configuration is *about* those bindings.

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
- The row's **model** binds the configuration's
  [primary slot](/gg/multi-model/#model-slots); the configuration's other slot
  bindings carry through untouched.
- The submission goes to gg's own enqueue endpoint (`POST /gg/runs`) with the
  capability set, rather than the flat launch body.

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
[telemetry](/gg/telemetry/) — the agent tree, the epic/issue board, and the
context-fill graphs — rather than a harness event feed.

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
  aggregate to the individual sessions behind it.
