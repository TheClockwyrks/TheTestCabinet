---
title: "Code Reviews"
---

Before an [issue](/gg/epics-and-issues/) is **accepted** (marked complete), gg can
**trigger a Code Review** on it to have the work verified. (This capability is
always called a **Code Review**, never just a "review", to keep it distinct from The
Test Cabinet's own [test-run reviews](/components/backend/).)

Triggering a Code Review dispatches a reviewer — most naturally a
[subagent](/gg/subagents/), potentially on a dedicated `reviewer`
[slot](/gg/multi-model/#slots) — and gives it a **baseline to compare
against**:

- the **original commit for the run** (the workspace as seeded), or
- the **initial commit for an issue** (the workspace when the issue's work began).

The reviewer inspects the diff against that baseline and either:

- **emits one or more actionable items**, or
- **approves** the Code Review.

When actionable items come back, gg **spawns a new agent** given the **original task
that was being tackled** plus the **actionable items**, so it can fix them. There is
**no cycle limit** — a fix can be re-reviewed, produce new actionable items, be
fixed again, and so on until a review approves.

A Code Review gates acceptance: an issue is not complete until a Code Review of it
approves. This makes "definition of done" enforceable rather than aspirational, and
pairs naturally with the [FSM](/gg/fsms/) capability — a Code Review is a state in a
`develop → review → accept` machine.
