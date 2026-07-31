---
title: "Project management"
---

A single, **run-global work board** shared by every agent in the run — the
heavyweight counterpart to per-agent [tasks](/gg/tasks/). Where a task list is
scoped to one agent, the board is one thing the whole run plans against, and it is
what turns gg from a single agent into a fleet working a backlog.

- **Epics** group related issues together — organization only, no behaviour of
  their own. An epic is created from a **3–6 letter prefix** (upper-cased: `auth`
  becomes `AUTH`), and that prefix is its id.
- **Issues** are heavier than tasks. Instead of just a title and description, an
  issue has structured sections: **title**, optional **description**, **in-scope**,
  **out-of-scope**, and **completion criteria**. The explicit scope boundaries and
  completion criteria are what make an issue safe to hand to a fresh agent — they
  tell it exactly what it is and is not responsible for, and how it will be judged
  done. An issue also names the **agent** it is assigned to and, optionally, the
  **reviewers** that must approve it (both below).
- **gg names the work, not the model.** An issue's id is **assigned**: it is its
  epic's prefix and the next number under it — `AUTH-1`, `AUTH-2`, … (`ISSUE-1` for
  an issue filed with no epic) — and reported back to whoever filed it. The agents
  gg dispatches are named from *that* in turn: the *n*th agent to implement `AUTH-1`
  is `AUTH-1.0i`, `AUTH-1.1i`, … (`i` for implementer), and the reviewers of one
  implementer's work are `AUTH-1.0i.0r`, `AUTH-1.0i.1r` (`r` for reviewer). One name
  therefore locates a piece of work, which attempt at it, and which review of that
  attempt — which is what keeps a fleet of concurrent agents legible in the logs, the
  telemetry, and the console's Agents tree. A model choosing ids could not do that:
  it cannot know what the other agents sharing the board have already used.
- Issues form a **blocked-by DAG** — an issue can be blocked by one or more others,
  and the relation must stay acyclic. gg rejects any edge that would introduce a
  cycle, including on submit.
- The board **survives [compaction](/gg/compaction/) verbatim**, like the task list,
  and it is a primary thing the [telemetry](/gg/telemetry/) capability streams to the
  console.

