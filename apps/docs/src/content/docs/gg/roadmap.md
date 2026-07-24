---
title: "Roadmap"
---

**This is a temporary document.** It sequences the implementation of gg and will be
**deleted once gg is built** — at which point the per-capability pages are the whole
story. It is not part of gg's design; it is the order in which the design gets
built. Where this page and a capability page disagree on *what* something does, the
capability page wins — this page only decides *when*.

## How to use this

The [capability pages](/gg/overview/#capabilities) are the spec. This roadmap groups
them into phases ordered by dependency: each phase produces something **runnable and
drivable from the Test Cabinet UI**, and each depends only on phases above it. The
cut points are a proposal — reorder freely — but the **dependencies** between
capabilities are real and are called out so a reorder stays honest.

The one hard rule that shapes every phase: gg is
[**headless**](/gg/overview/#how-gg-fits-into-the-test-cabinet). It has no TUI and no
interface of its own, so the Test Cabinet UI is the *only* way to configure, launch,
and watch it. The UI is therefore **not a trailing track** — each phase ships the
backend capability **and** the UI to drive and monitor it, in the same increment. If
a phase's work cannot be exercised from the UI, that phase is not done. The UI comes
online in Phase 0 (you must be able to start and watch a run before anything else is
worth building) and grows one capability at a time.

The [telemetry](/gg/telemetry/) schema is the substrate for all of that monitoring,
so it is designed up front: its stream and a minimal live monitor land in **Phase
0**, and its richer views (agent tree, issue board, context-fill graph) arrive in
the phase whose data they display.

Each phase below lists **Backend** (gg itself) and **UI** (drive + monitor) work;
both must land for the phase to count.

## Phase 0 — Core, integration & the cockpit

The small core, its wiring into The Test Cabinet, and the minimum UI to drive it.

- **Backend:** the agent turn loop, tool dispatch, and message transport; direct
  [invocation](/gg/overview/#how-gg-fits-into-the-test-cabinet) by The Test Cabinet
  (no `tcab-session`, no orchestrator) reusing the shared run infrastructure
  (container, seeding/`init`, max-runtime, validation and scoring); the
  [capability set](/gg/overview/#the-capability-set) as first-class recorded config;
  [model-slot](/gg/multi-model/#model-slots) plumbing (one slot suffices);
  [install](/gg/overview/#installation--distribution) (local no-deps; k8s
  GitHub-release); the [telemetry](/gg/telemetry/) stream (schema v1) emitting live.
- **UI:** a run-configuration/launch surface (choose test case + capability set +
  slot bindings and start a run) and a **minimal live monitor** (run status, the
  agent's activity/log, token and cost).

**Done when:** you can configure and launch a gg run **from the UI** and watch it
build a test case to a scored artifact — no TUI, no CLI hand-holding.

## Phase 1 — Context accounting & knowledge state

Everything compaction must retain has to exist first.

- **Backend:** [context visibility](/gg/context-visibility/) (per-source window
  accounting); [skills](/gg/skills/); [memories](/gg/memories/) (bounded);
  [tasks](/gg/tasks/) (the blocked-by DAG).
- **UI:** the **context-fill graph** (stacked, by source); live views of the task
  DAG, loaded skills, and curated memories.

**Done when:** you can watch the window's composition and the task DAG / skills /
memories evolve live in the UI.

## Phase 2 — Continuation

The point at which a run can exceed one context window.

- **Backend:** [compaction](/gg/compaction/), honoring the retention contract
  (skills read, active tasks, memories) from Phase 1;
  [agent-managed context](/gg/agent-managed-context/) (evict file views, archive
  thread history).
- **UI:** compaction boundaries marked on the monitor and context graph; retained
  state shown carrying over; evict/archive actions visible.

**Done when:** a compaction boundary is visible in the UI with its retained state
intact, and an agent's own window management is observable.

## Phase 3 — Work decomposition

- **Backend:** [epics & issues](/gg/epics-and-issues/) (scoped, dispatchable,
  retained across compaction); [planning](/gg/planning/) as a tool (enter plan mode
  mid-session; its FSM form arrives in Phase 5).
- **UI:** the live **epic/issue board**; a plan view.

**Done when:** a build can be decomposed into a board and a plan-then-implement pass
is drivable and observable from the UI.

## Phase 4 — Delegation

- **Backend:** [subagents](/gg/subagents/) and the
  [scheduler](/gg/subagents/#scheduling) (global parallelism cap, depth cap,
  blocked-frees-slot-with-priority), with return values and parent→child messaging;
  [worktrees](/gg/worktrees/); [workflows](/gg/workflows/);
  [multi-model](/gg/multi-model/) (subagents on different, possibly cross-provider
  slots; per-slot usage/cost).
- **UI:** the live **agent tree** (who spawned whom, running vs blocked), per-slot
  model and cost, and a worktree indicator.

**Done when:** the agent tree, blocked/running state, and per-slot cost are visible
live while an agent delegates under the caps.

## Phase 5 — Process & quality

Everything here composes Phase 4's delegation.

- **Backend:** [Code Reviews](/gg/code-reviews/) (baseline-diff, gate issue
  acceptance, spawn fix agents, no cycle limit); [FSM-driven processes](/gg/fsms/)
  (built-in machine library — TDD-ordered, review-gated, plan-first);
  [speculative execution](/gg/speculative-execution/) (best-of-K over worktrees with
  a judge/merge step).
- **UI:** Code Review outcomes and actionable items; the FSM's current state;
  speculative attempts and the chosen winner.

**Done when:** an issue can be driven through a fixed process, reviewed against its
completion criteria before acceptance, and optionally attempted K-ways — all visible
in the UI.

## Phase 6 — Aggregation & experiment tooling

- **Backend:** [result aggregation](/gg/result-aggregation/) (query across sessions,
  sliced by capability set); [toolset ablation](/gg/toolset-ablation/) (toolset as a
  recorded, slice-by facet); [responses as code](/gg/responses-as-code/) (the
  wasmtime path, toggleable against traditional tool calling).
- **UI:** the **Kibana-style** cross-session query/analysis surface; capability-set
  preset management; the responses-as-code toggle.

**Done when:** a study can be configured, run across many sessions, and analyzed in
aggregate from the UI.

## Phase 7 — Debug tooling

- **Backend + UI:** [replay](/gg/replay/) — deterministic session reconstruction and
  a view to step through it, for debugging only. Deferred to last on purpose, but
  the Phase 0 telemetry schema must already carry what replay needs to pin (model
  I/O, tool results).

## Removing this document

Delete `roadmap.md` (and its sidebar entry) once every capability above is
implemented, its page describes shipped behavior, and it is drivable from the UI. At
that point the roadmap has no readers left — the design pages are the reference, and
the git history holds the sequence.
