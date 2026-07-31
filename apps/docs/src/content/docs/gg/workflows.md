---
title: "Workflows"
---

Workflows are an **alternative to ad-hoc [subagents](/gg/subagents/)**: effectively
**subagent fan-outs plus sequencing**. Where raw subagents are imperative ("spawn
these, wait, spawn more"), a workflow is a declared structure of stages, each stage
fanning work out across agents and feeding into the next.

Requirements:

- Express **fan-out** (run N agents over N items) and **sequencing** (stage A's
  results feed stage B) as a single declared unit.
- Reuse the same [subagent scheduler](/gg/subagents/#scheduling) and its
  parallelism and depth caps.

Workflows are the deterministic, structured cousin of subagents. The difference from an
[FSM process](/gg/fsms/) is who declares the structure and what the structure *is*: a
workflow is fan-out the running agent asks for, and the agents it staffs are children that
return to it; a machine is a state table the **configuration** declares, and its states
succeed one another as one agent, handing over the modules the edge names.
