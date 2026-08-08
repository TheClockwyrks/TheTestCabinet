---
title: "Skills"
---

A skill is a **named, described piece of knowledge the agent can reach for by name**. Every
skill the agent has is listed in its [system prompt](/gg/prompts/) — name and one-line
description — so it knows what exists and when to reach for one, and it reads the one it
wants with `read_skill` (`skills.readSkill` under
[responses-as-code](/gg/responses-as-code/)).

What a skill *is* has two halves, and a skill may carry either or both:

- **prose** — a markdown body which, once read, is **retained across a
  [compaction](/gg/compaction/) boundary**, unlike an ordinary file view (which the model
  may have to re-read, or which [agent-managed context](/gg/agent-managed-context/) may
  evict); and
- **code** — a TypeScript module bound into every program the agent writes from then on,
  and/or a script gg runs once when the skill is first used. Both are
  responses-as-code only; see [below](#code-skills).

This mirrors the skills mechanism used elsewhere in this repository (the
`.claude/skills/` skills that guide agents working in this repo), reframed as a
capability gg offers the *model under test*. [Memories](/gg/memories/) are the same
mechanism, curated by the model itself.

## The two file shapes

Skills are loaded once, at launch, from the run's skills directory — `.gg/skills` under the
workspace by default, or wherever the capability's `dir` param points (a relative path is
joined onto the workspace; an absolute one is used as-is). Each entry in that directory is
one of two shapes:

```text
.gg/skills/
  release-checklist.md      a prose skill
  csv-tools/                a skill directory
    skill.md                required — front matter, and optionally a body
    skill.ts                optional — the module the agent's programs can call
    on-use.ts               optional — the script gg runs when the skill is first read
```

