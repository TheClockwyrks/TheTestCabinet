---
title: "Subagents"
---

The subagents capability lets an agent spawn other agents, work in parallel with
them, block until they return, and message them while they run. It covers ad-hoc
delegation: `spawn_subagent(agent, prompt)` takes a free-form brief. Staffing a
scoped work item belongs to the [board](/gg/project-management/), whose issues
auto-dispatch to dedicated top-level agents.

## Spawning from the roster

Every profile carries a roster of the agent profiles it may put to work, each
entry scoped to what it may be used for. `spawn_subagent` accepts a [profile
id](/gg/configurations/#identity) its caller's roster lists with the `subagent`
scope and refuses any other. The other two scopes, `implementer` and
`reviewer`, govern [issue assignment](/gg/project-management/) and are
independent of this capability: an agent may have a roster full of implementers
and reviewers while being able to spawn nothing at all.

Each roster entry carries the target's id, its name and a caller-scoped
description, surfaced in the spawning agent's tool description, so an agent is
told which id names each target it is allowed and when to reach for it. A
profile may list itself, which is how recursion is permitted.

A spawned child runs under the profile that id names, with that profile's own
capabilities, model and execution mode. It shares its parent's workspace, so
concurrent children need non-overlapping briefs. Isolated git worktrees belong
to board [issues](/gg/project-management/), which own the whole
merge-or-discard lifecycle of the branch they create.

`spawn_subagent` returns the new child's id immediately and the child runs on
its own. `wait_for_subagents` collects a child's return value: its final text,
how its loop ended, and what it declared when it ended, so a dispatcher that
asked for a verdict reads a structured fact rather than parsing prose.
`send_message` delivers a message to a running child, which drains its inbox at
each turn boundary.

The agent tree this produces, who spawned whom and who is running versus
blocked, is what the [telemetry](/gg/telemetry/overview/) capability streams to
the console for live visualization.

## Recursion depth

`maxDepth` bounds the delegation tree. The root agent is at depth 0, and an
agent at `maxDepth` may not spawn, since its child would be one level deeper.
Such a spawn fails as a limit rather than queueing: the request was well-formed
and the run has no room left below that agent.

## Scheduling

One global cap bounds how many agents run at once, counting every running agent
whatever profile or model it runs on. It is the run's
[`maxParallel`](/gg/execution-limits/), which every configuration writes — there
is no width gg runs at when nobody names one. The cap is a run-level guardrail
rather than a param on this capability because it bounds the run's concurrency as
a whole, including the top-level agents a [board](/gg/project-management/)
dispatches in a run where nothing has the subagents capability.

The grant policy:

- A newly spawned agent acquires a running slot before it runs, and blocks until
  one frees. Slots are granted first-come, first-served among waiters of equal
  priority.
- An agent that blocks waiting on its subagents releases its slot so other work
  can run, and retains priority over not-yet-started agents for the next free
  slot. It resumes only once its wait condition is met, however many slots are
  free before then.
- A slot may be held under an exclusivity key that no two running agents may
  hold at once. This is what caps a [persistent](/gg/agent-persistence/) profile
  at one running instance: every instance takes its slot under the profile's
  id, so the second queues behind the first inside the global pool. The key is
  held only while the agent runs, so an agent that blocks releases the key with
  its slot and re-takes it when it resumes.

## Forks and execs

[`fork`](/gg/fork-and-exec/) runs a copy of the forking agent, and that copy is
an ordinary child of this machinery. It takes its own id one level deeper,
contends for a slot under the same cap, stops at the same maximum depth, returns
through the same channel, and answers `wait_for_subagents` and `send_message`
like any other child. It opens already holding everything its forker worked out,
where a subagent opens on a brief somebody had to write. The `fork` call is
offered only to a profile that has both the fork capability and this one,
because a copy nobody can wait on or message is a leak rather than a second
worker.

[`exec`](/gg/fork-and-exec/) replaces the agent making it rather than adding
one, so it keeps the same depth, holds the same slot, and produces one return
value. It is validated against the same `subagent` scope of the roster that
spawning is: putting a profile to work is putting a profile to work, whether by
handing it a brief or by becoming it.

## Tools, features and parameters

Tools: `spawn_subagent`, `wait_for_subagents`, `send_message`. `spawn_subagent`
is offered when the caller's roster lists at least one spawnable target.
`wait_for_subagents` and `send_message` are offered to any agent that can have
children at all, whether by spawning them from its roster or by forking itself.

| Feature | Default | What switching it changes |
| --- | --- | --- |
| Inter-agent messaging | on | Off withholds `send_message`, leaving spawn-and-wait. |

| Param | Meaning |
| --- | --- |
| `maxDepth` | The deepest an agent may sit in the delegation tree; a spawn at that depth fails as a limit. |

An enabled subagents capability writes `maxDepth`. An absent one, and one
carrying a value gg cannot honour exactly as written, refuse the launch alongside
every other such value in the capability set. It bounds the run's whole agent
tree rather than one agent, so it is read off the first profile; a *different*
`maxDepth` on another profile would be read by nothing and refuses the launch
too.

Switched off, none of the three tools is offered and the agent delegates nothing
of its own.
