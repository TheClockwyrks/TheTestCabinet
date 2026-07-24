---
title: "Subagents"
---

The largest delegation capability. An agent must be able to **spawn other agents**,
and then either work **in parallel** with them or **block** until they return.

Requirements:

- **Recursion.** Subagents can spawn their own subagents, up to a **maximum
  depth**; a spawn that would exceed the depth limit is refused rather than queued.
- **Bounded parallelism.** Unbounded fan-out would melt the run, so a **scheduler**
  enforces a global cap on how many agents run at once; a spawn beyond the cap
  **blocks until a slot frees** (see [scheduling](#scheduling) below) rather than
  running immediately.
- **Return values.** A subagent can **return information** to the agent that spawned
  it.
- **Messaging.** A parent agent can **send a message to** a running subagent (not
  only spawn-and-wait) — so the relationship is a live channel, not a one-shot call.

The agent tree this produces — who spawned whom, who is running versus blocked — is
exactly what the [telemetry](/gg/telemetry/) capability streams to the console for
live visualization. Subagents also underpin [workflows](/gg/workflows/),
[speculative execution](/gg/speculative-execution/), issue dispatch, and
[Code Reviews](/gg/code-reviews/); a spawned agent can run in an isolated
[worktree](/gg/worktrees/), and on a different
[model slot](/gg/multi-model/#model-slots) than its parent.

## Scheduling

The scheduler is intentionally simple:

- **A single global parallelism cap** (not per-level). A newly spawned subagent
  **blocks until a slot frees up**, and slots are granted **first-come,
  first-served**.
- **A blocked agent frees its slot.** When an agent blocks waiting on its subagents,
  it releases its slot so other work can run — but it retains **priority over
  not-yet-started agents** for the next free slot. A blocked agent **cannot be
  resumed until its wait condition is met**, even once a slot is available.

Subagents may run on a different [model slot](/gg/multi-model/#model-slots) than
their parent; that is orthogonal to the parallelism cap, which counts running
agents regardless of slot.
