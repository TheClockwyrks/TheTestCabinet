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

Workflows are the deterministic, structured cousin of subagents;
[FSM-driven processes](/gg/fsms/) push this further into predetermined control flow.
