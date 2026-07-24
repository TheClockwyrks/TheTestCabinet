---
title: "Experimental capabilities"
---

These are the capabilities that make gg worth building as a research
instrument: features **no harness we currently drive has**. They are more
speculative than the [parity capabilities](/gg/parity/) and more likely
to change as the design settles — but they are the reason gg exists rather
than us simply picking the best third-party harness.

As with every gg feature, each is a module in the sense described in
[Capabilities & run configuration](/gg/capabilities/): toggleable, and
individually attributable in an ablation study.

## Epics & issues

An expansion of the [tasks/TODO](/gg/parity/#tasks--todo) capability
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
- An issue can be **dispatched to a [subagent](/gg/parity/#subagents)**
  to implement — the issue's structured fields become the subagent's brief.

The epic/issue board is retained across [compaction](/gg/parity/#compaction)
like the task list, and it is a primary thing the
[improved telemetry](#improved-telemetry) capability streams to the console.

## Code Reviews

Before an [issue](#epics--issues) is **accepted** (marked complete), gg can
**trigger a Code Review** on it to have the work verified. (This capability is
always called a **Code Review**, never just a "review", to keep it distinct from
The Test Cabinet's own [test-run reviews](/components/backend/).)

Triggering a Code Review dispatches a reviewer — most naturally a
[subagent](/gg/parity/#subagents), potentially on a dedicated `reviewer`
[model slot](/gg/capabilities/#model-slots) — and gives it a **baseline
to compare against**:

- the **original commit for the run** (the workspace as seeded), or
- the **initial commit for an issue** (the workspace when the issue's work began).

The reviewer inspects the diff against that baseline and either:

- **emits one or more actionable items**, or
- **approves** the Code Review.

When actionable items come back, gg **spawns a new agent** given the **original
task that was being tackled** plus the **actionable items**, so it can fix them.
There is **no cycle limit** — a fix can be re-reviewed, produce new actionable
items, be fixed again, and so on until a review approves.

A Code Review gates acceptance: an issue is not complete until a Code Review of it
approves. This makes "definition of done" enforceable rather than aspirational,
and pairs naturally with the [FSM](#fsm-driven-processes) capability — a Code
Review is a state in a `develop → review → accept` machine.

## Agent-managed context windows

Give each agent **agency over its own context window** rather than managing it
implicitly.

- An agent is **told how full its context window is**, as an explicit signal it
  can act on.
- An agent can **evict file views** it no longer needs, reclaiming context.
- An agent can **archive a section of its thread** (its history): the data is
  removed from the live context but **remains searchable**, so it is recoverable
  without occupying the window.

This is the model-facing complement to [compaction](/gg/parity/#compaction):
compaction is the automatic backstop when the window fills; agent-managed context
lets a disciplined agent avoid ever hitting it. It depends on
[richer context visibility](#richer-context-visibility) for the fullness signal.

## Richer context visibility

gg **tracks what is consuming the context window**, broken down by source:
skills, memories, file contents, the thread/history, tool output, and so on.

- Internally this is the accounting that powers the fullness signal in
  [agent-managed context](#agent-managed-context-windows) and the trigger in
  [compaction](/gg/parity/#compaction).
- Externally this breakdown is streamed as [telemetry](#improved-telemetry) and
  rendered in the console as a **stacked line graph** showing how an agent's
  context window fills over the course of a run, by category.

## Improved telemetry

Because gg is **part of The Test Cabinet**, it streams **far richer
telemetry** back than the normalized [event](/components/core/events/)/[metric](/components/core/metrics/)
contract requires, and the backend and console understand it **natively**.

The extended telemetry must let the console display:

- **Epics and issues** and their statuses (the live [board](#epics--issues)).
- The **agents/subagents** that are running, and the **tree** they form.
- For each agent, whether it is **actively executing or blocked** waiting on other
  agents.
- The **context-window breakdown** over time — the stacked line graph from
  [richer context visibility](#richer-context-visibility).

This telemetry is **custom** — a purpose-built structured stream to The Test
Cabinet, designed to carry the live, hierarchical, high-cardinality state above
(the agent tree and the issue board), which pure metrics and plain spans model
poorly. A run **may also** export [OpenTelemetry](/development/observability/)
(spans/metrics/logs, as any run can), but the **primary** telemetry is the custom
channel, not OTel.

It rides an **additional channel** on top of the standard harness contract, so a
gg run is still a valid, scoreable run with the extended telemetry stripped (see
[Overview → How gg fits into The Test Cabinet](/gg/overview/#how-gg-fits-into-the-test-cabinet)).
The custom schema is what [result aggregation](#result-aggregation) queries, so
the two are designed together.

## Result aggregation

gg sessions must be **queryable Kibana-style**: run structured queries across
many gg sessions to gather and analyze data — not just look at one run at a
time.

The point is to make the experiments gg enables **analyzable in aggregate**:
"across every run with compaction off, how often did the model run out of
context?", "which planning implementation produced fewer reopened issues?", "how
does subagent depth correlate with score?". This is where the
[capability set](/gg/capabilities/#the-experiment-a-runs-capability-set)
recorded on each run pays off — it is the dimension every aggregate query slices
by.

This capability depends directly on the [telemetry](#improved-telemetry) schema:
we can only aggregate over fields we durably record.

## Multi-model

Subagents can be **dispatched using different models** — and, in The Test
Cabinet's case, **not necessarily from the same provider** as the parent.

This is expressed through [model slots](/gg/capabilities/#model-slots):
a run binds models (possibly cross-provider) to named slots, and agents are
dispatched on a slot rather than a hardcoded model. That indirection is what lets
a study re-point, say, the `subagent` slot from an expensive model to a cheap one
without touching any capability logic, and measure the cost/quality tradeoff.

Some third-party harnesses support multi-model in a limited, same-provider way;
gg's contribution is making it **cross-provider** and **slot-bound** so it is
a clean experimental variable.

## FSM-driven processes

A structured alternative to [workflows](/gg/parity/#workflows) built on
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

FSMs compose with other capabilities: a [Code Review](#code-reviews) is naturally
a state (`develop → review → accept`), and
[planning](/gg/parity/#planning)'s "plan then implement from a fresh
context" is itself a small FSM.

FSMs are **authored as part of the harness** — a built-in library shipped with gg
(for example TDD-ordered, review-gated, and plan-first machines), not a
per-study data format and not something the model defines for itself. Selecting
which FSM (if any) drives a run is part of the
[capability set](/gg/capabilities/#the-experiment-a-runs-capability-set).

## Responses as code

An alternative to traditional tool calling: agents **emit code**, and gg executes
it in a **[wasmtime](https://wasmtime.dev/) sandbox** rather than dispatching
discrete tool calls. The agent expresses what it wants to do as a program over the
available tools — loops, conditionals, intermediate values, several tool
invocations composed together — which the sandbox runs, returning the result.

This is well-trodden ground for us: the same approach is already implemented and
well understood in another of the author's projects (and wasmtime is already the
sandbox The Test Cabinet's [Foray](/testing/adversarial/foray/architecture/)
engine runs untrusted controllers in), so it is a low-risk capability to bring to
gg. As a [capability](/gg/capabilities/) it can be toggled against
traditional tool calling to measure whether code-shaped responses help a model
tackle the large [Hard](/testing/end-to-end/) cases.
