---
title: "Capabilities & run configuration"
---

This page describes the machinery that makes gg an **instrument** rather than
just a good agent: the modular capability model, the ability to swap in competing
implementations of a capability, model slots, and how a single run pins all of
this into a reproducible **experiment**. Read the
[overview](/gg/overview/) first for the motivation.

The individual capabilities themselves are documented under
[Parity](/gg/parity/) and [Experiments](/gg/experiments/).
This page is only about how they are *configured and selected*.

## The capability model

gg is a **small core** — the agent turn loop, tool dispatch, and message
transport — plus a set of independently pluggable **capabilities**. Compaction,
tasks, skills, memories, subagents, workflows, planning, epics/issues, code
reviews, agent-managed context, FSMs: each is a capability, not a hardwired part
of the loop.

Every capability is:

- **Toggleable.** It can be switched off entirely. With a capability off, gg
  behaves as if that feature does not exist — no tools for it are exposed to the
  model, no prompt text describes it, and it consumes no context. This is the
  basis for **ablation studies**: run the same model on the same test case with
  compaction on and off, and the difference is attributable to compaction.
- **Configurable.** A capability that is on can be parameterized (for example,
  the compaction trigger threshold, the maximum subagent depth, or the memory
  budget).
- **Swappable**, where it matters. A capability is swapped by offering a
  **different tool, or a different implementation of a tool** (or, for the loop
  itself, a different agent-loop implementation) — see the note below. A run
  selects which is active. This is the basis for **A/B comparisons**: two planning
  tools, two compaction summarizers, or two subagent schedulers, measured head to
  head.

Modularity is deliberately kept cheap. gg ships **one or more agent-loop
implementations**, and *beyond that* modularity comes almost entirely from **which
tools are offered to the agents** — a different set of tools, or a different
implementation of a given tool, reconfigures behaviour without a combinatorial
explosion of pluggable subsystems. So "swap the compaction strategy" or "swap the
planner" is, in practice, "offer a different tool (or tool implementation) for
it", not a bespoke plugin interface per capability. The agent loop is the only
coarse-grained plug point.

## The experiment: a run's capability set

A gg run is configured by a **capability set**: the full list of which
capabilities are on, which implementation each on-capability uses, its
parameters, and the [model-slot](#model-slots) bindings. The capability set is
the *independent variable* of an experiment — freeze the model and the test case,
vary the capability set, and the harness becomes a laboratory.

The capability set must be:

- **Declarative and inspectable** — expressible as data, so a run's exact
  configuration is recorded and reproducible, not implied by code.
- **Recorded on the run** — captured in the run record and surfaced in the
  console, so every result is traceable to the exact configuration that produced
  it. This is what makes an ablation study analyzable after the fact (see
  [Result aggregation](/gg/experiments/#result-aggregation)).
- **Named / preset-able** — common configurations ("full", "minimal",
  "no-compaction", "planning-A") should be nameable presets so a study is a
  sweep over presets rather than hand-assembled flag soup.

The capability set is a **first-class Test Cabinet concept**, and it is the config
surface that **replaces** the flat `harness + model + orchestrator` tuple for a gg
run (only the test case and variant carry over from the conventional run
dimensions — those are test-case-level). It is not buried in a flag or an ad-hoc
file. Making it first-class is what keeps an experiment reproducible and lets
[result aggregation](/gg/experiments/#result-aggregation) slice results by
configuration natively — and it is a large part of the Test Cabinet UI work gg
requires, since none of the existing run-configuration or result surfaces fit it
(see [Overview → How gg fits into The Test Cabinet](/gg/overview/#how-gg-fits-into-the-test-cabinet)).

## Model slots

gg supports [multi-model](/gg/experiments/#multi-model) runs, and
model selection is expressed through **slots**. Rather than binding a single
model to the whole run, a capability set binds models to a small set of named
**slots** (for example a `primary` slot and a `subagent` slot, or role-specific
slots like `planner`, `implementer`, `reviewer`).

- Capabilities reference models **by slot**, never by a hardcoded model ID. A
  subagent is dispatched "on the `reviewer` slot", not "on `claude-opus-4-8`".
- Slots are **bound at run configuration time** as part of the capability set, so
  a study can re-point a slot without touching any capability's logic.
- Slots may be bound to models from **different providers** — there is no
  requirement that every slot use the same vendor. This is the crux of the
  multi-model capability.

Model slots are the seam between the abstract "which agent uses which model"
question and the concrete provider/credentials plumbing, and they make questions
like "does using a cheaper model for subagents cost much accuracy?" a one-line
change to the capability set.

Because a single gg run spans **several models**, usage and cost are accounted
**per slot** (and per model within a slot), not as one figure for one model. This
per-slot accounting is also the concrete reason a gg run cannot be a single point
on the existing per-model metric graphs — there is no one model it belongs to —
and hence why gg results live in their own space (see
[Overview → How gg fits into The Test Cabinet](/gg/overview/#how-gg-fits-into-the-test-cabinet)).

## No orchestrator: gg is its own executor

The Test Cabinet's [orchestrators](/orchestrators/overview/) exist to loop a
*stateless external harness* across sessions (`one-shot` runs one session,
`ralph` re-runs and resumes from a progress file) because such a harness cannot
continue past its own context window. **gg has no such limitation and no such
layer.** It continues *within* one logical session via
[compaction](/gg/parity/#compaction), and, being first-party, it is **invoked
directly** by The Test Cabinet — there is no `tcab-session` wrapper, no external
harness subprocess, and nothing for an orchestrator to loop.

So the orchestrator dimension does not apply to a gg run: gg **is** the executor.
It drives its agents itself and integrates directly with the platform, which is
what lets it stream the rich [telemetry](/gg/experiments/#improved-telemetry) and
carry the [capability set](#the-experiment-a-runs-capability-set) that a
stdout-parsed external CLI never could.
