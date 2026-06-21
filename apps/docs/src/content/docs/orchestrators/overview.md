---
title: Orchestrators
---

A test case is implemented by driving a [harness](/harnesses/overview/). An
**orchestrator** decides how that harness's sessions are conducted — how many
sessions to run, what each one is told, and when the work is done — while the
harness layer still owns each individual session. The single-session behaviour is
just one orchestrator (`one-shot`); a multi-session strategy is another (`ralph`).

Orchestration is **harness-agnostic**: an orchestrator drives sessions the same
way regardless of which harness is selected. It is therefore a distinct run
dimension, selected per run alongside the test case, variant, harness, and model,
and recorded as `orchestratorSlug` on the run.

This section is the catalogue of the built-in orchestrators. For the contract
they implement — the execution model, the `tcab-session` wrapper, the runner
environment, and how external orchestrators are resolved — see the core
[Orchestrators](/components/core/orchestrators/) doc. Unlike a harness, an
orchestrator carries **no in-tree code**: it is entirely data, a directory in the
repo under `orchestrators/<slug>/` holding an `orchestrator.toml` manifest and a
runner script.

## Built-in orchestrators

| Orchestrator | Slug | What it does |
| --- | --- | --- |
| [One-shot](/orchestrators/one-shot/) | `one-shot` | A single harness session driven to completion. The default. |
| [Ralph Loop](/orchestrators/ralph/) | `ralph` | Re-runs a harness session, resuming from a progress file, until the implementation signals completion. |

## Selecting an orchestrator

An orchestrator is selected per run, defaulting to `one-shot`. Every
[runner](/components/cli/overview/) selects one, and the resolved slug is recorded
on the run.

For now, orchestrator **selection is limited to the
[end-to-end](/testing/end-to-end/overview/) test type**. Other test types always
run `one-shot` — they build a single artifact in one pass, whereas end-to-end
cases are where multi-session implementation is needed first. The run-execution UI
surfaces the selector only for end-to-end runs, and the run rejects a non-default
orchestrator for any other test type.

## External orchestrators

Because an orchestrator is just a directory of data, a custom one can be supplied
**entirely from outside this repository** at run time by pointing a run at a
directory anywhere on disk with `--orchestrator-dir <path>`. The directory has the
same shape as a built-in (`orchestrator.toml` plus a runner script). A custom
orchestrator is resolved purely at run time: it is never enumerated in this
catalogue and requires no change to The Test Cabinet's code. See
[External orchestrators](/components/core/orchestrators/#external-orchestrators).
