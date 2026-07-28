---
title: "Speculative execution"
---

Best-of-K: attempt the same piece of work several times in parallel and keep the
best result. `speculate` names the [agent profile](/gg/configurations/#agents) to run
the attempts under (from the caller's [roster](/gg/subagents/)), and gg fans out K
[subagents](/gg/subagents/) of it at the same task or
[board issue](/gg/project-management/) — optionally with different approaches — each
in its own isolated git worktree, then a **judge** — a subagent run under the
capability's **`judgeAgent`** profile (defaulting to the
[Root agent](/gg/configurations/#agents)) — selects the winning attempt to merge and
discards the rest.

Every primitive it needs already exists, so it is largely an [FSM](/gg/fsms/)
(`fan-out → judge → merge/discard`) plus a merge step:

- **Fan-out** over K attempts via the subagent scheduler.
- **Isolation** so attempts do not collide — each runs in its own worktree.
- **Judging** — a judge agent picks the winner against the task's completion
  criteria.
- **Merge/discard** — the winner is merged back into the main tree; the losers are
  thrown away.

gg includes speculative execution **so its effectiveness can be measured
empirically**. It is a widely offered technique elsewhere, and the point of gg is to
settle whether such features actually help — at what token cost, and on which cases
— with data rather than intuition. Toggled against single-attempt work, it answers
"does best-of-K beat one careful attempt at a fixed budget?" as a first-class
[result-aggregation](/gg/result-aggregation/) query.
