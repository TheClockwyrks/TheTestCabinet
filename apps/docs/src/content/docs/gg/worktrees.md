---
title: "Worktrees"
---

A [subagent](/gg/subagents/) — whether spawned directly or as part of a
[workflow](/gg/workflows/) — can run in a **git worktree** instead of the main
workspace tree.

The worktree gives an agent an **isolated copy of the workspace** to mutate, so
several agents can work in parallel without trampling one another's edits, and the
result is merged back (or discarded) deliberately rather than racing on shared
files. Whether a spawned agent runs in the main tree or a fresh worktree is a
property of how it is dispatched. Worktrees are what make
[speculative execution](/gg/speculative-execution/) — several attempts at the same
work — safe to run concurrently.
