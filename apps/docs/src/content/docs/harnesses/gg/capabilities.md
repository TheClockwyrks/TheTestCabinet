---
title: "Capabilities & run configuration"
---

This page describes the machinery that makes GameGen an **instrument** rather than
just a good agent: the modular capability model, the ability to swap in competing
implementations of a capability, model slots, and how a single run pins all of
this into a reproducible **experiment**. Read the
[overview](/harnesses/gg/overview/) first for the motivation.

The individual capabilities themselves are documented under
[Parity](/harnesses/gg/parity/) and [Experiments](/harnesses/gg/experiments/).
This page is only about how they are *configured and selected*.

## The capability model

GameGen is a **small core** — the agent turn loop, tool dispatch, and message
transport — plus a set of independently pluggable **capabilities**. Compaction,
tasks, skills, memories, subagents, workflows, planning, epics/issues, code
reviews, agent-managed context, FSMs: each is a capability, not a hardwired part
of the loop.

Every capability is:

- **Toggleable.** It can be switched off entirely. With a capability off, GameGen
  behaves as if that feature does not exist — no tools for it are exposed to the
  model, no prompt text describes it, and it consumes no context. This is the
  basis for **ablation studies**: run the same model on the same test case with
  compaction on and off, and the difference is attributable to compaction.
- **Configurable.** A capability that is on can be parameterized (for example,
  the compaction trigger threshold, the maximum subagent depth, or the memory
  budget).
- **Swappable**, where it matters. Some capabilities can have more than one
  **implementation** registered, and a run selects which one is active. This is
  the basis for **A/B comparisons**: two planning strategies, two compaction
  summarizers, or two subagent schedulers, measured head to head.

:::note[Open question: how deep does "modular" go?]
Toggling and parameterization are clearly in scope. Full **swappable
implementations** are more expensive to build (each capability needs a stable
internal interface every implementation conforms to). We likely want swappable
implementations for the capabilities we most want to *study* — planning,
compaction, subagent scheduling — and toggle-only for the rest. Which
capabilities get the full treatment is undecided.
:::

## The experiment: a run's capability set

A GameGen run is configured by a **capability set**: the full list of which
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
  [Result aggregation](/harnesses/gg/experiments/#result-aggregation)).
- **Named / preset-able** — common configurations ("full", "minimal",
  "no-compaction", "planning-A") should be nameable presets so a study is a
  sweep over presets rather than hand-assembled flag soup.

:::note[Open question: where does the capability set live?]
Candidates: a field on the harness invocation, a `gg`-specific manifest checked
into the repo (mirroring how orchestrators and harnesses are declared), or a
first-class Test Cabinet concept bound to a run at dispatch time. The last would
integrate most cleanly with result aggregation but is the most work. Undecided.
:::

## Model slots

GameGen supports [multi-model](/harnesses/gg/experiments/#multi-model) runs, and
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
like "does using a cheaper model for subagents cost much accuracy?" a
one-line change to the capability set.

## Relationship to orchestrators

The Test Cabinet already has [orchestrators](/orchestrators/overview/) — the
data-driven strategies that decide how a run's harness sessions are conducted
(single-session `one-shot` versus multi-session `ralph`). GameGen's internal
capabilities overlap conceptually with orchestration, so the boundary needs to
be explicit.

:::note[Open question: orchestrator boundary]
Some GameGen capabilities (compaction, planning, workflows) resemble what an
orchestrator does across sessions, but GameGen does them *within* a single
harness session. The likely framing: the orchestrator still owns the outer
session strategy, and GameGen owns everything within a session — but compaction
in particular blurs this, since it is "continue beyond the context window", which
is close to what `ralph` does across sessions. We need to decide whether GameGen
runs under `one-shot` and does all its own continuation internally, or whether it
cooperates with a multi-session orchestrator. Undecided.
:::
