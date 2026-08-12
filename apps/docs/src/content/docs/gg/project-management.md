---
title: "Project management"
---

The project-management capability gives a run a single work board shared by
every agent in it. A board issue is the heavyweight counterpart to a per-agent
[task](/gg/tasks/): it is scoped well enough to hand to a fresh agent, and gg
dispatches it to one.

There is one board per run, and the run has it as soon as any agent profile
enables the capability. The board is retained across a
[compaction](/gg/compaction/) boundary verbatim, and its state is streamed to
the console as [telemetry](/gg/telemetry/overview/).

## Epics and issues

An epic groups related issues and has no behaviour of its own. It is created
from a prefix of three to six letters, upper-cased, and that prefix is its id.

An issue carries structured sections: a title, an optional description,
in-scope, out-of-scope, and completion criteria. Those sections become the brief
of the agent gg dispatches for it, so they state what that agent is responsible
for and how its work will be judged done. An issue also names the agent profile
it is assigned to and, optionally, the reviewers that must approve it.

Issues form a blocked-by DAG. An issue may be blocked by several others, and the
relation stays acyclic: gg rejects any edge that would introduce a cycle and
leaves the board unchanged.

## Identifiers

gg assigns every id. An issue's id is its epic's prefix plus the next number
under that prefix (`AUTH-1`, `AUTH-2`), and `ISSUE-1`, `ISSUE-2` for issues
filed under no epic. `create_epic` takes a prefix rather than an id, and
`create_issue` takes no id at all; both report back the id they were given.

The agents gg dispatches are named from the issue id in turn. The nth agent to
implement `AUTH-1` is `AUTH-1.0i`, `AUTH-1.1i`, and the reviewers of one
implementer's work are `AUTH-1.0i.0r`, `AUTH-1.0i.1r`. One name therefore
locates a piece of work, which attempt at it, and which review of that attempt,
which is what keeps a fleet of concurrent agents legible in the logs, the
telemetry, and the console's Agents tree.

## What each agent sees

The board is run-global; the view of it is per agent. The pinned board block
holds the whole decomposition, is rebuilt at every turn boundary, and is
retained across compaction. It is attached only to the window of an agent whose
own profile enables the capability. The prompt's board section is gated the same
way, so what an agent is told about the board agrees with what it is shown.

This is [module ownership](/gg/modules/) doing the work. Every agent in the run
holds the one board, and an agent without the capability holds it unowned: live
enough to be dispatched an issue from, and absent from its prompt. An agent that
has the capability can be put in the same position with `"ownership":
"unowned"`. It keeps every board tool and drops both the per-turn cost of
carrying the decomposition and the prompt section describing it, which is worth
having on a board large enough that the block is the biggest thing in the
window.

Forking or transferring the board hands over the same board. Two boards would
each keep their own per-prefix issue counter and would both hand out `AUTH-4`,
for two different pieces of work, in a run whose logs, briefs and agent names
all quote that id.

## Auto-dispatch

Submitting an issue enqueues it. Once every issue it is blocked by is done, gg
spawns a dedicated top-level agent and assigns it the issue, with the issue's
structured fields as that agent's brief. Auto-spawned agents appear as top-level
agents in the Agents view rather than under whoever filed the issue. Agents do
not hand issues to [subagents](/gg/subagents/); `spawn_subagent` is for ad-hoc
delegation.

An issue moves through four states:

- `open` — enqueued, waiting on its blockers or on scheduler capacity.
- `in_progress` — an agent is assigned to it.
- `in_review` — its agent finished and gg is reconciling it, running its
  reviewers and merging its work back. A review that requests changes sends the
  issue back to `in_progress`.
- `done` or `failed` — both terminal, and only `done` counts as finished work.

An issue is finished exactly when the agent implementing it finishes. There is
no completion tool: an agent that ended successfully has said its work is done,
and it says so with the [ending call](/gg/ending-a-session/) its role gives it,
subject to whatever [agent-stop hook](/gg/hooks/) the run declares.

An assigned agent that ends any other way leaves the issue unfinished, whether
it spent its turn ceiling, breached an [execution
ceiling](/gg/execution-limits/), or failed on a model error. gg re-dispatches
the issue up to `maxRetries` times and then marks it failed. A failed issue is
terminal without being done, so its dependents stay blocked and the board
surfaces the stall.

## Issue worktrees

Issues run concurrently, so each one is isolated. gg makes the run's workspace a
git repository, committing a baseline of the seeded workspace when it is not one
already, and dispatches each issue's agent into a fresh git worktree on its own
branch with every file and shell tool rooted there. Two issues can edit the same
files at the same time.

The worktree belongs to the issue rather than to one agent. A retry, and each
review round's rework pass, reuse it, so an attempt continues from what the last
one produced. When the issue is accepted its branch is merged back into the main
workspace and the worktree is torn down. An issue that ends failed has its
worktree discarded unmerged. Every reconciliation is streamed as a
`worktree_merged` telemetry event.

### The merge agent

Issues land in whatever order they finish, so a merge that conflicts with work
another issue already landed is an ordinary event. Enabling the capability
requires naming a `mergeAgent`: the agent profile gg dispatches into the main
workspace, with the conflicted merge left in place, to resolve the conflict and
finish the merge. It must have the [shell](/gg/shell/) capability, since
resolving a merge means running `git`. A set that names no merge agent, names
one that is not declared, or names one without a shell is refused at launch.

