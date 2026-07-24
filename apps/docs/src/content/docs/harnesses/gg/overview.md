---
title: "Overview"
---

**GameGen** (slug `gg`) is The Test Cabinet's own coding harness — the first
harness authored *inside* this repository rather than integrated from a third
party. It is the headline feature of **v0.7.0**, and this section is its design
document. It describes what GameGen is for, the shape of its architecture, and
the capabilities it must ship, so the design can be reviewed and settled **before
implementation begins**.

:::caution[Design phase]
Nothing on these pages is built yet. Everything here is a design intent under
active discussion. Sections marked **Open question** are explicitly unresolved
and are the agenda for the design conversation, not decisions. When the design
settles, these pages become the authoritative reference and this banner comes
down.
:::

## Why GameGen exists

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
  window. The working hypothesis behind GameGen is that **current models are
  being under-measured on the hard cases purely for want of a better harness**,
  and that better scaffolding will move the numbers.
- **Some existing harnesses are actively wasteful.** OpenCode, for example, halts
  the entire session on the first API error (see
  [OpenCode → Overview](/harnesses/opencode/overview/)). On a long run with an
  expensive model that throws away hours of work and a large amount of money for
  a single transient failure. A first-party harness can be resilient by design.

GameGen is not meant to be a "fair" neutral baseline — the third-party catalogue
already fills that role. It is meant to be **the best harness we can build**, and
to be **an instrument**: something we can take apart, reconfigure, and measure, so
that "which harness features actually matter?" becomes an experimental question
rather than a matter of opinion.

## Design principles

Three principles run through every page in this section.

1. **Everything is a modular capability.** GameGen is not a monolithic agent
   loop with features bolted on. It is a small core plus a set of independently
   toggleable **capabilities** (compaction, subagents, memories, and so on). Any
   capability can be switched off, and — where it matters — swapped for a
   *different implementation* of the same capability. This is what makes GameGen
   an instrument: see [Capabilities & run configuration](/harnesses/gg/capabilities/).
2. **It is an instrument first.** GameGen must make ablation studies ("does
   compaction help?") and A/B comparisons ("which planning strategy wins?")
   cheap to run and clean to measure. Design choices that trade a little raw
   capability for a lot of measurability are usually the right call.
3. **It is a first-party citizen of The Test Cabinet.** Unlike the third-party
   harnesses, GameGen is built by us and runs inside our own pipeline. It can
   therefore stream far richer telemetry than the normalized event/metric
   contract requires, and the backend and console can understand that telemetry
   natively — epics and issues, the live agent tree, per-agent context
   breakdowns, and cross-session queryability. See
   [Telemetry & Test Cabinet integration](/harnesses/gg/experiments/#improved-telemetry).

## How GameGen fits the harness contract

Even though GameGen is far richer internally than any third-party harness, to the
rest of The Test Cabinet it is **still just a harness**. It must satisfy the same
[Agent Harnesses](/components/core/harnesses/) contract every other harness does:

- a **declarative** half — a `harnesses/gg/harness.toml` manifest naming the CLI
  binary and its install command;
- an **imperative** half — an adapter that knows how to invoke it
  non-interactively, parse its usage, and translate its output into the
  normalized [event](/components/core/events/) and [metric](/components/core/metrics/)
  streams.

This means GameGen drops into the existing dispatcher → driver → backend pipeline
with no special-casing, is selectable per run like any other harness, and is
directly comparable against the third-party harnesses on the same test cases.
Its **richer** telemetry rides an *additional* channel on top of the normalized
contract — a first-party extension the backend recognizes — never a replacement
for it. A GameGen run with its extended telemetry stripped is still a valid,
scoreable run.

:::note[Open question: install & distribution]
GameGen is a first-party binary, so — unlike the third-party harnesses, which
install their latest published CLI at run time — we could bake it into the run
container image, install it from a pinned release, or build it from the repo. The
tradeoff is reproducibility (pinning) versus iteration speed. Undecided.
:::

## The capabilities at a glance

GameGen's capabilities fall into two groups. **Parity** capabilities are the ones
every serious harness needs; GameGen must have them to be a credible replacement.
**Experimental** capabilities are novel — no existing harness we drive has them —
and are the reason GameGen is interesting as a research instrument.

| Group | Capability | Page |
| --- | --- | --- |
| Parity | Compaction | [Parity → Compaction](/harnesses/gg/parity/#compaction) |
| Parity | Tasks / TODO (a DAG) | [Parity → Tasks](/harnesses/gg/parity/#tasks--todo) |
| Parity | Skills | [Parity → Skills](/harnesses/gg/parity/#skills) |
| Parity | Memories | [Parity → Memories](/harnesses/gg/parity/#memories) |
| Parity | Subagents | [Parity → Subagents](/harnesses/gg/parity/#subagents) |
| Parity | Workflows | [Parity → Workflows](/harnesses/gg/parity/#workflows) |
| Parity | Planning | [Parity → Planning](/harnesses/gg/parity/#planning) |
| Experimental | Epics & issues | [Experiments → Epics & issues](/harnesses/gg/experiments/#epics--issues) |
| Experimental | Code reviews | [Experiments → Code reviews](/harnesses/gg/experiments/#code-reviews) |
| Experimental | Agent-managed context windows | [Experiments → Agent-managed context](/harnesses/gg/experiments/#agent-managed-context-windows) |
| Experimental | Richer context visibility | [Experiments → Context visibility](/harnesses/gg/experiments/#richer-context-visibility) |
| Experimental | Improved telemetry | [Experiments → Improved telemetry](/harnesses/gg/experiments/#improved-telemetry) |
| Experimental | Result aggregation (Kibana-style) | [Experiments → Result aggregation](/harnesses/gg/experiments/#result-aggregation) |
| Experimental | Multi-model (model slots) | [Experiments → Multi-model](/harnesses/gg/experiments/#multi-model) |
| Experimental | FSM-driven processes | [Experiments → FSMs](/harnesses/gg/experiments/#fsm-driven-processes) |

## Reading order

1. **This page** — motivation, principles, and how GameGen fits the pipeline.
2. [**Capabilities & run configuration**](/harnesses/gg/capabilities/) — the
   modular-capability model that makes GameGen an instrument: toggling,
   competing implementations, model slots, and how a run pins an experiment.
3. [**Parity capabilities**](/harnesses/gg/parity/) — the seven table-stakes
   capabilities and their requirements.
4. [**Experimental capabilities**](/harnesses/gg/experiments/) — the eight novel
   capabilities, including the telemetry and result-aggregation work that make
   GameGen legible inside The Test Cabinet.
