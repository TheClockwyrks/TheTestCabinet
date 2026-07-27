---
title: "Subagents"
---

The largest delegation capability. An agent must be able to **spawn other agents**,
and then either work **in parallel** with them or **block** until they return. This
is for **ad-hoc** delegation: `spawn_subagent(agent, prompt, { worktree? })` takes a
free-form `prompt`. Staffing a scoped work item is a separate concern —
[Project management](/gg/project-management/) board issues **auto-dispatch** to
dedicated top-level agents, so an agent no longer hands an issue to a subagent by
hand.

Agents are spawned **by name**. Every profile carries a
[subagents allowlist](/gg/configurations/#agents) — the other agent profiles it may
spawn — and `spawn_subagent` (like [`speculate`](/gg/speculative-execution/) and
[`run_workflow`](/gg/workflows/), which also name their target) **refuses a name that
is not on it**. Each allowlist entry carries a caller-scoped description, surfaced in
the spawning agent's tool description, so an agent is told *when* to reach for each
subagent it is allowed. A profile may list **itself**, which is how recursion is
permitted; the spawn tools are offered only when the capability is on **and** the
allowlist is non-empty. The spawned child runs under the named profile — its own
capabilities, model, and [execution mode](/gg/responses-as-code/).

Requirements:

- **Recursion.** An agent that lists itself can spawn copies of its own profile, up
  to a **maximum depth**; a spawn that would exceed the depth limit is refused rather
  than queued.
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
[speculative execution](/gg/speculative-execution/), and
[Code Reviews](/gg/code-reviews/); a spawned agent can run in an isolated
[worktree](/gg/worktrees/), and under a different [agent
profile](/gg/configurations/#agents) — its own model and capabilities — than its
parent.

## Scheduling

The scheduler is intentionally simple:

- **A single global parallelism cap** (not per-level). A newly spawned subagent
  **blocks until a slot frees up**, and slots are granted **first-come,
  first-served**.
- **A blocked agent frees its slot.** When an agent blocks waiting on its subagents,
  it releases its slot so other work can run — but it retains **priority over
  not-yet-started agents** for the next free slot. A blocked agent **cannot be
  resumed until its wait condition is met**, even once a slot is available.

Subagents may run under a different [agent profile](/gg/configurations/#agents) —
and so a different model — than their parent; that is orthogonal to the parallelism
cap, which counts running agents regardless of profile.
