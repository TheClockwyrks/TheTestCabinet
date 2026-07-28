---
title: Orchestrators
---

A test case is implemented by driving a [harness](/harnesses/overview/). An
**orchestrator** decides how that harness's sessions are conducted — how many
sessions to run, what each one is told, and when the work is done — while the
harness layer still owns each individual session. The single-session behaviour is
just one orchestrator (`one-shot`); a multi-session strategy would be another.

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

`one-shot` is the only built-in. A multi-session strategy layered on a
third-party harness — re-running sessions and passing progress between them
through the filesystem — was shipped as a built-in (`ralph`) and has since been
removed: [gg](/gg/overview/), The Test Cabinet's own harness, conducts multi-step
work directly through its own executor (context compaction, memories, a project
board, sub-agents), which supersedes what an external session loop could do. A
session-loop strategy can still be run as an
[external orchestrator](#external-orchestrators).

## Selecting an orchestrator

An orchestrator is selected per run, defaulting to `one-shot`. Every
[runner](/components/cli/overview/) selects one, and the resolved slug is recorded
on the run.

A **non-default** orchestrator — in practice an external one, since `one-shot` is
the only built-in — is **limited to the test types that build a program over a
working session**: [end-to-end](/testing/end-to-end/overview/),
[full-stack](/testing/full-stack/overview/), and
[game-jam](/testing/game-jam/overview/). The other types build a single artifact
in one pass, and the run rejects a non-default orchestrator for them.

## External orchestrators

Because an orchestrator is just a directory of data, a custom one can be supplied
**entirely from outside this repository** at run time by pointing a run at a
directory anywhere on disk with `--orchestrator-dir <path>`. The directory has the
same shape as a built-in (`orchestrator.toml` plus a runner script). A custom
orchestrator is resolved purely at run time: it is never enumerated in this
catalogue and requires no change to The Test Cabinet's code. See
[External orchestrators](/components/core/orchestrators/#external-orchestrators).
