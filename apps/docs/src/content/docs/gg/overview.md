---
title: "Overview"
---

**gg** is The Test Cabinet's own coding harness — the first authored _inside_ this
repository rather than integrated from a third party, and the headline feature of
**v0.7.0**. This section documents its design: what gg is, how a run is configured,
how it fits into The Test Cabinet, and each capability it ships (one page per
capability).

gg lives in **its own top-level section**, not under
[Harnesses](/harnesses/overview/). That catalogue describes third-party tools The
Test Cabinet integrates with from _one_ side; gg is different in kind. We own
**both sides**, so gg is a distinct **run mode** with its own configuration
surface, its own result views, and its own comparison space — a first-party
subsystem of The Test Cabinet, not a ninth entry in the harness catalogue.

## How gg fits into The Test Cabinet

gg is its own run mode, separate from the existing harness-driven runs — not a
`(harness, model, orchestrator)` point in the current pipeline. Three consequences
of owning both sides drive that separation:

- **Its configuration surface is much richer and unshared.** A conventional run is
  a flat tuple of harness + model + orchestrator. A gg run is configured by a
  [capability set](#the-capability-set) — a set of **per-agent
  [profiles](/gg/configurations/#agents)**, each with its own capabilities, tool
  implementations, [FSM](/gg/fsms/) (if any), and one **possibly cross-provider
  model**. None of that maps onto the existing run dimensions, so gg gets its own
  configuration space rather than overloading them.
- **Its results belong in a separate comparison space.** The current metric graphs
  plot results **per model**, precisely because the third-party harnesses are so
  similar that which harness ran barely matters. gg breaks both assumptions: it is
  deliberately _not_ similar, and a run whose agents span several models has **no
  single model to plot**. Lumping gg in would distort both the existing graphs and gg's own data,
  so gg results are surfaced **separately**, in views built for them (the agent
  tree, the run-global project board, context-fill graphs, and
  [Kibana-style aggregation](/gg/result-aggregation/)).
- **It is invoked directly, not as an orchestrated subprocess.** The
  [orchestrator](/orchestrators/overview/) layer exists to loop a _stateless
  external harness_ across sessions, because such a harness cannot continue past
  its own context window — the reason the built-in that did so (`ralph`) has been
  removed now that gg exists. gg continues _within_ one logical session
  via [compaction](/gg/compaction/) and integrates directly with The Test Cabinet,
  so there is **no external session loop, no `tcab-session` wrapper, and no harness
  subprocess** to orchestrate. The orchestrator dimension does not apply to a gg
  run: gg **is** the executor.

What gg **does** reuse is the shared run _infrastructure_, since that is
test-case-level, not harness-level: the run container, the test case's seeding and
`init`, the run's maximum-runtime bound, and the
[validation](/components/core/validation/) and scoring of the produced game. A gg
run still yields a playable, scoreable, reviewable artifact — it just gets there
through its own executor and records a far richer run record on the way.

gg is **headless**: it has no TUI and no direct user interaction of its own. It is
configured, launched, and monitored **entirely through the Test Cabinet UI** — the
capability set is assembled there as a named
[configuration](/gg/configurations/), launched from the ordinary new-run form by
picking gg as the orchestrator, and the [telemetry](/gg/telemetry/) channel is a
run's only live window into what its agents are doing. Building that UI is therefore
not a follow-on to gg but a **co-requirement**: each capability ships with the UI to
drive and observe it, from the very first runnable version onward.

## The capability set

gg is a **small core** — the agent turn loop, tool dispatch, and message transport
— plus a set of independently pluggable **capabilities**, one per page in this
section. Every capability is:

- **Toggleable.** It can be switched off entirely. With a capability off, gg
  behaves as if the feature does not exist — no tools for it are exposed to the
  model, no [prompt text](/gg/prompts/) describes it, and it consumes no context.
  This is the basis for **ablation studies**: run the same model on the same test
  case with a capability on and off, and the difference is attributable to it.
- **Configurable.** A capability that is on can be parameterized (for example the
  compaction trigger threshold, the subagent parallelism cap, or the memory
  budget).
- **Swappable**, where it matters — by offering a different tool or a different
  implementation of a tool (see [Modularity](#modularity-through-tools)). This is
  the basis for **A/B comparisons** between two implementations of the same
  capability.

A gg run is configured by a **capability set**: one or more per-agent
[profiles](/gg/configurations/#agents) — each with its own enabled capabilities,
their implementations and parameters, and one model binding — plus the run-level
model slots and limits. The capability set is the
_independent variable_ of an experiment — freeze the model and the test case, vary
the capability set, and the harness becomes a laboratory. It must be:

- **Declarative and inspectable** — expressible as data, so a run's exact
  configuration is recorded and reproducible, not implied by code.
- **Recorded on the run** — captured in the run record and surfaced in the console,
  so every result is traceable to the exact configuration that produced it (this is
  what makes an ablation study analyzable after the fact; see
  [Result aggregation](/gg/result-aggregation/)).
- **Named / preset-able** — common configurations ("full", "minimal",
  "no-compaction", "planning-A") should be nameable presets, so a study is a sweep
  over presets rather than hand-assembled flag soup. A named capability set is a
  [configuration](/gg/configurations/): registered on an operator's account, then
  picked by name when a run is launched.

The set carries one thing that is _not_ a capability: the run's
[**execution limits**](/gg/execution-limits/) — the ceilings on turns, wall clock,
consecutive errors, recent error rate and cost that stop a run and record which one
stopped it. They live here rather than among the capabilities because a capability is a
feature under ablation while a ceiling is an operator's guardrail over all of them, and
because the set is what a run _records_, so a run stopped by a ceiling carries both the
breach and the ceiling that produced it.

The capability set is a **first-class Test Cabinet concept** that **replaces** the
`harness + model + orchestrator` tuple for a gg run (only the test case and variant
carry over — those are test-case-level). Making it first-class is what keeps an
experiment reproducible and lets [result aggregation](/gg/result-aggregation/)
slice results by configuration natively, and it is a large part of the Test Cabinet
UI work gg requires, since none of the existing run-configuration or result
surfaces fit it.

## Modularity through tools

Modularity is deliberately kept cheap. gg ships **one or more agent-loop
implementations**, and _beyond that_ modularity comes almost entirely from **which
tools are offered to the agents** — a different set of tools, or a different
implementation of a given tool, reconfigures behaviour without a combinatorial
explosion of pluggable subsystems. So "swap the compaction strategy" or "swap the
planner" is, in practice, "offer a different tool (or tool implementation) for it",
not a bespoke plugin interface per capability. The agent loop is the only
coarse-grained plug point. Treating the toolset itself as an experimental variable
is [toolset ablation](/gg/toolset-ablation/).

## Installation & distribution

gg is installed by context. **Locally**, it runs with **no external resources** — a
hard requirement for rapid iteration, so a developer can exercise it fully offline
from a local build. **In k8s**, it is **published as a GitHub release and
downloaded from there** at run time — the same shape as the third-party harnesses'
install step, but pulling our own release rather than a public registry.

## Capabilities

Each capability has its own page. They are grouped here by concern for reading; the
grouping is editorial, not a structural distinction. How a capability set is named,
saved, launched, and analyzed in the console is
[Configurations](/gg/configurations/).

**Context**

- [Autoload specifications](/gg/autoload-specifications/) — seed an agent's opening
  context with the whole test-case brief, optionally locked in place.
- [Compaction](/gg/compaction/) — summarize and restart a thread to continue past
  the context window.
- [Context Window Override](/gg/context-visibility/#the-window-a-run-is-measured-against)
  — narrow the window a run is measured against, to exercise compaction against a
  large-window model cheaply. (The per-source [context visibility](/gg/context-visibility/)
  accounting itself is intrinsic, not a capability.)
- [Agent-managed context](/gg/agent-managed-context/) — let an agent evict file
  views and archive thread history.

**Knowledge**

- [Skills](/gg/skills/) — pre-authored markdown, description shown up front, body
  retained across compaction once read.
- [Memories](/gg/memories/) — the same, but curated by the model itself, and
  bounded.

**Work tracking**

- [Tasks](/gg/tasks/) — a lightweight blocked-by DAG of to-dos.
- [Project management](/gg/project-management/) — a run-global board of scoped,
  auto-dispatched work items.
- [Planning](/gg/planning/) — a read-only planning pass, then implement from a
  fresh context.

**Delegation**

- [Subagents](/gg/subagents/) — spawn, parallelize, block on, and message other
  agents.
- [Workflows](/gg/workflows/) — declared subagent fan-out plus sequencing.
- [Speculative execution](/gg/speculative-execution/) — best-of-K attempts judged
  to a winner.

**Process & quality**

- [FSM-driven processes](/gg/fsms/) — fixed, named processes (e.g. TDD order) the
  agent is driven through.

**Models & tools**

- [Shell](/gg/shell/) — run commands in the run container, and the output-offloading
  mode that keeps a chatty build out of the context window.
- [Filesystem tools](/gg/filesystem/) — read, write, edit, and list files; one
  capability per tool, and `read_file`'s capped read modes.
- [Toolset ablation](/gg/toolset-ablation/) — treat the offered toolset as an
  experimental variable.
- [Responses as code](/gg/responses-as-code/) — agents emit code run in a wasmtime
  sandbox instead of discrete tool calls.
- [Response healing](/gg/response-healing/) — the counted, disclosed repairs gg makes
  to a reply before running it as a program.

**Observability**

- [Telemetry](/gg/telemetry/) — the custom, first-party stream the console renders.
- [Result aggregation](/gg/result-aggregation/) — Kibana-style queries across many
  gg sessions.
- [Replay](/gg/replay/) — deterministic session replay, for debugging only.