Any agent with permission can create epics and issues; there is one board, not one
per agent. Because the board is run-global, the run **has** one as soon as *any*
[agent profile](/gg/configurations/#agents) enables this capability — it does not have
to be the Root. A configuration that puts project management on a dedicated
board-owning profile gets a board, a dispatcher, and worktrees just the same.

## The board is run-global; the view of it is not

The **pinned board block** — the whole decomposition, rebuilt at every turn boundary and
[retained across compaction](/gg/compaction/) — is attached only to the window of an agent
whose **own profile enables this capability**. It is the same gate the prompt's board
section uses, so what an agent is *told* about the board and what it is *shown* of it can
never disagree.

An agent without the capability therefore never sees the board at all. That is the point:
it has no board tool, is not told a board exists, and cannot act on one, so pinning the
whole decomposition into its window would spend its context every turn on a document it
can only be distracted by — and would invite a dispatched implementer to go looking for
work other than the issue it was given.

Mechanically that is [module ownership](/gg/modules/#ownership) doing the work: every agent
in the run holds the one board, and an agent with no project-management capability holds it
**unowned** — live enough to be dispatched an issue from, invisible in its prompt. An agent
that *has* the capability can be put in the same position deliberately, by setting
`"ownership": "unowned"` on it: it keeps every board tool and loses both the per-turn cost of
carrying the whole decomposition and the prompt section describing it — worth having on a
board large enough that the block is the biggest thing in the window.

Forking or transferring the board never copies it. Two boards would each keep their own
per-prefix issue counter and would both hand out `AUTH-4`, for two different pieces of
work, in a run whose logs, briefs and agent names all quote that id — so a request to copy
the board gives a second handle on the same one.

## Auto-dispatch

The board **runs itself**. Submitting an issue **enqueues** it. Once every issue it
is blocked by is **Done**, gg **automatically spawns a dedicated top-level agent**
and assigns it the issue — the issue's structured fields become that agent's brief.
Agents do not hand issues to [subagents](/gg/subagents/) by hand; `spawn_subagent` is
for ad-hoc delegation only. Auto-spawned agents appear as **top-level** agents in the
Agents view, not under whoever filed the issue.

An issue moves through:

- **open** — enqueued, waiting on its blockers (or on scheduler capacity).
- **in_progress** — an agent has been spawned and assigned to it.
- **in_review** — its agent **finished**, and gg is reconciling it: running its
  reviewers and merging its work back. **Not** terminal, and **not** done — a review
  that requests changes sends the issue back to **in_progress**.
- **done** — accepted and merged, or **failed** — terminal but not done.

**An issue is finished exactly when the agent implementing it finishes.** There is no
"complete issue" tool: an agent that ended successfully has, by definition, said its
work is done, and how it says so is its own
[completion rule](/gg/completion/) — a plain-text reply, an explicit `finish` call, or
either of those gated behind validation commands. An assigned agent that ends any
other way — a spent turn ceiling, a breached [execution ceiling](/gg/execution-limits/), a model
error — has **not** finished, so gg **re-dispatches** the issue up to `maxRetries`
times (default 1) and then marks it **failed**. A failed issue is terminal but **not**
done, so its dependents **stay blocked** — the board surfaces the stall rather than
silently unblocking the work behind it.

## Every issue works in its own worktree

Issues run **concurrently**, so each one is isolated. gg makes the run's workspace a
git repository (committing a **baseline** of the seeded workspace if it is not one
already) and dispatches each issue's agent into a **fresh git worktree on its own
branch**, with every file and shell tool rooted there. Two issues can therefore edit
the same files at the same time without trampling one another.

The worktree belongs to the **issue**, not to one agent: a retry, and each review
round's rework pass, reuse it, so an attempt continues from what the last one
produced rather than starting over. When the issue is finally accepted its branch is
**merged back** into the main workspace and the worktree is torn down; an issue that
ends **failed** has its worktree discarded unmerged, so half-finished work never
lands. Every reconciliation is streamed as a `worktree_merged`
[telemetry](/gg/telemetry/) event.

### The merge agent

Because issues land in whatever order they finish, a merge that **conflicts** with
work another issue already landed is an ordinary event rather than an edge case.
Enabling the capability therefore **requires** naming a **`mergeAgent`**: the
[agent profile](/gg/configurations/#agents) gg dispatches — into the main workspace,
with the conflicted merge left in place — to resolve the conflict and finish the
merge. It must have the [shell](/gg/shell/) capability, since resolving a merge means
running `git`; a set that names no merge agent, names one that is not declared, or
names one without a shell is **refused at launch**.

gg does not take the merge agent's word for the outcome: the merge counts as resolved
only if git agrees it is no longer in progress. A merge the agent could not finish is
**aborted**, leaving the main workspace exactly as it was, and the issue is marked
**failed** rather than accepted — the board never claims work landed that did not.

## Assigning an issue

**Which agent works an issue is decided when the issue is filed**, not in the
configuration. `create_issue` takes a required **`agent`** naming the
[agent profile](/gg/configurations/#agents) gg dispatches it under, and an agent may
only name a profile its own [roster](/gg/configurations/#agents) lists with the
**implementer** scope. An agent can never put a worker to a task it was not given in
the first place. A call naming anything else is refused, and the refusal lists the
profiles that *are* assignable.

The consequence at authoring time: a configuration where an agent can **create**
issues but has **no implementer** on its roster is rejected at launch, because every
issue it could write would be refused. Give one of its roster entries the implementer
scope (a profile may list itself), or switch its issue-creation feature off for
read-only board access (below).

### An implementer does not need this capability

Authoring the board and **working an issue on it** are different jobs, so an
implementer profile is normally configured **without** project management — it has no
business filing epics. It needs no board tool to hand its work back either: it
finishes, and finishing is what completes the issue. An implementer without the
capability therefore gets **no** board tools, **no** [pinned board
block](#the-board-is-run-global-the-view-of-it-is-not) in its window, and no
board-authoring section in its prompt — only a section naming the issue it was dispatched
for and telling it that finishing is the hand-back.

That is deliberate. The alternative — a separate board move an implementer had to
remember — is a step it can forget, and forgetting it discarded the worktree and
re-dispatched the issue however good the work was.

## Reviewers gate acceptance

An issue may also name **`reviewers`** — profiles its filer's roster lists with the
**reviewer** scope. The two scopes are governed independently, so a profile trusted
to write code is not automatically trusted to review it.

An agent finishing is the **claim** that the work is done, not the acceptance. gg
moves the issue to **in_review**, and then:

1. runs the issue's reviewers **in turn** *inside the issue's own worktree*, each one
   shown the issue's brief, a **per-file summary of what changed** against the
   baseline, and **every verdict rendered so far** — so a re-review can tell whether
   its own earlier items were addressed, and a later reviewer knows what an earlier
   one already asked for;
2. on **changes requested**, re-invokes the issue's **own assigned agent** with the
   original brief plus the reviewer's actionable items, in the same worktree, and
   reviews again once it finishes. The first reviewer that does not approve ends the
   round, so a second opinion is never spent on work already known to need changes;
3. on **approval by every reviewer**, merges the worktree back and marks the issue
   **done**.

A reviewer is **not handed the patch**. Its working directory *is* the worktree the
work was done in — its filesystem tools and its shell are rooted there — so it reads
the files it cares about at the depth it needs, and (given a shell) can run
`git diff <baseline>` for the change itself. Pasting the whole diff into the brief
instead made every review prompt carry every generated file the work touched — a
regenerated lockfile alone can dwarf the code under review — spending the reviewer's
window on text it did not ask for and burying what mattered. What it gets is the
**map**: which files changed and by how much.

There is deliberately **no cycle limit** — a review that keeps finding real problems
should keep finding them — and a review round does **not** burn the issue's retry
budget, since rework a reviewer asked for is not a failed attempt.

The lifecycle is streamed as `issue_review` telemetry, carrying **who** said what: the
reviewer that ended a round by requesting changes (with its items) and the reviewers
that approved during it, each as the agent id *and* the profile it ran under. The
console's **Project** tab turns that into one `Review N` entry per round under the
issue, so a round's feedback stays readable after the issue has moved on.

An issue that names **no** reviewers is accepted as soon as its agent finishes, and
merged just the same.

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
| **Issue creation** | on | Off withholds `create_epic`/`create_issue`, leaving that agent **read-only** access to the board: it still sees the whole board in its context and can wait on issues — it just cannot file new work. |
| **Reviewers required** | off | On, `create_issue` **requires** one or more **`reviewers`**. Off, naming them is optional — either way, every reviewer an issue does name must approve before it is accepted. |
| **Revise the board** | on | Off withholds `update_issue`/`remove_epic`/`remove_issue`, so the board is append-only. |

## Tools & parameters

Board tools: `create_epic`, `create_issue`, `update_issue`, `set_issue_blocked_by`,
`remove_epic`, `remove_issue`, plus `wait_for_issue`. There is deliberately no
completion tool — see [auto-dispatch](#auto-dispatch).

`create_epic` takes a **`prefix`** (3–6 letters) rather than an id, and `create_issue`
takes **no id at all**: both ids are gg's to assign, and both calls report back the id
they were given.

| Param | Default | Meaning |
| --- | --- | --- |
| `mergeAgent` | — (**required**) | The shell-capable agent gg dispatches to resolve a conflicted merge of an accepted issue's worktree. |
| `maxEpics` | 50 | Maximum epics on the board. |
| `maxIssues` | 2000 | Maximum issues on the board. |
| `maxRetries` | 1 | Re-dispatches of a failed assignment before the issue is marked failed; may be 0 for no retry. A review round is not a retry. |
| `reviewers` | off | The **Reviewers required** feature above. |

Like every capability this one is **ablatable**: switched off, there are no board
tools and no auto-dispatch, and gg behaves as if the board does not exist.
