---
title: "Parity capabilities"
---

These are the capabilities gg needs to be a **credible** harness — the ones
the better third-party harnesses already have. gg must match them before its
[experimental capabilities](/gg/experiments/) can be evaluated fairly:
if gg loses to Claude Code, we need to know it is the *experiments* that made
the difference, not a missing table-stakes feature.

Each capability below is a module in the sense described in
[Capabilities & run configuration](/gg/capabilities/) — independently
toggleable, and (for the ones worth studying) potentially swappable.

## Compaction

When a thread approaches the active model's context-window limit, gg
**summarizes the thread and restarts it from the summary**, so the model can keep
working "beyond" its context window.

Requirements:

- Trigger when the thread nears the **active model's** window (the threshold is a
  capability parameter, not a constant — and note that with
  [multi-model](/gg/experiments/#multi-model) different agents have
  different window sizes).
- Produce a summary that preserves enough working state for the model to continue
  without losing the thread of what it was doing.
- **Preserve pinned state across the boundary.** Compaction is not just
  summarization — several other capabilities have state that must *survive*
  compaction verbatim rather than be summarized away:
  [tasks](#tasks--todo), the contents of read [skills](#skills), and
  [memories](#memories). Compaction is the capability that makes "retained across
  compaction" mean something.

Compaction is a prime candidate for a **swappable summarization tool** so we can
study which strategy retains the most useful state.

Compaction summarizes the *history* and carries the following state forward
verbatim, forming the fixed prefix of the post-compaction context window:

- **Skills** — the list of available skills, plus the full contents of any skills
  that have been **read**.
- **Tasks** — the active [tasks](#tasks--todo) list.
- **Memories** — the same treatment as skills: the list, plus the contents of
  those in play.

## Tasks / TODO

A list of items representing work the model wants to do — the standard
lightweight agent to-do list, with two hard requirements:

- **It is a DAG.** An item can be marked **blocked by** one or more other items,
  and the blocking relation must be acyclic — gg must reject an edge that
  would introduce a cycle.
- **It survives compaction.** The task list is carried across a
  [compaction](#compaction) boundary verbatim, so the model never loses its plan
  just because it ran long.

The tasks capability is the lightweight tier of work tracking. Its heavyweight
counterpart — [epics & issues](/gg/experiments/#epics--issues) — is an
experimental expansion of the same idea; the two share the blocked-by DAG
concept.

## Skills

Skills are **markdown files with front matter**. At the start of a session, the
model is shown each skill's **description** (from its front matter), so it knows
the skill exists and what it is for.

The one behavioral difference between reading a skill and reading a plain file:

- Reading a skill **strips the front matter** and returns the body, and
- the skill's contents are **automatically retained after compaction** — a skill,
  once read, stays in context across a [compaction](#compaction) boundary, unlike
  an ordinary file view (which the model may have to re-read, or which
  [agent-managed context](/gg/experiments/#agent-managed-context-windows)
  may evict).

This mirrors the skills mechanism used elsewhere in this repository (the
`.claude/skills/` skills that guide agents working in this repo), reframed as a
capability gg offers the *model under test*.

## Memories

Memories are **essentially the same as skills** — description shown up front,
body retained across compaction — with one difference: they are **curated by the
model itself** rather than authored ahead of time. The model writes and updates
its own memories as it works.

Because the model controls them, gg must **bound them**:

- a cap on the **number** of memories, and
- a cap on their **length** (individually and/or in aggregate),

so that self-curated memory cannot crowd out the working context. When a cap is
hit, the model must revise or evict rather than simply accrue.

This is deliberately analogous to how The Test Cabinet's own agent memory works
(one fact per file, with an index) — gg gives the *model under test* the same
affordance.

## Subagents

The largest parity capability. An agent must be able to **spawn other agents**,
and then either work **in parallel** with them or **block** until they return.

Requirements:

- **Recursion.** Subagents can spawn their own subagents, up to a **maximum
  depth**; a spawn that would exceed the depth limit is refused rather than
  queued.
- **Bounded parallelism.** Unbounded fan-out would melt the run, so a **scheduler**
  enforces a global cap on how many agents run at once; a spawn beyond the cap
  **blocks until a slot frees** (see [scheduling](#scheduling) below) rather than
  running immediately.
- **Return values.** A subagent can **return information** to the agent that
  spawned it.
- **Messaging.** A parent agent can **send a message to** a running subagent (not
  only spawn-and-wait) — so the relationship is a live channel, not a one-shot
  call.

The agent tree this produces — who spawned whom, who is running versus blocked —
is exactly what the [improved telemetry](/gg/experiments/#improved-telemetry)
capability streams to the console for live visualization. Subagents also underpin
[workflows](#workflows), issue dispatch, and [Code Reviews](/gg/experiments/#code-reviews).

### Scheduling

The scheduler is intentionally simple:

- **A single global parallelism cap** (not per-level). A newly spawned subagent
  **blocks until a slot frees up**, and slots are granted **first-come,
  first-served**.
- **A blocked agent frees its slot.** When an agent blocks waiting on its
  subagents, it releases its slot so other work can run — but it retains
  **priority over not-yet-started agents** for the next free slot. A blocked agent
  **cannot be resumed until its wait condition is met**, even once a slot is
  available.

Subagents may run on a different
[model slot](/gg/capabilities/#model-slots) than their parent; that is
orthogonal to the parallelism cap, which counts running agents regardless of
slot.

## Workflows

Workflows are an **alternative to ad-hoc subagents**: effectively **subagent
fan-outs plus sequencing**. Where raw subagents are imperative ("spawn these,
wait, spawn more"), a workflow is a declared structure of stages, each stage
fanning work out across agents and feeding into the next.

Requirements:

- Express **fan-out** (run N agents over N items) and **sequencing** (stage A's
  results feed stage B) as a single declared unit.
- Reuse the same [subagent](#subagents) scheduler and its parallelism/depth caps.

Workflows are the deterministic, structured cousin of subagents;
[FSM-driven processes](/gg/experiments/#fsm-driven-processes) push this
further into predetermined control flow.

## Planning

A **read-only planning pass** followed by a **fresh-context implementation pass**:

1. Put an agent into **read-only mode** (it can explore and read but not mutate
   the workspace).
2. Have it produce a **plan**.
3. **Clear the context**, then hand the agent the **original prompt plus the
   plan** and let it implement from a clean context window.

The value is that implementation starts from a compact, deliberate plan rather
than from a context window already cluttered with exploration. Planning is a
strong candidate for offering a **different planning tool** — different planning
prompts and structures are exactly the kind of thing gg exists to compare.

Planning is available two ways. It can be driven as an
[FSM](/gg/experiments/#fsm-driven-processes) — the two states being
"plan (read-only)" → "implement (fresh context)". It must **also** be reachable as
a **tool**: an agent that started *not* in plan mode can decide, mid-session, to
**enter plan mode**. So planning is both a predetermined process an agent is
driven through and an action an agent can elect.

## Worktrees

A [subagent](#subagents) — whether spawned directly or as part of a
[workflow](#workflows) — can run in a **git worktree** instead of the main
workspace tree. Some third-party harnesses already support this, so it counts as
parity.

The worktree gives an agent an **isolated copy of the workspace** to mutate, so
several agents can work in parallel without trampling one another's edits, and the
result is merged back (or discarded) deliberately rather than racing on shared
files. Whether a spawned agent runs in the main tree or a fresh worktree is a
property of how it is dispatched.
