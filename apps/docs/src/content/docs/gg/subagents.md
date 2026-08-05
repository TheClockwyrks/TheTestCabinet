---
title: "Subagents"
---

The largest delegation capability. An agent must be able to **spawn other agents**,
and then either work **in parallel** with them or **block** until they return. This
is for **ad-hoc** delegation: `spawn_subagent(agent, prompt)` takes a
free-form `prompt`. Staffing a scoped work item is a separate concern —
[Project management](/gg/project-management/) board issues **auto-dispatch** to
dedicated top-level agents, so an agent no longer hands an issue to a subagent by
hand.

Agents are spawned **by name**. Every profile carries a
[roster](/gg/configurations/#agents) — the other agent profiles it may put to work,
each scoped to what it may be used **for** — and `spawn_subagent` (like
[`fork`](/gg/fork-and-exec/), which
also name their target) **refuses a name the roster does not list with the
`subagent` scope**. The other two scopes (`implementer` and `reviewer`) govern
[issue assignment](/gg/project-management/#assigning-an-issue) instead, and are
independent of this capability: an agent may have a roster full of implementers and
reviewers without being able to spawn anything at all. Each roster entry carries a
caller-scoped description, surfaced in the spawning agent's tool description, so an
agent is told *when* to reach for each target it is allowed. A profile may list
**itself**, which is how recursion is permitted; the spawn tools are offered only
when the capability is on. The spawned child runs under the named profile — its own
capabilities, model, and [execution mode](/gg/responses-as-code/).

The roster's `subagent` scope is also what [`exec`](/gg/fork-and-exec/) is checked
against: putting a profile to work is putting a profile to work, whether by handing it a
brief or by *becoming* it, and a fourth scope for the second case would be contract
surface earning nothing.

Requirements:

- **Recursion.** An agent that lists itself can spawn copies of its own profile, up
  to a **maximum depth**; a spawn that would exceed the depth limit fails with
  `limit-exceeded` rather than queueing. It is a *ceiling*, not a refusal: the
  request was well-formed and the run simply has no room left below that agent.
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
live visualization. A spawned agent runs under a
different [agent profile](/gg/configurations/#agents) — its own model and
capabilities — than its parent, and shares its parent's workspace; isolated git
worktrees belong to [issues](/gg/project-management/) and speculation attempts, which
own the whole merge-or-discard lifecycle of the branch they create.

## Scheduling

The scheduler is intentionally simple:

- **A single global parallelism cap** (not per-level), the run's
  [`maxParallel`](/gg/execution-limits/#parallelism) — 16 unless the configuration says
  otherwise. A newly spawned subagent **blocks until a slot frees up**, and slots are
  granted **first-come, first-served**.
- **A blocked agent frees its slot.** When an agent blocks waiting on its subagents,
  it releases its slot so other work can run — but it retains **priority over
  not-yet-started agents** for the next free slot. A blocked agent **cannot be
  resumed until its wait condition is met**, even once a slot is available.
- **A [persistent](/gg/agent-persistence/) profile is capped at one running instance**
  inside that pool: its instances hold their slot under the profile's name, and no two
  running agents hold the same name.

Subagents may run under a different [agent profile](/gg/configurations/#agents) —
and so a different model — than their parent; that is orthogonal to the parallelism
cap, which counts running agents regardless of profile.

The cap is a **run-level** guardrail rather than a param on this capability, because it
bounds the run's concurrency as a whole — including the top-level agents a
[board](/gg/project-management/) dispatches, in a run where nothing has the subagents
capability at all. A `maxParallel` left on this capability by an older configuration is
still honored, but the run-level value wins when both are set.

## A fork is a subagent

[`fork`](/gg/fork-and-exec/) — run a copy of yourself — produces an ordinary child of this
machinery, and that is deliberate rather than incidental. A copy takes its own id one level
deeper, contends for a slot under the same `maxParallel` cap, stops at the same maximum
depth, returns through the same channel, and answers `wait_for_subagents` and `send_message`
like anything else. The only difference is where it starts: a subagent opens on a brief
somebody had to write, a copy opens already holding everything its forker worked out.

That is also why `fork` is offered **only** to a profile that has this capability or
its own capability. A copy nobody can wait on or message is a leak rather than a
second worker.

An [`exec`](/gg/fork-and-exec/) is the opposite case and is deliberately **not** a spawn: it
replaces the agent making it rather than adding one, so it keeps the same depth, holds the
same slot, and produces one return value. Nothing about the delegation tree changes when an
agent becomes a different agent.