The merge counts as resolved only when git agrees it is no longer in progress. A
merge the agent could not finish is aborted, leaving the main workspace exactly
as it was, and the issue is marked failed rather than accepted.

## Assigning an issue

Which agent works an issue is decided when the issue is filed. `create_issue`
takes a required `agent` naming the [agent profile](/gg/configurations/) gg
dispatches it under, and an agent may only name a profile its own roster lists
with the implementer scope. A call naming anything else is refused, and the
refusal lists the profiles that are assignable.

Two configurations are therefore rejected at launch: an agent that can create
issues but lists no implementer on its roster, and an agent that must name
reviewers but lists none with the reviewer scope. Every issue such an agent
could file would be refused. Give one of its roster entries the missing scope (a
profile may list itself), or switch the corresponding feature off.

### Implementer profiles

Authoring the board and working an issue on it are different jobs, so an
implementer profile is normally configured without project management. It needs
no board tool to hand its work back: it finishes, and finishing is what
completes the issue. Its window carries no pinned board block, and its prompt
carries one board-related section, naming the issue it was dispatched for and
stating that finishing is the hand-back.

## Reviewers

An issue may also name `reviewers`, profiles its filer's roster lists with the
reviewer scope. The implementer and reviewer scopes are governed independently,
so a profile trusted to write code is not automatically trusted to review it.

An agent finishing is the claim that the work is done. gg moves the issue to
`in_review`, and then:

1. Runs the issue's reviewers in turn inside the issue's own worktree. Each is
   shown the issue's brief, a per-file summary of what changed against the
   baseline, and every verdict rendered so far, so a re-review can tell whether
   its own earlier items were addressed and a later reviewer knows what an
   earlier one asked for.
2. On changes requested, re-invokes the issue's own assigned agent with the
   original brief plus the reviewer's actionable items, in the same worktree,
   and reviews again once it finishes. The first reviewer that does not approve
   ends the round, so a second opinion is never spent on work already known to
   need changes.
3. On approval by every reviewer, merges the worktree back and marks the issue
   done.

A reviewer's working directory is the worktree the work was done in. Its
filesystem tools and its shell are rooted there, so it reads the files it cares
about at the depth it needs and, given a shell, can run `git diff` against the
baseline for the change itself. What the brief carries is the map of which files
changed and by how much.

Review rounds have no cycle limit, and a review round leaves the issue's retry
budget untouched, since rework a reviewer asked for is not a failed attempt. A
review gg could not conduct, because a reviewer would not dispatch or ended
without a verdict, marks the issue failed. Work no reviewer approved is never
accepted.

The lifecycle is streamed as `issue_review` telemetry carrying who said what:
the reviewer that ended a round by requesting changes, with its items, and the
reviewers that approved during it, each as the agent id and the profile it ran
under. The console's Project tab renders one `Review N` entry per round under
the issue.

An issue that names no reviewers is accepted as soon as its agent finishes, and
merged just the same.

## Waiting on an issue

`wait_for_issue` takes an issue id and suspends the calling agent until that
issue reaches a terminal state, then resumes it and reports whether the issue is
done or failed. An id the board does not carry is an error, and an issue that is
already terminal returns immediately. An agent may not wait on the issue it was
assigned to implement.

A suspended agent releases its running slot, so a waiting agent holds no
scheduler capacity; see [scheduling](/gg/subagents/) for the slot discipline.
The blocked-by DAG and `wait_for_issue` come with the capability and are
available wherever it is.

## Features

Three sliders sit in the capability's Features box, and each is per agent.

| Feature | Default | What switching it changes |
| --- | --- | --- |
| Issue creation | on | Off withholds `create_epic`/`create_issue`, leaving that agent read-only access to the board: it still sees the whole board and can wait on issues. |
| Reviewers required | off | On, `create_issue` requires one or more `reviewers`. Off, naming them is optional. Either way, every reviewer an issue names must approve it before it is accepted. |
| Revise the board | on | Off withholds `update_issue`/`remove_epic`/`remove_issue`, so the board is append-only. |

## Tools and parameters

Board tools: `create_epic`, `create_issue`, `update_issue`,
`set_issue_blocked_by`, `remove_epic`, `remove_issue`, and `wait_for_issue`.

| Param | Default | Meaning |
| --- | --- | --- |
| `mergeAgent` | required | The shell-capable agent gg dispatches to resolve a conflicted merge of an accepted issue's worktree. |
| `maxEpics` | 50 | Maximum epics on the board. |
| `maxIssues` | 2000 | Maximum issues on the board. |
| `maxRetries` | 1 | Re-dispatches of a failed assignment before the issue is marked failed; may be 0 for one attempt only. A review round is not a retry. |
| `reviewers` | off | The Reviewers required feature above. |
| `ownership` | `owned` | `unowned` keeps the board tools and drops the pinned block and the prompt section. |

Like every capability this one is ablatable. Switched off, there are no board
tools, no prompt text, no context block, no board telemetry, and no
auto-dispatch.
