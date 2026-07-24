---
title: "Context visibility"
---

gg **tracks what is consuming the context window**, broken down by source: skills,
memories, file contents, the thread/history, tool output, and so on.

- Internally this is the accounting that powers the fullness signal in
  [agent-managed context](/gg/agent-managed-context/) and the trigger in
  [compaction](/gg/compaction/).
- Externally this breakdown is streamed as [telemetry](/gg/telemetry/) and rendered
  in the console as a **stacked line graph** showing how an agent's context window
  fills over the course of a run, by category.
