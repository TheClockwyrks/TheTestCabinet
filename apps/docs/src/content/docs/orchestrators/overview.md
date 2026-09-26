---
title: Orchestrators
---

A test case is implemented by driving a [harness](/harnesses/overview/). An
orchestrator decides how that harness's sessions are conducted: how many sessions
to run, what each one is told, and when the work is done. The harness layer still
owns each individual session. A single session driven to completion is one
orchestrator, `one-shot`; spreading a case across several sessions that build on
each other is another.

Orchestration is harness-agnostic. An orchestrator drives sessions the same way
whichever harness is selected, so it is a distinct run dimension, selected per
run alongside the test case, variant, harness, and model, and recorded as
`orchestratorSlug` on the run.

This section is the catalogue of the built-in orchestrators. An orchestrator
carries no in-tree code: it is a directory under `orchestrators/<slug>/` holding
an `orchestrator.toml` manifest and a runner script. For the contract they
implement, covering the execution model, the `tcab-session` wrapper, the runner
environment, and how external orchestrators are resolved, see
[Orchestrators](/components/core/orchestrators/).

## Built-in orchestrators

| Orchestrator                         | Slug       | What it does                                                |
| ------------------------------------ | ---------- | ----------------------------------------------------------- |
| [One-shot](/orchestrators/one-shot/) | `one-shot` | A single harness session driven to completion. The default. |

The built-ins are embedded into `crates/core` at build time, so a backend-driven
worker with no checkout resolves them the same way the CLI does. They are listed
by `tcab orchestrators`.

## Selecting an orchestrator

An orchestrator is selected per run, defaulting to `one-shot`, and the resolved
slug is recorded on the run. The [CLI](/components/cli/overview/) selects one
with `--orchestrator <slug>`.

A non-default orchestrator is limited to the test types that build a program over
a working session: [end-to-end](/testing/end-to-end/overview/),
[full-stack](/testing/full-stack/overview/), and
[game-jam](/testing/game-jam/overview/). The other types build a single artifact
in one pass, and a run rejects a non-default orchestrator for them before any
container is started.

## External orchestrators

Because an orchestrator is a directory of data, a custom one can be supplied
entirely from outside this repository and resolved at run time from a directory
anywhere on disk. The directory has the same shape as a built-in, and its own
manifest slug is authoritative for the run record. An external orchestrator is
never enumerated in this catalogue and requires no change to The Test Cabinet's
code.
