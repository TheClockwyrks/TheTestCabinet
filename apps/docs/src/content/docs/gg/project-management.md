---
title: "Project management"
---

A single, **run-global work board** shared by every agent in the run — the
heavyweight counterpart to per-agent [tasks](/gg/tasks/). Where a task list is
scoped to one agent, the board is one thing the whole run plans against, and it is
what turns gg from a single agent into a fleet working a backlog.

- **Epics** group related issues together — organization only, no behaviour of
  their own.
- **Issues** are heavier than tasks. Instead of just a title and description, an
  issue has structured sections: **title**, optional **description**, **in-scope**,
  **out-of-scope**, and **completion criteria**. The explicit scope boundaries and
  completion criteria are what make an issue safe to hand to a fresh agent — they
  tell it exactly what it is and is not responsible for, and how it will be judged
  done. An issue also names the **agent** it is assigned to (below).
- Issues form a **blocked-by DAG** — an issue can be blocked by one or more others,
  and the relation must stay acyclic. gg rejects any edge that would introduce a
  cycle, including on submit.
- The board **survives [compaction](/gg/compaction/) verbatim**, like the task list,
  and it is a primary thing the [telemetry](/gg/telemetry/) capability streams to the
  console.

Any agent with permission can create epics and issues; there is one board, not one
per agent.

## Auto-dispatch

The board **runs itself**. Submitting an issue **enqueues** it. Once every issue it
is blocked by is **Done**, gg **automatically spawns a dedicated top-level agent**
and assigns it the issue — the issue's structured fields become that agent's brief.
Agents no longer hand issues to [subagents](/gg/subagents/) by hand; the old
`spawn_subagent { issueId }` path is gone, and `spawn_subagent` now names the
[agent](/gg/subagents/) to spawn for ad-hoc delegation. Auto-spawned agents appear
as **top-level** agents in the Agents view, not under whoever filed the issue.

An issue moves through:

- **open** — enqueued, waiting on its blockers (or on scheduler capacity).
- **in_progress** — an agent has been spawned and assigned to it.
- **done** — accepted, or **failed** — terminal but not done.

If an assigned agent finishes without completing its issue, gg **re-dispatches** it
up to `maxRetries` times (default 1), then marks it **failed**. A failed issue is
terminal but **not** done, so its dependents **stay blocked** — the board surfaces
the stall rather than silently unblocking the work behind it.

## Assigning an issue

**Which agent works an issue is decided when the issue is filed**, not in the
configuration. `create_issue` takes a required **`agent`** naming the
[agent profile](/gg/configurations/#agents) gg dispatches it under, and an agent may
only assign an issue to a profile in **its own
[subagents allowlist](/gg/configurations/#agents)** — the same set it could spawn
directly. One allowlist therefore governs both delegation and issue assignment: an
agent can never put a worker to a task that it was not given in the first place. A
call naming anything else is refused, and the refusal lists the profiles that *are*
assignable.

The consequence at authoring time: a configuration where an agent can **create**
issues but has **no subagents** is rejected at launch, because every issue it could
write would be refused. Give it a subagent (a profile may list itself), or switch
its issue-creation feature off for read-only board access (below).

## Waiting on an issue

An agent can call **`wait_for_issue`** with an issue id to **suspend itself** until
that issue reaches a terminal state, then resume and learn whether it was **done** or
**failed**. Suspending this way frees scheduler capacity, so a waiting agent doesn't
hold a slot (the same slot discipline the [subagent scheduler](/gg/subagents/#scheduling)
enforces). You **cannot** wait on the issue you were assigned to implement.

The blocked-by DAG and `wait_for_issue` are **core** to the capability — they are
what makes a board a board rather than a list, so they are always on wherever the
capability is.

## Features

Two things about the board *are* per-agent, and each is a slider in the capability's
**Features** box:

| Feature | Default | What switching it off (or on) does |
| --- | --- | --- |
| **Issue creation** | on | Off withholds `create_epic`/`create_issue`, leaving that agent **read-only** access to the board: it still sees the whole board in its context, can wait on issues, and can complete the one it was assigned — it just cannot file new work. |
| **Reviewers** | off | On, `create_issue` additionally **requires** one or more **`reviewers`**, drawn from the same allowlist as `agent`. A [Code Review](/gg/code-reviews/) of that issue is then run by each of them in turn, and **all** of them must approve before the issue is accepted. |
| **Revise the board** | on | Off withholds `update_issue`/`remove_epic`/`remove_issue`, so the board is append-only. |

## Tools & parameters

Board tools: `create_epic`, `create_issue`, `update_issue`, `set_issue_blocked_by`,
`complete_issue`, `remove_epic`, `remove_issue`, plus `wait_for_issue`.

| Param | Default | Meaning |
| --- | --- | --- |
| `maxEpics` | 50 | Maximum epics on the board. |
| `maxIssues` | 2000 | Maximum issues on the board. |
| `maxRetries` | 1 | Re-dispatches of a failed assignment before the issue is marked failed; may be 0 for no retry. |
| `reviewers` | off | The **Reviewers** feature above: require every filed issue to name its reviewers. |

Like every capability this one is **ablatable**: switched off, there are no board
tools and no auto-dispatch, and gg behaves as if the board does not exist.

Before an issue is accepted, a [Code Review](/gg/code-reviews/) can be required to
gate it — by the issue's own reviewers when it named any, and otherwise by the
code-reviews capability's run-level `reviewerAgent`.
