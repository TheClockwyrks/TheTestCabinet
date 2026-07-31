---
title: "Agent persistence"
---

Every gg agent is normally **disposable**. A profile is a template: gg instantiates it
whenever work needs doing — a `spawn_subagent` call, an [issue](/gg/project-management/)
dispatch, a review round, a retry — and each instance opens on an empty desk, does its job,
and is gone. Two instances of the same profile can be working at the same moment, in
different [worktrees](/gg/project-management/), knowing nothing about each other.

**Agent persistence** makes one profile the opposite: a single long-lived worker with a
desk it comes back to. Turning it on changes exactly two things about every instance of that
profile.

## One instance at a time

The profile's parallelism is capped at **one**, run-wide. Spawn three instances of it and all
three are created normally — nothing is refused — but only one **runs** at a time; the others
queue on the same [scheduler](/gg/subagents/#scheduling) every other agent waits on. This
holds regardless of which worktree each instance was dispatched into, and regardless of the
run's own [`maxParallel`](/gg/execution-limits/#parallelism): the cap is *within* that pool,
not beside it. A run with a pool of sixteen and one persistent profile can have fifteen other
agents running alongside its single instance.

An instance that **suspends** itself — blocking on its subagents, or on an issue — is not
running, so it releases the profile to the next queued instance and re-takes it when it
resumes. That is what keeps a persistent agent that waits on a child of its own profile from
deadlocking against itself.

## The open files carry over

When an instance **finishes its work successfully**, gg records the set of
[file views](/gg/context-visibility/) it still had open: each path, plus the lines a paged read
covered. The next instance of the profile re-opens exactly those views as the first thing in its
window, before its first turn.

A file the agent read in **several windows** is several views, and every one of them comes back
over its own lines — the desk is a list of `(path, region)` pairs, not a set of paths, so an agent
working a large file through a capped [read mode](/gg/filesystem/#read-modes) does not come back to
only its first or last page. The region recorded is the window the read **returned**, not the one
the call asked for: under an unlimited read mode `offset`/`limit` are not part of `read_file`'s
schema and the whole file comes back, and a `limit` above a hard cap is reduced to it. Recording
the ask instead would give a view a window it never had.

What is recorded is the **reference** to each read, never the bytes it returned. The next
instance re-reads each file from the workspace, so it opens on what the files say *now*:

```
instance 1   read_file src/game.js  →  // the first draft
             finish                     ← desk recorded: [src/game.js]

             (someone else rewrites src/game.js)

instance 2   opening window already holds
             read_file src/game.js  →  // rewritten by someone else
```

Replaying the stored text instead would be worse than nothing. A queued instance may wait a
long time behind the one ahead of it, and the instance ahead of it is very often editing the
exact files in question — so a replay would hand the next instance a confident, wrong picture
of the workspace. This is also why the re-read happens when the instance **starts its first
turn** rather than when it was spawned: a spawn-time snapshot would be stale by the time the
instance actually ran.

The re-opened views are ordinary, matched `read_file` call/result pairs — the same shape
[autoload-specifications](/gg/autoload-specifications/) uses — so the model can act on them
directly, they show up in the **file** band of the [context breakdown](/gg/context-visibility/),
and they are ephemeral working material that [compaction](/gg/compaction/) may summarize and
[agent-managed context](/gg/agent-managed-context/) may evict. Each is read through the
profile's own `read_file` [line cap](/gg/filesystem/#read-modes), and a paged view is re-read
over the region it covered rather than from the top of the file.

The agent is told all of this in its [system prompt](/gg/prompts/), because it has to be: reads
it never made, sitting at the top of a fresh session, are otherwise indistinguishable from a
hallucination.

### What "still had open" means

The desk is whatever file views are in the window at the moment the agent finishes — so the
capability composes with the rest of the context machinery rather than fighting it:

- A file the agent **evicted**, or that a compaction **summarized away**, is not open, so it
  is not carried over. Recording is a wholesale replacement, not a union: the desk as the last
  instance left it, including an instance that finished with nothing open.
- A **locked** [autoloaded specification](/gg/autoload-specifications/) is not carried over
  either — autoload re-seeds and re-pins it for the next instance, and persisting it as an
  ordinary evictable read would give the same file two entries.
- A path that is **already open** when the restore runs is not opened twice — and since the only
  thing that can have opened one that early is [autoload](/gg/autoload-specifications/), which reads
  whole files, that view is a superset of any window of it the desk held.
- A file that can no longer be read — deleted, renamed, or moved since it was recorded — is
  skipped with a warning. The desk it was on is gone, which is a normal thing to come back to.

### Only on success

The record is written **only** when an instance ends by signalling it is done (and passing
whatever [completion](/gg/completion/) gate the profile sets). An instance stopped by an
[execution ceiling](/gg/execution-limits/), or by an error, leaves the previous instance's
record standing — the desk of an agent that was cut off mid-thought is not a useful thing to
inherit, and overwriting a good one with it would lose the profile's place.

An instance that [handed itself on](/gg/fork-and-exec/) — an `exec`, or an
[FSM transition](/gg/fsms/) — records nothing either, for the same reason: it did not finish,
it became something else, and it took its open views with it in the window it transferred.
What that succession *does* do is exchange the exclusivity it holds. The one-at-a-time cap is
keyed on the profile, and a successor runs a different one, so gg swaps the key without
releasing the slot — blocking through the ordinary scheduler machinery if the profile the
successor is moving into is already held by somebody else.

## What is not persisted

Only file views. Not the thread, not the [task list](/gg/tasks/), not
[memories](/gg/memories/), not read [skills](/gg/skills/). Two instances of a profile are two
separate agents that happen to share a desk, and an instance that inherited the previous one's
whole conversation would be one long agent with a confusing turn count. Memories already exist
for state a profile wants to *narrate* across sessions — a persistent profile with
`"scope": "shared"` [memories](/gg/memories/#scoping-whose-memories-are-these) gets both, which
is the interesting configuration. Persistence answers the narrower question of **which files
the worker was looking at**.

Carrying a whole conversation forward is a different feature with different mechanics:
[`exec`](/gg/fork-and-exec/) and an [FSM transition](/gg/fsms/) transfer live
[modules](/gg/modules/) between two incarnations of **one** agent — one slot, one return value,
one continuous turn count — rather than between two instances that each stand on their own.

A [responses-as-code](/gg/responses-as-code/) agent puts no file view in its window at all
(a program's reads are consumed inside the program, which is one of the reasons that mode
exists), so a persistent code-mode profile records and restores nothing. Its
one-instance-at-a-time half still applies.

## Configuring it

It is off by default, and per agent — one profile's
[capability](/gg/configurations/#agents), with no params:

```jsonc
{
  "name": "Owner",
  "capabilities": [
    { "id": "agent-persistence", "enabled": true },
    { "id": "read-file", "enabled": true },
    { "id": "shell", "enabled": true }
  ]
}
```

In the console it is a switch in the **Delegation** group of the
[configuration](/gg/configurations/) editor.

Turning it on and off is a clean experiment, and two different ones at once — *does a
serialized owner of a subsystem beat a swarm of interchangeable workers?* and *does an agent
that comes back to its own files spend fewer turns re-discovering them?* — which is the kind
of question gg exists to answer. The natural shape for it is a profile that owns something: a
single reviewer that sees every issue in turn, or one implementer that owns a subsystem across
many issues, alongside a parallel fleet doing everything else.