The two code files are named for the **program language** they are written in — `skill.ts`
and `on-use.ts` for a TypeScript agent, `skill.py` and `on-use.py` for a Python one. A
directory may carry several, and it needs to: a [program's language](/gg/program-languages/)
is resolved **per agent**, so one run can drive two agents that could not evaluate each
other's modules. Each agent reads the spelling its own language names, and the prose half —
`skill.md` — is the same text for all of them.

Where two languages share one module runtime, each accepts the other's spelling and merely
prefers its own: a `skill.ts` reaches a JavaScript agent too, because those two arms differ
in whether a program is type-checked and a skill present on one and absent on the other
would be a much larger difference than the one they exist to measure.

A skill whose code is spelled in no language the reading agent writes is read as **prose**:
the body arrives as it always does, nothing is bound, and the *operator* is told (the model
is not — which languages a directory was authored for is not the agent's business, and
naming them would vary a prompt between arms).

- **`<name>.md`** — a prose skill. A small YAML front-matter block naming it
  (`name`, `description`), then the body. Exactly what a skill has always been, and still
  the right shape for a skill that is only guidance.
- **`<name>/`** — a **skill directory**, which is how a skill carries code. `skill.md` is
  **required**, because the name and the description are what the catalogue is made of; a
  directory without one is not a skill and is ignored rather than named after its folder. A
  body in it is optional, so a skill may be pure code.

Reading a skill differs from reading a plain file in two ways: it **strips the front
matter** and returns only the body, and that body is added to the window as a
`Skill`-sourced, **pinned** item, so the [context accounting](/gg/context-visibility/)
attributes it to skills and compaction carries it across the boundary verbatim. Reading the
same skill twice does not pin a second copy.

## Code skills

A skill's `skill.<ext>` and `on-use.<ext>` are **[responses-as-code](/gg/responses-as-code/)
only**. A run under native tool calling sees the prose half of a skill and nothing else:
there are no programs for a module to be bound into, so gg does not pretend otherwise by
showing the model source it cannot call.

### Code the agent's programs can call

Reading a code skill binds its exports at **`lib.<key>`** in every program the agent writes
from then on. The key is the skill's name in that language's own convention (`csv-tools` →
`lib.csvTools`, or `lib::csv_tools` on
[Rust](/gg/program-languages/#rust-the-program-is-the-artifact), where an API object is a
module), deduplicated with a numeric suffix if something else already claimed it. On the
three compiled arms the binding is **linked** rather than looked up, so a key or a name that
does not exist is a diagnostic on the turn that wrote it: Rust declares each module as a
`mod`, [Swift](/gg/program-languages/#what-a-swift-code-module-is) moves each of its
top-level declarations into a nested `enum` where they stand, which is what keeps the
author's argument labels and default values at the call site, and
[C++](/gg/program-languages/#what-a-c-code-module-is) opens a real nested namespace around
the author's whole file, which keeps every default argument and template for the same
reason, and
[C#](/gg/program-languages/#a-code-module-is-a-static-class-because-c-has-no-free-functions)
makes each module the body of a `static class` — because C# has no free functions at all, so
`lib.<key>` has to name a *type* and its key is spelled `PascalCase` here and nowhere else.
And **the
reply to the read states the key it really got, in the reader's own syntax, and what it
exports**, because a binding path a model has to guess is a binding path it will guess
wrong:

```text
---
The code this skill carries is loaded: call it as `lib.csvTools.<name>`. It exports:
parseCsv, toRows. It stays bound for the rest of your session, including across a
compaction.
```

What a module may contain, what it exports, and what it is refused for are one shared rule
across skills and memories, documented under
[responses-as-code](/gg/responses-as-code/#lib-code-the-agent-loaded). The short version: a
module exports what it `export`s, a file with no `export` at all exports everything it
declares, and there is no `import` — a module is evaluated against the same scope a program
gets, so it may call `fs.readFile` or `system.shell` like anything else.

Loaded code is **not context**. It costs no tokens, is never summarized, and a compaction
boundary does not touch it: re-reading a skill to get your helpers back after a compaction
would be friction with nothing on the other side of it. What it does *not* survive is a
change of agent — a [`fork`](/gg/fork-and-exec/) or a succession starts with nothing bound,
because the registry is per agent instance, and reading the skill again is what reloads it.

### An on-use script that runs once

An on-use script is how a skill *shows* the agent something rather than telling it. It runs
**once per agent**, on the read that first brings the skill into use, and it is deferred:
gg runs it **after the turn's program has ended**, so whatever
[views](/gg/responses-as-code/#showing-yourself-things) it opens arrive in the agent's
**next** prompt. Deferring is not a compromise — a read reaches gg from inside a call the
running program is still in the middle of, and arriving in the next prompt is what every
view does anyway.

Three rules bound it, and each is the same statement from a different side: an on-use script
is **not the agent's turn**.

- It **cannot end the session**. No `finish` and no `approve` is bound.
- It has **no [program library](/gg/program-library/)** — a skill handing gg a replacement
  program would be a skill rewriting the model's turn.
- It sees **its own module and no other**. It runs at a moment the agent did not choose, so
  letting it reach whatever else happened to be loaded would make its behaviour depend on
  the order the agent read things in.

Its **source is never shown to the model**, on any path. If it fails, the model is told one
sentence naming the skill and what went wrong — an accusation about code it cannot see would
be worse than useless — and the turn's own outcome is untouched: the model's program
succeeded or failed on its own merits, whatever a skill's script then did.

Neither half can break a read. A skill whose module or on-use script does not compile is
still **read**: the body is what the model asked for, and the diagnostic is appended to it
rather than replacing it. And a skill whose *compiler could not finish* — a crash, a
timeout, a toolchain missing from the image — is not reported as a skill that failed to
compile: the model is told the code was not compiled and that nothing about it was rejected,
and the compiler's own crash detail goes to the operator instead. It is the same split
[a turn's own program](/gg/program-languages/#a-compiler-has-two-ways-to-fail) gets, for the
same reason.

## The skills gg ships

gg writes **eleven skills of its own**, one per family of the functions it offers, so the
capability is worth enabling in a workspace that authored none — which is almost all of
them. Before them, a run that had not thought to fill a skills directory got a mechanism
with nothing in it.

| Skill | Family |
| --- | --- |
| `gg-filesystem` | Reading, writing and editing files in the workspace. |
| `gg-shell` | Running shell commands in the workspace. |
| `gg-project` | The [epic/issue board](/gg/project-management/). |
| `gg-tasks` | The agent's own blocked-by [task list](/gg/tasks/). |
| `gg-memory` | Durable [memories](/gg/memories/). |
| `gg-skills` | Reading skills — including this one. |
| `gg-context` | [Managing its own window](/gg/agent-managed-context/): evicting, archiving, searching, compacting. |
| `gg-delegation` | [Delegating](/gg/subagents/) work to child agents, and [handing its session on](/gg/fork-and-exec/). |
| `gg-views` | [Showing itself](/gg/responses-as-code/#showing-yourself-things) a file, a value, or a function's documentation. |
| `gg-programs` | [Fetching a program it already ran](/gg/program-library/), and handing a patched copy back. |
| `gg-session` | [Ending its session](/gg/ending-a-session/#ending-calls) — the one call that does. |

Three properties are what make them safe to ship:

- **Generated, never written.** Not one word of a built-in's content is prose kept
  somewhere it could drift from the thing it describes. Under native tool calling the body
  is built from the agent's **live tool definitions** — each tool's real name, description
  and top-level parameters. Under responses-as-code the body is empty and the skill carries
  an **on-use script** that opens one `view.openDocsView` per function in the family, which
  routes through the same documentation lookup the model could have called itself. A
  built-in carries **no importable code** either way: it is a manual, not a library.
- **A family is offered only when the agent has at least one of its functions.** A skill
  that described a tool this run withheld would be the one thing a catalogue must never do.
  The last three families exist only under responses-as-code, because `view`, `programs`
  and the ending calls are not gg tools at all.
- **An authored skill of the same name wins.** A workspace that writes its own
  `gg-filesystem` means to replace gg's, and a run in which both existed would put two lines
  with one name in the catalogue.

They are selected per agent with the skills capability's **`builtIns`** param, which — like
every toggle set in gg — records only the ones switched **off**, so an unconfigured run gets
all of them:

```json
{
  "id": "skills",
  "enabled": true,
  "params": { "builtIns": { "gg-memory": false, "gg-context": false } }
}
```

Switching one off withholds the manual, not the functions: the family still works, the agent
is simply not handed a description of it. That is what makes "does an agent use this
capability well when nobody explains it?" an arm a study can actually run.

Because the built-ins are resolved against **this agent's** toolset, two agents in one run
hold catalogues that agree about every authored skill and differ exactly where their
capabilities do. They are also why the capability is worth enabling at all in a workspace
with no skills directory: with no authored skills and no built-ins there is nothing to read,
and gg offers no `read_skill` tool.

## The catalogue is in the system prompt

Every offered skill is listed in the system prompt — one line each, its name and its
description, under a `## Skills` heading — in both execution modes. That is the "shown up
front" affordance the whole capability rests on: a model cannot read a skill it was never
told about, and a catalogue delivered as a tool result would be one more thing a compaction
had to carry.

The listing is the *menu*; a read skill's **body** is a separate, pinned item, and the two
have different lifetimes. The menu is rendered fresh into every request as part of the system
prompt; the body is pinned into the window once and survives every boundary after that.

## The band is shared with documentation views

A read skill lands in the **Documentation** band of the
[context breakdown](/gg/context-visibility/), and it is not alone there: a
[responses-as-code](/gg/responses-as-code/#showing-yourself-things) program that calls
`view.openDocsView` to read a function's signature and documentation puts the result in the
same band. From the window's point of view the two are the same *kind* of thing — authored
material the agent asked to see, rather than the workspace, its own output, or the harness
talking — so they share a band, and the console labels it **Skills & docs**.

What tells them apart is **retention**, not where they came from. A read skill is pinned and
carries no label: it keeps the bare `Documentation` heading, it survives a
[compaction](/gg/compaction/) for the reason above, and `view.current()` does not offer it,
because a close that would reclaim nothing is worse than no close at all. A documentation
view is ephemeral and labelled with the function it documents (`Documentation: openText`), so
it is listed, replaceable, and closable like any other view. `view.close(name)` therefore
reaches a docs view and spares the pinned skill sitting beside it in the same band — the
removal path skips pinned items, so there is no way for a program to close a skill it did not
open.

This is also how a built-in skill pays for itself under responses-as-code: what it puts in
the window is a handful of ordinary, closable docs views, so an agent that has read the
manual and finished with it can reclaim the space.

## The catalog is shared; what has been read is not

Skills are a [module](/gg/modules/) in two halves, because the two halves mean different
things. The **catalog** is authored ahead of the run and never changes, so every agent
reads the one copy (with its own built-ins joined on). The **read set** — which skill bodies
are pinned in the window — is a statement about *that agent's window*, so it travels with the
window it describes: a [`fork`](/gg/fork-and-exec/) copies it along with the conversation it
refers to, and a [transfer](/gg/modules/#transfer) carries it to the successor that inherited
that conversation. A read set that outlived its window would promise a retained body the
window no longer holds.

The **loaded code** is the one thing that follows neither rule: it is not a module in gg's
sense at all, it holds no context and is not transferred, and a new agent instance starts
with nothing bound. Reading the skill again is the whole of the recovery.
