---
title: "Skills"
---

A skill is a named, described piece of knowledge the agent can reach for by
name. Every skill the agent has is listed in its [system
prompt](/gg/prompts/) by name and one-line description, and it reads the one it
wants with `read_skill` (`gg.skills.readSkill` under
[responses-as-code](/gg/responses-as-code/overview/)).

A skill has two halves and may carry either or both:

- prose, a markdown body which, once read, is retained across a
  [compaction](/gg/compaction/) boundary; and
- code, a module bound into every program the agent writes from then on
  and/or a script gg runs once when the skill is first used. Both are
  responses-as-code only. See [code skills](#code-skills).

[Memories](/gg/memories/) are the same mechanism, curated by the model itself.

## The skills directory

Skills are loaded once, at launch, from the run's skills directory: `.gg/skills`
under the workspace by default, or wherever the capability's `dir` param points.
A relative path is joined onto the workspace and an absolute one is used as
given. The library is the run's, so the directory is read off the first agent
profile; a *different* `dir` on another profile refuses the launch rather than
being read by nothing. Which agents are offered the library is a separate
question, and each profile's own switch answers it — a run whose reviewer alone
reads skills is a run with skills. A `dir` param that names no readable
directory refuses the launch, as does every entry below that gg cannot load
exactly as it is written. One refusal names them all, so a single pass over the
directory fixes it.

The **default** directory is different, and only because it is the default:
nothing seeds `.gg/skills`, so a workspace that authored no skills simply has
none there and the run opens with gg's own built-ins. A path an operator wrote is
a promise about the workspace; an unwritten one is an absence.

Each entry in that directory is one of two shapes. An entry whose name begins with
a dot is tooling's — a `.gitkeep`, a `.DS_Store` — and is passed over rather than
held to a rule about skills it never claimed to be.

```text
.gg/skills/
  release-checklist.md      a prose skill
  csv-tools/                a skill directory
    skill.md                required — front matter, and optionally a body
    skill.ts                optional — the module the agent's programs can call
    on-use.ts               optional — the script gg runs when the skill is first read
```

- `<name>.md` is a prose skill: a small YAML front-matter block naming it
  (`name`, `description`), then the body. Front matter that is absent, unclosed,
  or missing either field refuses the launch.
- `<name>/` is a skill directory, which is how a skill carries code. `skill.md`
  is required, because the name and the description are what the catalogue is
  made of, so a directory without one refuses the launch. A body in it is
  optional, so a skill may be pure code.

The catalogue is ordered by skill name, and two entries claiming one name refuse
the launch.

The two code files are named for the [program
language](/gg/languages/overview/) they are written in: `skill.ts` and
`on-use.ts` for a TypeScript agent, `skill.py` and `on-use.py` for a Python one.
A directory may carry several, because a program's language is resolved per
agent, so one run can drive two agents that could not evaluate each other's
modules. Each agent reads the spelling its own language names, and `skill.md` is
the same text for all of them. Where two languages share one module runtime,
each accepts the other's spelling and prefers its own: a `skill.ts` reaches a
JavaScript agent too.

A skill directory carrying code in no language the reading agent writes refuses
the launch, naming the spellings the directory holds. A directory serving several
language arms carries a spelling for each.

Reading a skill differs from reading a plain file in two ways: it strips the
front matter and returns only the body, and that body is added to the window as
a `Skill`-sourced, pinned item, so the [context
accounting](/gg/context-visibility/) attributes it to skills and compaction
carries it across the boundary verbatim. Reading the same skill twice does not
pin a second copy.

## Code skills

A skill's `skill.<ext>` and `on-use.<ext>` are
[responses-as-code](/gg/responses-as-code/overview/) only. A run under native
tool calling is shown the prose half of a skill and nothing else, since there
are no programs for a module to be bound into.

Both halves are prepared at the read, in the reading agent's own language. A
whitespace-only code file refuses the launch.

### Bound modules

Reading a code skill binds its exports at `lib.<key>` in every program the agent
writes from then on. The key is the skill's name spelled as an identifier in
that language's own convention (`csv-tools` becomes `lib.csvTools`), and a key
something else already claimed is given a numeric suffix starting at 2. The
reply to the read states the key it really got, in the reader's own syntax, and
what the module exports:

```text
---
The code this skill carries is loaded: call it as `lib.csvTools.<name>`. It exports:
parseCsv, toRows. It stays bound for the rest of your session, including across a
compaction.
```

That reply is where a model learns the spelling. `lib` binds no catalogued
function, so a search finds nothing and the [system prompt](/gg/prompts/) states
that a skill carries code without saying how the code is reached. Eight arms
write a path, and Java, Kotlin and PureScript name both halves as strings,
because a module is compiled separately from the program that uses it. Each arm
supplies its own form through `ProgramLanguage::lib_access`.

What a module may contain, what it exports, and what it is refused for are one
shared rule across skills and memories, documented under
[responses-as-code](/gg/responses-as-code/sandbox/). A module exports what it
`export`s, a file with no export at all exports everything it declares, and a
module is evaluated against the same scope a program gets, so it may call
`gg.files.readFile` or `gg.shell.shell` like anything else. The compiled arms link
the binding rather than looking it up, so a key or a name that does not exist is
a diagnostic on the turn that wrote it; see [the language
arms](/gg/languages/overview/) for how each spells a module.

Loaded code is not context. It costs no tokens, is never summarized, and a
compaction boundary leaves it alone. It does not survive a change of agent: the
registry is per agent instance, so a [`fork`](/gg/fork-and-exec/) or a
succession starts with nothing bound and reading the skill again reloads it.

### An on-use script that runs once

An on-use script is how a skill shows the agent something rather than telling it.
It runs once per agent, on the read that first brings the skill into use, and it
is deferred: gg runs it after the turn's program has ended, so whatever
[views](/gg/responses-as-code/views/) it opens arrive in the agent's next
prompt.

Three rules bound it, and each says the same thing from a different side. An
on-use script is not the agent's turn.

- It cannot end the session. No `finish` and no `approve` is bound.
- It has no [program library](/gg/program-library/) and no docs-view close.
- It sees its own module and no other, so its behaviour does not depend on the
  order the agent read things in.

Its source is never shown to the model, on any path. If it fails, the model is
told one sentence naming the skill and what went wrong, and the turn's own
outcome is untouched: the model's program succeeded or failed on its own merits.

A source the language rejected cannot break a read. A skill whose module or
on-use script does not compile is still read: the body is what the model asked
for, and the diagnostic is appended to it.

A skill whose compiler could not finish, through a crash, a timeout, or a
toolchain missing from the image, is gg's own defect and ends the run under
`internal_error`, with the compiler's crash detail on the operator's stream. It
is the same split [a turn's own program](/gg/languages/compilation/) gets.

## The skills gg ships

gg writes twelve skills of its own, one per family of the functions it offers,
so the capability is worth enabling in a workspace that authored none.

| Skill | Family |
| --- | --- |
| `gg-filesystem` | Reading, writing and editing files in the workspace. |
| `gg-shell` | Running shell commands in the workspace. |
| `gg-project` | The [epic/issue board](/gg/project-management/). |
| `gg-tasks` | The agent's own blocked-by [task list](/gg/tasks/). |
| `gg-memory` | Durable [memories](/gg/memories/). |
| `gg-skills` | Reading skills, including this one. |
| `gg-context` | [Managing its own window](/gg/agent-managed-context/): evicting, archiving, searching, compacting. |
| `gg-delegation` | [Delegating](/gg/subagents/) work to child agents, and [handing its session on](/gg/fork-and-exec/). |
| `gg-docs` | Finding a function by keyword, and reclaiming the documentation it has read. |
| `gg-views` | Showing itself a file, a value, or a function's documentation. |
| `gg-programs` | [Fetching a program it already ran](/gg/program-library/), and handing a patched copy back. |
| `gg-session` | [Ending its session](/gg/ending-a-session/). |

Three properties make them safe to ship.

Generated, never written. No part of a built-in's content is prose kept
somewhere it could drift from the thing it describes. Under native tool calling
the body is built from the agent's live tool definitions: each tool's real name,
description and top-level parameters. Under responses-as-code the body is empty
and the skill carries an on-use script that opens one `gg.views.openDocsView`
per function in the family, which routes through the same documentation lookup
the model could have called itself. A built-in carries no importable code either
way.

A family is offered only when the agent has at least one of its functions.
Four families exist only under responses-as-code, because their functions are
not gg tools: `gg-docs`, `gg-views`, `gg-programs` and `gg-session`.

An authored skill of the same name wins. A workspace that writes its own
`gg-filesystem` replaces gg's.

They are selected per agent with the skills capability's `builtIns` param,
which, like every toggle set in gg, records only the ones switched off, so an
unconfigured run gets all of them:

```json
{
  "id": "skills",
  "enabled": true,
  "params": { "builtIns": { "gg-memory": false, "gg-context": false } }
}
```

Switching one off withholds the manual and leaves the functions: the family
still works, and the agent is not handed a description of it. A key naming none
of the twelve refuses the launch, as does a value that is not `true` or `false`
and a `builtIns` that is not an object of toggles. A key naming a family this
agent is not offered is accepted, since it is a real skill id and one
configuration is written for a whole sweep.

The built-ins are resolved against what this agent may call, so two agents in one
run hold catalogues that agree about every authored skill and differ exactly
where their grants do. With no authored skills and no built-ins there is nothing
to read, and gg offers no `read_skill` tool.

## The catalogue in the system prompt

Every offered skill is listed in the system prompt under a `## Skills` heading,
one line each carrying its name and its description, in both execution modes.

The listing is the menu, and a read skill's body is a separate, pinned item. The
menu is rendered fresh into every request as part of the system prompt; the body
is pinned into the window once and survives every boundary after that.

## Where a read skill lands in the window

A read skill lands in the Skills band of the [context
breakdown](/gg/context-visibility/), and the documentation views a program opens
with `gg.views.openDocsView` land in a Documentation band beside it. What an
operator pinned in front of an agent and what the agent's own lookups cost it
are different questions.

The model meets both under the same `Documentation` heading, because to it they
are one kind of thing: reference material gg holds. What differs is what it can
do with each. A read skill keeps the bare heading, survives a
[compaction](/gg/compaction/), and `gg.views.current()` does not offer it. A
documentation view is headed with the name it was opened under
(`Documentation: readFile`), is listed, and is closable by an agent that holds
the `docview-close` capability.

This is also how a built-in skill pays for itself under responses-as-code: what
it puts in the window is a handful of ordinary, closable docs views, so an agent
that has read the manual and finished with it can reclaim the space.

## The skills module

Skills are a [module](/gg/modules/) in two halves. The catalogue is authored
ahead of the run and never changes, so every agent reads the one copy with its
own built-ins joined on. The read set, which records which skill bodies are
pinned in the window, is a statement about that agent's window, so it travels
with the window it describes: a [`fork`](/gg/fork-and-exec/) copies it along
with the conversation it refers to, and a [transfer](/gg/modules/#transfer)
carries it to the successor that inherited that conversation.

The loaded code follows neither rule. It is not a module in gg's sense, it holds
no context and is not transferred, and a new agent instance starts with nothing
bound. Reading the skill again is the whole of the recovery.
