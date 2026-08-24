---
title: "Skills"
---

A skill is a named, described piece of knowledge an agent can reach for by name.
Every skill an agent has is listed in its [system prompt](/gg/prompts/) by name
and one-line description, and it uses the one it wants with `read_skill`
(`gg.skills.readSkill` under
[responses-as-code](/gg/responses-as-code/overview/)).

A skill has two halves and may carry either or both:

- prose, a markdown body which, once read, is retained across a
  [compaction](/gg/compaction/) boundary; and
- code, a module the agent's programs import and a script gg runs each time the
  skill is used. Both are responses-as-code only. See [code
  skills](#code-skills).

[Memories](/gg/memories/) are the same mechanism, curated by the model itself.

## The skills directory

Skills belong to an agent. Each profile that enables the capability names its own
directory in the capability's `dir` param, and gg loads that profile's catalogue
from it. A relative path is joined onto the workspace and an absolute path is
taken as given. Two profiles naming one directory read it once and share the
result, so a run has one copy of a skill in memory and the workspace has one copy
on disk.

An absent `dir`, one that names no readable directory, and every entry below it
that gg cannot load exactly as it is written each refuse the launch. One refusal
names them all, so a single pass over the directory fixes it. A path an operator
wrote is a promise about the seeded workspace, and gg reaches for no directory of
its own when the workspace does not keep it.

The one directory that is always there is `.gg/skills`, the value a fresh
capability is authored with. `.gg` is gg's own — the capture journal, a hook's
scripts, this library — so gg stands the directory up at session start and leaves
it empty. A workspace that authored no skills therefore opens with gg's own
[built-ins](#the-skills-gg-ships) alone, and an agent that is to hold only those
is pointed there deliberately. gg writes nothing *into* it: what it holds is
whatever the workspace put there.

The files under that directory are gg's. gg reads them to build the catalogue
and writes nothing there, no skill path reaches the model, and using a skill by
name is the whole of what gg offers an agent to do with one. The catalogue is
fixed once the run starts, so an agent that writes into the directory with its
[filesystem](/gg/filesystem/) or [shell](/gg/shell/) capability changes nothing
about what any agent is served.

Each entry is one of two shapes. An entry whose name begins with a dot belongs to
tooling and is passed over.

```text
.gg/skills/
  release-checklist.md      a prose skill
  csv-tools/                a skill directory
    skill.md                required — front matter, and optionally a body
    skill.ts                optional — the module the agent's programs import
    on-use.ts               optional — the script gg runs on each use
```

- `<name>.md` is a prose skill: a YAML front-matter block naming it (`name`,
  `description`), then the body. Front matter that is absent, unclosed, or
  missing either field refuses the launch.
- `<name>/` is a skill directory, which is how a skill carries code. `skill.md`
  is required, because the name and the description are what the catalogue is
  made of. Its body is optional, so a skill may be pure code.

The catalogue is ordered by skill name, and two entries claiming one name refuse
the launch.

The two code files are named for the [program
language](/gg/languages/overview/) they are written in: `skill.ts` and
`on-use.ts` for a TypeScript agent, `skill.py` and `on-use.py` for a Python one.
A directory may carry several, because a program's language is resolved per
agent. Each agent reads the spelling its own language names, and `skill.md` is
the same text for all of them. Where two languages share one module runtime, each
accepts the other's spelling and prefers its own, so a `skill.ts` reaches a
JavaScript agent too.

A skill directory carrying code in no language the reading agent writes refuses
the launch, naming the spellings the directory holds.

Using a skill differs from reading a plain file in two ways: it strips the front
matter and returns only the body, and that body is added to the window as a
`Skill`-sourced, pinned item, so the [context
accounting](/gg/context-visibility/) attributes it to skills and compaction
carries it across the boundary verbatim. Using the same skill twice pins one
copy.

## Code skills

A skill's `skill.<ext>` and `on-use.<ext>` are
[responses-as-code](/gg/responses-as-code/overview/) only. A run under native
tool calling is shown the prose half of a skill and nothing else.

Both halves are prepared on first use, in the using agent's own language. A
whitespace-only code file refuses the launch.

### The module is a library

Using a code skill makes its module available to every program the agent writes
from then on, supplied the way that arm supplies gg's own SDK: an extern, a
classpath entry, a module path, a module specifier. Supplying it declares no
name, and the program reaches it through the line the language requires, exactly
as it reaches gg's surface. See
[invariants](/gg/responses-as-code/invariants/).

The module is bound under a key: the skill's name spelled as an identifier in
that language's own convention (`csv-tools` becomes `csvTools`), and a key
something else already claimed takes a numeric suffix starting at 2. Each arm
spells the key and the line that reaches it its own way, through
`ProgramLanguage::lib_access` and `ProgramLanguage::lib_import`.

What a module may contain, what it exports, and what it is refused for are one
shared rule across skills and memories, documented under
[responses-as-code](/gg/responses-as-code/api-surface/). A module exports what it
`export`s, a file with no export at all exports everything it declares, and a
module reaches the same surface a program does through the same line a program
writes.

A loaded module is not context. It costs no tokens, is never summarized, and a
compaction boundary leaves it alone. It belongs to one agent instance: a
[`fork`](/gg/fork-and-exec/) or a succession starts with nothing loaded, and
using the skill again loads it.

### Documentation is how a model meets it

A used module joins the agent's documentation surface. Its key is a module entry
and each declaration it exports is an entry of its own, so both are found by
`gg.docs.search` and opened, re-opened and closed exactly as an SDK entry is. A
function's view carries its declaration, its documentation, and the line a
program writes to reach it.

Using the skill opens one documentation view per function the module declares,
together with the type views the agent's
[`docViewTypes`](/gg/responses-as-code/views/) flags ask for. Those views are the
whole of what gg says about a module: the use itself adds no message.

The views belong to the instance that loaded the module. An instance that starts
with nothing loaded holds none of them, and using the skill again opens them.

Using a revised module opens the views of what it now offers, and a page whose
text has changed replaces the copy that was open. A model that rewrote the code a
[memory](/gg/memories/) carries therefore reads the declaration it wrote, not the
one it replaced.

### An on-use script

An on-use script is how a skill shows the agent something rather than telling it.
gg runs it on every use, after the turn's program has ended, so whatever
[views](/gg/responses-as-code/views/) it opens arrive in the agent's next prompt.
It is prepared once per agent and re-run as prepared, so repeated use costs no
further compilation.

The script runs on the agent's own grants and may do to the agent's context
whatever the agent could do. One thing is withheld: it cannot end the session, so
no `finish` and no `approve` is bound. It sees its own module and no other, so
its behaviour does not depend on the order the agent used things in.

Its source is never shown to the model. If it fails, the model is told one
sentence naming the skill and what went wrong, and the turn's own outcome is
untouched.

A source the language rejected cannot break a use. A skill whose module or on-use
script does not compile is still used: the body is what the model asked for, and
the diagnostic is appended to it.

A skill whose compiler could not finish, through a crash, a timeout, or a
toolchain missing from the image, is gg's own defect and ends the run under
`internal_error`, with the compiler's crash detail on the operator's stream. It
is the same split [a turn's own program](/gg/languages/compilation/) gets.

## The skills gg ships

gg writes twelve skills of its own, one per family of the functions it offers, so
the capability is worth enabling in a workspace that authored none.

| Skill | Family |
| --- | --- |
| `gg-filesystem` | Reading, writing and editing files in the workspace. |
| `gg-shell` | Running shell commands in the workspace. |
| `gg-project` | The [epic/issue board](/gg/project-management/). |
| `gg-tasks` | The agent's own blocked-by [task list](/gg/tasks/). |
| `gg-memory` | Durable [memories](/gg/memories/). |
| `gg-skills` | Using skills, including this one. |
| `gg-context` | [Managing its own window](/gg/agent-managed-context/): evicting, archiving, searching, compacting. |
| `gg-delegation` | [Delegating](/gg/subagents/) work to child agents, and [handing its session on](/gg/fork-and-exec/). |
| `gg-docs` | Finding a function by keyword, and reclaiming the documentation it has read. |
| `gg-views` | Showing itself a file, a value, or a function's documentation. |
| `gg-programs` | [Fetching a program it already ran](/gg/program-library/), and handing a patched copy back. |
| `gg-session` | [Ending its session](/gg/ending-a-session/). |

Three properties make them safe to ship.

Generated, never written. Under native tool calling the body is built from the
agent's live tool definitions: each tool's real name, description and top-level
parameters. Under responses-as-code the body is empty and the skill carries an
on-use script that opens one `gg.views.openDocsView` per function in the family,
which routes through the same documentation lookup the model could have called
itself. A built-in carries no importable code either way.

A family is offered only when the agent has at least one of its functions. Four
families exist only under responses-as-code, because their functions are not gg
tools: `gg-docs`, `gg-views`, `gg-programs` and `gg-session`.

An authored skill of the same name wins. A workspace that writes its own
`gg-filesystem` replaces gg's.

They are selected per agent with the skills capability's `builtIns` param, an
object of toggles the capability writes. It is a **withholding** set: it names
the families held back, and one it does not name is offered — so `{}` is the
declaration that offers all twelve. That is a reading of the object rather than
a default gg fell back to, which is why it differs from
[`healing`](/gg/response-healing/) and
[`docViewTypes`](/gg/responses-as-code/), where each member is an arm and the
object has to name every one of them.

```json
{
  "id": "skills",
  "enabled": true,
  "params": {
    "dir": ".gg/skills",
    "builtIns": { "gg-memory": false, "gg-context": false }
  }
}
```

Switching one off withholds the manual and leaves the functions: the family still
works, and the agent is not handed a description of it. A key naming none of the
twelve refuses the launch, as does a value that is not `true` or `false`, an
absent `builtIns`, and one that is not an object of toggles. A key naming a
family this agent is not offered is accepted, since it is a real skill id and one
configuration is written for a whole sweep.

The built-ins are resolved against what this agent may call, so two agents in one
run hold catalogues that differ exactly where their grants and their directories
do. With no authored skills and no built-ins there is nothing to use, and gg
offers no `read_skill` tool.

## The catalogue in the system prompt

Every offered skill is listed in the system prompt under a `## Skills` heading,
one line each carrying its name and its description, in both execution modes.

The listing is the menu, and a used skill's body is a separate, pinned item. The
menu is rendered fresh into every request as part of the system prompt; the body
is pinned into the window once and survives every boundary after that.

## Where a used skill lands in the window

A used skill's body lands in the Skills band of the [context
breakdown](/gg/context-visibility/), and the documentation views its module
opened land in a Documentation band beside it. What an operator pinned in front
of an agent and what the agent's own code costs it are different questions.

The model meets both under the same `Documentation` heading, because to it they
are one kind of thing: reference material gg holds. What differs is what it can
do with each. A used skill's body keeps the bare heading and survives a
[compaction](/gg/compaction/). A
documentation view is headed with the name it was opened under
(`Documentation: readFile`), is listed, and is closable by an agent that holds
the `docview-close` capability.

This is how a code skill pays for itself: what it puts in the window is a handful
of ordinary, closable documentation views, so an agent that has read the manual
and finished with it can reclaim the space.

## The skills module

Skills are a [module](/gg/modules/) in two halves. The catalogue is authored
ahead of the run and never changes, so an agent holds its own profile's copy with
its own built-ins joined on. The read set, which records which skill bodies are
pinned in the window, is a statement about that agent's window, so it travels
with the window it describes: a [`fork`](/gg/fork-and-exec/) copies it along with
the conversation it refers to, and a [transfer](/gg/modules/#transfer) carries it
to the successor that inherited that conversation.

The loaded code follows neither rule. It is not a module in gg's sense, it holds
no context and is not transferred, and a new agent instance starts with nothing
loaded. Using the skill again is the whole of the recovery.
