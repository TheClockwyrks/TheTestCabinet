---
title: "Overview"
---

**gg** is The Test Cabinet's own coding harness — the first authored *inside* this
repository rather than integrated from a third party. It is the headline feature of
**v0.7.0**, and this section is its design document, describing what gg is for, the
shape of its architecture, and the capabilities it must ship, so the design can be
reviewed and settled **before implementation begins**.

gg is documented in **its own top-level section**, not under
[Harnesses](/harnesses/overview/), on purpose. That catalogue describes third-party
tools The Test Cabinet integrates with from *one* side. gg is different in kind:
we own **both sides**, so gg is a distinct **run mode** with its own configuration
surface, its own result views, and its own comparison space — a first-party
subsystem of The Test Cabinet, not a ninth entry in the harness catalogue. See
[How gg fits into The Test Cabinet](#how-gg-fits-into-the-test-cabinet).

## Why gg exists

The Test Cabinet already drives models through eight third-party harnesses
(catalogued under [Harnesses](/harnesses/overview/)). Building a ninth — our own
— is a deliberate response to three problems with that catalogue:

- **The existing harnesses are uniformly mediocre.** Each is slightly stronger in
  some area, but none is excellent, and they are close enough to one another that
  the benchmark is mostly measuring the *model* through a flat, generic agent
  loop. A meaningfully better harness would let a model show what it can actually
  do.
- **None of them equip a model for large-scale software development.** The
  [Hard](/testing/end-to-end/) test cases target substantial, multi-subsystem
  builds, and the current harnesses give a model no first-class support for
  planning, decomposition, delegation, or working beyond a single context
  window. The working hypothesis behind gg is that **current models are
  being under-measured on the hard cases purely for want of a better harness**,
  and that better scaffolding will move the numbers.
- **Some existing harnesses are actively wasteful.** OpenCode, for example, halts
  the entire session on the first API error (see
  [OpenCode → Overview](/harnesses/opencode/overview/)). On a long run with an
  expensive model that throws away hours of work and a large amount of money for
  a single transient failure. A first-party harness can be resilient by design.

gg is not meant to be a "fair" neutral baseline — the third-party catalogue
already fills that role. It is meant to be **the best harness we can build**, and
to be **an instrument**: something we can take apart, reconfigure, and measure, so
that "which harness features actually matter?" becomes an experimental question
rather than a matter of opinion.

## Design principles

Three principles run through every page in this section.

1. **Everything is a modular capability.** gg is not a monolithic agent
   loop with features bolted on. It is a small core plus a set of independently
   toggleable **capabilities** (compaction, subagents, memories, and so on). Any
   capability can be switched off, and — where it matters — swapped for a
   *different implementation* of the same capability. This is what makes gg
   an instrument: see [Capabilities & run configuration](/gg/capabilities/).
2. **It is an instrument first.** gg must make ablation studies ("does
   compaction help?") and A/B comparisons ("which planning strategy wins?")
   cheap to run and clean to measure. Design choices that trade a little raw
   capability for a lot of measurability are usually the right call.
3. **It is a first-party citizen of The Test Cabinet.** Because we own both the
   harness and the platform, gg is not squeezed through the third-party harness
   contract. It integrates **directly** with The Test Cabinet: a richer
   configuration surface going in, and a custom telemetry stream coming back that
   the backend and console understand natively — epics and issues, the live agent
   tree, per-agent context breakdowns, and cross-session queryability. This
   direct ownership is also what justifies the significant Test Cabinet UI work gg
   requires, and why its runs live in their own space. See
   [Telemetry & Test Cabinet integration](/gg/experiments/#improved-telemetry).

## How gg fits into The Test Cabinet

gg is **its own run mode**, separate from the existing harness-driven runs — not a
`(harness, model, orchestrator)` point in the current pipeline. Three consequences
of owning both sides drive that separation:

- **Its configuration surface is much richer and unshared.** A conventional run is
  a flat tuple of harness + model + orchestrator. A gg run is configured by a
  [capability set](/gg/capabilities/#the-experiment-a-runs-capability-set) — which
  capabilities are on, which tool implementations back them, which FSM (if any)
  drives it, and a binding of **multiple, possibly cross-provider models to
  [slots](/gg/capabilities/#model-slots)**. None of that maps onto the existing run
  dimensions, so gg gets its own configuration space rather than overloading them.
- **Its results belong in a separate comparison space.** The current metric graphs
  plot results **per model**, precisely because the third-party harnesses are so
  similar that which harness ran barely matters. gg breaks both assumptions: it is
  deliberately *not* similar, and a multi-model gg run has **no single model to
  plot**. Lumping gg in would distort both the existing graphs and gg's own data,
  so gg results are surfaced **separately**, in views built for them (the agent
  tree, the epic/issue board, context-fill graphs, and
  [Kibana-style aggregation](/gg/experiments/#result-aggregation)).
- **It is invoked directly, not as an orchestrated subprocess.** The
  [orchestrator](/orchestrators/overview/) layer exists to loop a *stateless
  external harness* across sessions (`ralph`) because such a harness cannot
  continue past its own context window. gg continues *within* one logical session
  via [compaction](/gg/parity/#compaction) and integrates directly with The Test
  Cabinet, so there is **no external session loop, no `tcab-session` wrapper, and
  no harness subprocess** to orchestrate. The orchestrator dimension simply does
  not apply to a gg run.

What gg **does** reuse is the shared run *infrastructure*, since that is
test-case-level, not harness-level: the run container, the test case's seeding and
`init`, the run's maximum-runtime bound, and the
[validation](/components/core/validation/) and scoring of the produced game. A gg
run still yields a playable, scoreable, reviewable artifact — it just gets there
through its own executor and records a far richer run record on the way.

### Installation & distribution

gg is installed by context. **Locally**, it runs with **no external resources** —
a hard requirement for rapid iteration, so a developer can exercise it fully
offline from a local build. **In k8s**, it is **published as a GitHub release and
downloaded from there** at run time — the same shape as the third-party harnesses'
install step, but pulling our own release rather than a public registry.

## The capabilities at a glance

gg's capabilities fall into two groups. **Parity** capabilities are the ones
every serious harness needs; gg must have them to be a credible replacement.
**Experimental** capabilities are novel — no existing harness we drive has them —
and are the reason gg is interesting as a research instrument.

| Group | Capability | Page |
| --- | --- | --- |
| Parity | Compaction | [Parity → Compaction](/gg/parity/#compaction) |
| Parity | Tasks / TODO (a DAG) | [Parity → Tasks](/gg/parity/#tasks--todo) |
| Parity | Skills | [Parity → Skills](/gg/parity/#skills) |
| Parity | Memories | [Parity → Memories](/gg/parity/#memories) |
| Parity | Subagents | [Parity → Subagents](/gg/parity/#subagents) |
| Parity | Workflows | [Parity → Workflows](/gg/parity/#workflows) |
| Parity | Planning | [Parity → Planning](/gg/parity/#planning) |
| Parity | Worktrees | [Parity → Worktrees](/gg/parity/#worktrees) |
| Experimental | Epics & issues | [Experiments → Epics & issues](/gg/experiments/#epics--issues) |
| Experimental | Code Reviews | [Experiments → Code Reviews](/gg/experiments/#code-reviews) |
| Experimental | Agent-managed context windows | [Experiments → Agent-managed context](/gg/experiments/#agent-managed-context-windows) |
| Experimental | Richer context visibility | [Experiments → Context visibility](/gg/experiments/#richer-context-visibility) |
| Experimental | Improved telemetry | [Experiments → Improved telemetry](/gg/experiments/#improved-telemetry) |
| Experimental | Result aggregation (Kibana-style) | [Experiments → Result aggregation](/gg/experiments/#result-aggregation) |
| Experimental | Multi-model (model slots) | [Experiments → Multi-model](/gg/experiments/#multi-model) |
| Experimental | FSM-driven processes | [Experiments → FSMs](/gg/experiments/#fsm-driven-processes) |
| Experimental | Responses as code (wasmtime) | [Experiments → Responses as code](/gg/experiments/#responses-as-code) |

## Reading order

1. **This page** — motivation, principles, and how gg fits the pipeline.
2. [**Capabilities & run configuration**](/gg/capabilities/) — the
   modular-capability model that makes gg an instrument: toggling,
   competing implementations, model slots, and how a run pins an experiment.
3. [**Parity capabilities**](/gg/parity/) — the seven table-stakes
   capabilities and their requirements.
4. [**Experimental capabilities**](/gg/experiments/) — the eight novel
   capabilities, including the telemetry and result-aggregation work that make
   gg legible inside The Test Cabinet.
