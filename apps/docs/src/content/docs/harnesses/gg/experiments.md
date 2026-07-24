---
title: "Experimental capabilities"
---

These are the capabilities that make GameGen worth building as a research
instrument: features **no harness we currently drive has**. They are more
speculative than the [parity capabilities](/harnesses/gg/parity/) and more likely
to change as the design settles — but they are the reason GameGen exists rather
than us simply picking the best third-party harness.

As with every GameGen feature, each is a module in the sense described in
[Capabilities & run configuration](/harnesses/gg/capabilities/): toggleable, and
individually attributable in an ablation study.

## Epics & issues

An expansion of the [tasks/TODO](/harnesses/gg/parity/#tasks--todo) capability
into something substantial enough to organize a large build.

- **Epics** group related issues together for organization.
- **Issues** are heavier than tasks. Instead of just a title and description, an
  issue has structured sections: **title**, **description**, **in-scope**,
  **out-of-scope**, and **completion criteria**. The explicit scope boundaries
  and completion criteria are what make an issue safe to hand to a subagent — they
  tell the subagent exactly what it is and is not responsible for, and how it will
  be judged done.
- Issues can be **blocked by** other issues (the same acyclic blocked-by relation
  as tasks).
- An issue can be **dispatched to a [subagent](/harnesses/gg/parity/#subagents)**
  to implement — the issue's structured fields become the subagent's brief.

The epic/issue board is retained across [compaction](/harnesses/gg/parity/#compaction)
like the task list, and it is a primary thing the
[improved telemetry](#improved-telemetry) capability streams to the console.

## Code reviews

Before an [issue](#epics--issues) is **accepted** (marked complete), GameGen can
**trigger a code review** on it to have the work verified.

- A review is run on an issue's implementation — most naturally by a
  [subagent](/harnesses/gg/parity/#subagents) (potentially on a dedicated
  `reviewer` [model slot](/harnesses/gg/capabilities/#model-slots)) that checks
  the work against the issue's **completion criteria**.
- The review gates acceptance: an issue is not complete until its review passes.

This makes "definition of done" enforceable rather than aspirational, and pairs
naturally with the [FSM](#fsm-driven-processes) capability (a review is a state
in a develop → review → accept machine).

:::note[Open question: review outcomes & loops]
What a failed review does — reopen the issue, spawn a fix subagent, annotate with
required changes — and how many review/fix cycles are allowed before escalating,
needs specifying. It also overlaps with The Test Cabinet's own
[review](/components/backend/) concepts and naming; we should avoid collision.
:::

## Agent-managed context windows

Give each agent **agency over its own context window** rather than managing it
implicitly.

- An agent is **told how full its context window is**, as an explicit signal it
  can act on.
- An agent can **evict file views** it no longer needs, reclaiming context.
- An agent can **archive a section of its thread** (its history): the data is
  removed from the live context but **remains searchable**, so it is recoverable
  without occupying the window.

This is the model-facing complement to [compaction](/harnesses/gg/parity/#compaction):
compaction is the automatic backstop when the window fills; agent-managed context
lets a disciplined agent avoid ever hitting it. It depends on
[richer context visibility](#richer-context-visibility) for the fullness signal.

## Richer context visibility

GameGen **tracks what is consuming the context window**, broken down by source:
skills, memories, file contents, the thread/history, tool output, and so on.

- Internally this is the accounting that powers the fullness signal in
  [agent-managed context](#agent-managed-context-windows) and the trigger in
  [compaction](/harnesses/gg/parity/#compaction).
- Externally this breakdown is streamed as [telemetry](#improved-telemetry) and
  rendered in the console as a **stacked line graph** showing how an agent's
  context window fills over the course of a run, by category.

## Improved telemetry

Because GameGen is **part of The Test Cabinet**, it streams **far richer
telemetry** back than the normalized [event](/components/core/events/)/[metric](/components/core/metrics/)
contract requires, and the backend and console understand it **natively**.

The extended telemetry must let the console display:

- **Epics and issues** and their statuses (the live [board](#epics--issues)).
- The **agents/subagents** that are running, and the **tree** they form.
- For each agent, whether it is **actively executing or blocked** waiting on other
  agents.
- The **context-window breakdown** over time — the stacked line graph from
  [richer context visibility](#richer-context-visibility).

This rides an **additional channel** on top of the standard harness contract, so
a GameGen run is still a valid, scoreable run with the extended telemetry
stripped (see [Overview → How GameGen fits the harness contract](/harnesses/gg/overview/#how-gamegen-fits-the-harness-contract)).
It builds on The Test Cabinet's existing OpenTelemetry story (see
[Observability](/development/observability/)).

:::note[Open question: transport & schema]
Whether the extended telemetry rides OpenTelemetry (custom spans/attributes on
the run's trace) or a purpose-built structured event stream to the backend is
undecided. It needs to carry live, hierarchical, high-cardinality state (the
agent tree and issue board), which is a poor fit for pure metrics and a lot for
plain spans. This is the biggest integration question in the section, and it
gates [result aggregation](#result-aggregation).
:::

## Result aggregation

GameGen sessions must be **queryable Kibana-style**: run structured queries across
many GameGen sessions to gather and analyze data — not just look at one run at a
time.

The point is to make the experiments GameGen enables **analyzable in aggregate**:
"across every run with compaction off, how often did the model run out of
context?", "which planning implementation produced fewer reopened issues?", "how
does subagent depth correlate with score?". This is where the
[capability set](/harnesses/gg/capabilities/#the-experiment-a-runs-capability-set)
recorded on each run pays off — it is the dimension every aggregate query slices
by.

This capability depends directly on the [telemetry](#improved-telemetry) schema:
we can only aggregate over fields we durably record.

## Multi-model

Subagents can be **dispatched using different models** — and, in The Test
Cabinet's case, **not necessarily from the same provider** as the parent.

This is expressed through [model slots](/harnesses/gg/capabilities/#model-slots):
a run binds models (possibly cross-provider) to named slots, and agents are
dispatched on a slot rather than a hardcoded model. That indirection is what lets
a study re-point, say, the `subagent` slot from an expensive model to a cheap one
without touching any capability logic, and measure the cost/quality tradeoff.

Some third-party harnesses support multi-model in a limited, same-provider way;
GameGen's contribution is making it **cross-provider** and **slot-bound** so it is
a clean experimental variable.

## FSM-driven processes

A structured alternative to [workflows](/harnesses/gg/parity/#workflows) built on
**predetermined finite state machines**. Where a workflow is a fan-out plus
sequencing the agent assembles, an FSM is a **fixed, named process** the agent is
driven through.

The motivating example is enforcing a **test-driven development** order:

```
write tests → implement → verify with tests
```

as opposed to the default `implement → write tests`. The FSM makes the *order* a
property of the process, not a matter of the model's discretion — the agent
cannot skip to "implement" before "write tests" because the machine will not let
it.

FSMs compose with other capabilities: [code review](#code-reviews) is naturally a
state (`develop → review → accept`), and [planning](/harnesses/gg/parity/#planning)'s
"plan then implement from a fresh context" is itself a small FSM.

:::note[Open question: who authors FSMs, and how prescriptive]
Whether FSMs are a fixed built-in library (TDD, review-gated, plan-first), a
data-driven format authored per study (like [orchestrators](/orchestrators/overview/)),
or something the model can define for itself, is undecided — and it determines
how much of the [experiment](/harnesses/gg/capabilities/) surface FSMs expose.
:::
