---
title: "Agent persistence"
---

An agent profile is a template. gg instantiates it whenever work needs doing: a
spawn, an [issue](/gg/project-management/) dispatch, a review round, a retry.
Each instance opens on an empty desk, does its job, and is gone. Two
instances of one profile can run at the same moment in different worktrees,
knowing nothing about each other.

The `agent-persistence` capability makes one profile a single long-lived worker.
It changes two things about every instance of that profile: one instance runs at
a time, and each opens on the views the previous one left open.

## One instance at a time

Every instance of a persistent profile takes its running slot under the
profile's [id](/gg/configurations/#identity), and no two running agents may hold
one id at once. Spawning three instances creates all three; one runs and the
others queue on the [scheduler](/gg/subagents/) every other agent waits on. The
key is the profile, so the cap holds however an instance was dispatched and
whichever worktree it was dispatched into.

The cap applies inside the run's global parallelism pool rather than beside it.
A run whose [`maxParallel`](/gg/execution-limits/) is sixteen can have fifteen
other agents running alongside a persistent profile's single instance.

An instance that suspends itself, blocking on its subagents or on an issue,
releases its slot and its key, and re-takes both when it resumes. A persistent
agent waiting on a child of its own profile therefore cannot deadlock against
itself.

## The desk

When an instance ends by finishing its work, gg records the views it still had
open against its profile, replacing whatever that profile had recorded before.
The next instance re-opens them before its first turn, in order: file views,
then text views, then documentation views.

| View | Recorded as | Restored by |
| --- | --- | --- |
| File | the path and the line region the read covered | re-reading the file from the workspace |
| Text | the label and the body | handing the body back verbatim |
| Documentation | the key | rendering the key again for this instance's scope |

Text and documentation views are opened by
[responses-as-code](/gg/responses-as-code/overview/) calls, so only a code-mode
profile has those two parts of a desk.

### File views

What is recorded for a file is the reference to the read, never the bytes it
returned. An instance may sit queued for a long time behind the one ahead of it,
and the instance ahead of it is often editing the exact files in question.
Re-reading hands the arriving instance the workspace as it stands when it starts
work, so the restore runs at the top of its turn loop rather than at spawn time.

A file read in several windows is several views, and each comes back over its
own lines: the desk is a list of path-and-region pairs rather than a set of
paths. The region recorded is the window the read returned, which is what a run's
[read mode](/gg/filesystem/) may have reduced the requested window to.

Two file views are skipped rather than restored:

- A path already open when the restore runs. The only thing that opens one that
  early is [autoload](/gg/autoload-specifications/), which reads whole files.
- A file that can no longer be read. gg logs a warning and carries on.

### Text views

A text view is material the agent composed, such as a summary, a diff or a
table. The window is its only copy, so the body is the record. Opening a label
that is already open supersedes it, which makes this half of the restore
idempotent, and handing a string back has nothing in it that can fail.

### Documentation views

A documentation view is recorded as its key and rendered again through the
arriving instance's own documentation runtime, which answers for that instance's
scope. A key whose function this instance does not bind renders nothing and is
skipped, so a desk never restores documentation for a call its holder cannot
make.

### How restored views arrive

Restored views are synthesized in the shape the profile's execution mode
produces. A tool-calling profile gets matched `read_file` call and result pairs.
A code-mode profile gets one program per restored file view, spelled as the call
that would have opened it:

```ts
import * as gg from "gg";

gg.views.openFile("src/main.rs", { offset: 40, limit: 120 });
```

Either way the model can act on them directly, they land in the file band of the
[context breakdown](/gg/context-visibility/), and they are ephemeral working
material that [compaction](/gg/compaction/) may summarize and
[agent-managed context](/gg/agent-managed-context/) may evict. gg logs one line
naming how many views of each kind came back and by which mechanism.

## What counts as open

The desk is whatever is in the window at the moment the agent finishes, so
persistence composes with the rest of the context machinery.

- A file the agent evicted, a text view it closed, and anything a compaction
  summarized away are not open, so they are not carried over. Recording replaces
  a profile's whole record, so an instance that finishes with nothing open
  clears it.
- A [compaction](/gg/compaction/) drops text views, and so empties that part of a
  desk. Anything durable belongs in a memory or a file.
- A locked [autoloaded specification](/gg/autoload-specifications/) is pinned
  rather than open. Autoload re-seeds and re-pins it for the next instance.

## When a desk is recorded

A desk is recorded only when an instance ends by signalling it is done and
passes whatever [agent-stop](/gg/hooks/) gate the run declares. An instance
stopped by an [execution ceiling](/gg/execution-limits/) or by an error leaves
the previous instance's record standing.

An instance that [handed itself on](/gg/fork-and-exec/) through an `exec` or an
[FSM transition](/gg/fsms/) records nothing either: it took its open views with
it in the window it transferred. A successor opening on a carried thread
restores no desk, for the same reason.

What a succession does do is exchange the exclusivity key. The key is the
profile's, and a successor runs a different profile, so gg swaps the key without
releasing the running slot, blocking through the scheduler when the profile the
successor moves into is already held.

## What is not persisted

Only the open views. The thread, the [task list](/gg/tasks/),
[memories](/gg/memories/) and used [skills](/gg/skills/) all start as they do
for any new agent. An instance opens with nothing loaded, so it holds none of
the documentation views a used skill's module opened. Two instances of a
profile are two separate agents that share a desk.

Memories cover state a profile wants to narrate across sessions, and a
persistent profile with `"scope": "shared"` [memories](/gg/memories/) gets both.
Carrying a whole conversation forward is [`exec`](/gg/fork-and-exec/) and an
[FSM transition](/gg/fsms/), which move live [modules](/gg/modules/) between two
incarnations of one agent.

## Configuring it

The capability is per agent, off by default, and takes no params:

```jsonc
{
  "id": "owner",
  "name": "Owner",
  "capabilities": [
    { "id": "agent-persistence", "enabled": true },
    { "id": "read-file", "enabled": true },
    { "id": "shell", "enabled": true }
  ]
}
```

In the console it is a switch in the Delegation group of the
[configuration](/gg/configurations/) editor.

The shape it suits is a profile that owns something: one reviewer that sees every
issue in turn, or one implementer that owns a subsystem across many issues,
alongside a parallel fleet doing everything else.
