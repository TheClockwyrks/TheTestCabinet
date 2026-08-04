---
title: "Prompts"
---

Everything gg _says_ to a model is authored as a **Handlebars template**, not as a
string literal in Rust. The templates live in
[`crates/gg/templates/`](https://github.com/TheClockwyrks/the-test-cabinet/tree/master/crates/gg/templates)
and are embedded into the binary at compile time, so gg keeps its
[no-external-resources](/gg/overview/#installation--distribution) property: the binary
carries its own prompts.

This is the same templating idiom — and the same strict-mode, no-escaping engine — that
renders a test case's [`prompt.hbs`](/testing/end-to-end/overview/#prompt-template).

| Template                   | What it renders                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-tools.hbs`         | The **tool-calling** system prompt: the base framing plus one section per enabled capability, each naming its free-standing tools (`add_task`, `create_epic`).                         |
| `system-code.<language>.hbs` | The **responses-as-code** system prompt, one file per [program language](/gg/program-languages/) (today `system-code.typescript.hbs`): the same capability sections with their calls in grouped-method form (`tasks.addTask`, `project.createEpic`), plus the code-protocol framing. |
| `tasks.hbs`                | The pinned [task list](/gg/tasks/) block.                                                                                                                                              |
| `board.hbs`                | The pinned [Project management](/gg/project-management/) board block.                                                                                                                  |
| `memories.hbs`             | The pinned [memories](/gg/memories/) block.                                                                                                                                            |
| `memory-notice.hbs`        | The per-turn notice a holder of a [linked memory instance](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote) is given when **another** holder wrote, revised or deleted one. |
| `code-nothing-shown.<language>.hbs` | The **`Notice`** a [program](/gg/responses-as-code/) that ran but put nothing in the window earns, checked against the assembled window rather than inferred from the outcome. Per language, because it names the calls that would have shown the model something. |

### One `code-*` template, where there were six

gg used to author a per-turn report for every [responses-as-code](/gg/responses-as-code/)
turn: one template for a program that ran — its roster of composed calls, the views it
opened, closed or was refused, the value it discarded — and one each for a program that did
not compile, for one the sandbox could not run to a result, and for one it stopped at its
execution timeout. A sixth told a model its reply was not a program at all. All of them are
gone, and what is left is the one `Notice` template above.

gg now authors almost nothing for a code turn, because the whole vocabulary is three
messages — `Compiler error`, `Runtime error`, and a `Notice` — and a program that compiled,
ran and did what it meant to earns none of them: the views it opened are the turn's result.
Two of the three are not templates at all. `Compiler error` and `Runtime error` carry the
compiler's or the runtime's own text verbatim and nothing else, and having nowhere to author
them is precisely how that holds. A template is somewhere for gg's prose to accumulate — a
preamble here, a line of advice there, a restatement of a rule the system prompt already
states — and the two messages that most invite that accumulation are the two that can least
afford it: a model reading its own error wants the error. So they deliberately have no
template. What a failing turn used to be told alongside its diagnostic is now either
something the program already learned by running (a failed call throws into the program) or a
standing rule stated once in the system prompt, and everything else gg used to say goes to
the operator's [telemetry](/gg/telemetry/) stream rather than to the model.

### The briefs gg dispatches with

A **brief** is the whole task from its reader's point of view: it is the only thing a
freshly spawned agent has ever been told. They are product text of exactly the same weight
as the system prompt, so they live in the same place.

| Template            | What it renders                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-brief.hbs`   | A [board issue](/gg/project-management/) as its assigned agent is given it — title, overview, in/out of scope, and what "done" means.                |
| `review-brief.hbs`  | The [reviewer](/gg/project-management/)'s brief: the issue brief, earlier verdicts, and where the work is and what it touched.                       |
| `fix-brief.hbs`     | The brief an issue's own agent is re-dispatched with after a review requested changes — the issue brief plus the reviewer's numbered items.          |
| `merge-brief.hbs`   | The merge agent's brief when an issue's branch conflicts: which branch, and what git reported.                                                       |
| `attempt-brief.hbs` | One attempt's brief in a [speculative execution](/gg/speculative-execution/) — the shared task and its assigned approach if any.                     |
| `judge-brief.hbs`   | The judge's brief for a [speculative execution](/gg/speculative-execution/): the task and each candidate's own summary.                              |

### The rest of the loop's prose

| Template                                | What it renders                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction-instruction.hbs`            | The message that opens an in-loop [compaction](/gg/compaction/), one section per requirement (summary, `compact` call, memory writes) and mode. |
| `compaction-unsatisfied.hbs`            | The feedback for a reply that satisfied the pending compaction in no way at all — the instruction again, prefaced by what went wrong.           |
| `compaction-refusal.hbs`                | The refusal that answers a call the pending compaction does not accept, naming both what was refused and what is wanted.                        |
| `compaction-handoff-summary.hbs`        | The system prompt the `handoff-summarization` strategy gives the separate compaction model.                                                     |
| `compaction-handoff-compact.hbs`        | The system prompt the `handoff-compaction` strategy gives the separate compaction model, which answers with a `compact` call.                   |
| `compaction-preface.hbs`                | The summary item a compacted thread is restarted from — the heading that frames it as a recap, then the summary itself.                         |
| `compaction-fallback.hbs`               | The note used when the summarization call fails, so a failed summary never aborts the run it serves.                                            |
| `compaction-memory-summary.hbs`         | What a `memory` compaction restarts the thread from: a bare note that a boundary was crossed, rather than a recap.                              |
| `completion-missing.hbs`                | The feedback for a tool-calling turn that requested no tools, naming this agent's own [ending calls](/gg/completion/#ending-calls).             |
| `completion-validation-failure.hbs`     | The feedback for an ending a [validation command](/gg/completion/) rejected: which command failed, and its output.                              |
| `context-pressure.hbs`                  | The per-turn [context-pressure](/gg/agent-managed-context/) signal — how full the window is, what is filling it, and how to reclaim space.      |

## The system prompt is assembled from the capability set

gg's whole premise is that capabilities are independently toggleable, and that extends
to the prompt: **a capability that is off contributes no prompt text at all**. That is
what makes an [ablation](/gg/overview/#the-capability-set) clean — the off arm's model
is never told about a feature it does not have.

A capability that is on contributes two halves: the **instructions** — how to use the calls,
what the limits are — and, where it has one, the **state**: the pinned blocks below, and the
[skills](/gg/skills/) catalog. For the two capabilities that carry an
[`ownership`](/gg/modules/#ownership) param — the board and the thread archive — an
**unowned** module contributes neither half: it is reachable through its tools and nothing
else, and what documents those tools is their own schemas.

So each system template is one `{{#if}}` section per capability, over a rendering context
that carries both _whether_ each capability is on and _how it is configured_. A run's actual
limits are interpolated inline rather than restated in prose:

- the `read_file` [line cap](/gg/filesystem/#read-modes), when one is in force;
- the [memories](/gg/memories/) budget (count, per-memory length, total length);
- the [task](/gg/tasks/) count ceiling;
- the [Project management](/gg/project-management/) epic and issue ceilings;
- the catalog of available [skills](/gg/skills/), each with its description — the
  workspace's authored ones and the [built-ins](/gg/skills/#the-skills-gg-ships) gg
  generates for this agent's own function families, in one `## Skills` section.

The rendering context is a typed Rust struct (`prompts::SystemContext`), and rendering
runs in **strict mode**: a template that references a variable the context does not
carry fails rather than silently rendering a blank. The struct is therefore the
documented list of what a template may reference, and the crate's tests render every
template with the capability sections both on and off — so a typo in a `.hbs` file fails
the build instead of reaching a model.

Because each prompt is one self-contained file, editing it is editing prose: rewording the
tasks section, reordering the capability sections, or tightening the base framing needs no
Rust change.

## Two whole templates, chosen by execution mode

[Responses as code](/gg/responses-as-code/) does not just add to the tool-calling prompt —
it rewrites it. Every capability's calls change shape (there is no free-standing `add_task`
in code mode, only `tasks.addTask`, a method on the `tasks` object), and the base framing's
ending rule and tool listing are replaced wholesale. So the two arms are **separate files**,
`system-tools.hbs` and `system-code.<language>.hbs`, and `prompts::render_system` selects
between them on the run's execution mode. An operator's per-agent template override still
renders against the same context in either mode; the console seeds its editor with whichever
built-in default matches the agent's mode.

The code arm is per **program language**, not one file with language branches in it. The
template quotes the SDK's own spellings at nearly every bullet — `skills.readSkill(name)`,
`project.createIssue`, `view.openText`, `JSON.stringify` — and function spelling is exactly
what a second language is free to change, so a merged file would need a branch almost
everywhere and adding a language would mean editing the file every language shares. Each
language's template is registered under `system-code.<language id>` by walking the language
registry, so a new one arrives without a list anywhere being edited, and a test renders every
registered language's prompt and asserts each required section survived the copy.

The code arm teaches five things the tool-calling arm has no need of:

- **What a reply _is_.** The model's whole reply is the program, and the prompt says so
  in as many words: no plain text, no Markdown formatting, no other non-code text. The
  rule is about the shape of a **reply**, not about the shape of the page it is stated
  on — the one fenced block the template can render illustrates a message the model
  *receives*, not one it sends.
- **That every call is synchronous.** `await` is not a thing to reach for and a return
  value is not a promise. A model brings the opposite reflex to a tool API, and it is
  worth a line up front rather than a wasted turn: a continuation parked on a promise
  would resume only after the program had already returned, which is why
  [healing](/gg/response-healing/) unwraps an `async` wrapper rather than running one.
- **How to show itself something.** A program's values live and die inside the turn, so
  the opening paragraphs name the
  [`view` object](/gg/responses-as-code/#showing-yourself-things) as the channel that
  carries — `view.openText(slug, contents)` for a value the program computed,
  `view.openFile(path)` for a file — and say plainly that `console.log()` will not be
  visible, which is the one sentence keeping a model from writing its answer somewhere
  only the operator can read it. The `openFile` line grows a second half when, and only
  when, this run's [read mode](/gg/filesystem/#read-modes) caps a read: the windowed form,
  `view.openFile(path, { offset: 400, limit: 200 })`, with the run's own line cap
  interpolated and the promise that a larger `limit` is honored. Under `unlimited` the
  call takes no `offset`/`limit` at all, so naming them there would sell the one arm that
  cannot use them a pair of knobs that do nothing — which is worse than saying nothing,
  because the model spends the turn wondering why the window it asked for was ignored.
  `openText` is never withheld (the object is bound whatever a run enables, since a run
  with no tools at all must still be able to show its model something); the two lines whose
  call a run can withhold — `openFile`, and `system.shell` below — are each gated on this
  run binding it, because naming a call it does not bind is a `ReferenceError` the model
  copies verbatim.
- **How to run a command.** `system.shell(command)` earns a line of its own, naming what
  it hands back: the `exitCode` and the merged output, to the **program**, with the
  reminder to open a view on that output to read it yourself. The surface is otherwise
  read on demand, and this is one of the places that rule does not pay — running a build
  or a test is the most common thing a program does, and a model that has to discover the
  call through `system.list()` spends a turn on it. The line is gated on `shell` being
  offered and on nothing else; in particular it is not gated on whether the run
  [offloads](/gg/shell/#output-offloading) that output, which is a fact about what comes
  back rather than about whether the call exists at all.
- **What is in scope, and how to read its documentation.** One line per API object — its
  name and what it is for — and then the two discovery calls, `<object>.list()` and
  `view.openDocsView(fn)`. No signatures and no type declarations: the prompt names the
  argument shape of the two or three calls a program cannot bootstrap without, and nothing
  else. The rest of the surface is
  [read on demand](/gg/responses-as-code/#the-typed-tool-surface) rather than dumped up
  front, and what a call's options are, what it throws, and the rest of the `view`
  object's own functions (`view.close`, `view.current`) are answers the model asks for
  rather than paragraphs it is handed. What the prompt distinguishes the two discovery
  calls by is the **route** each takes, not the turn each answers on. `<object>.list()`
  **returns** its directory to the *program*, one `{ name, summary }` per function — an
  ordinary return value, so it puts nothing in front of the model on its own, and the
  prompt writes out the call that forwards it:
  `view.openText("fs", JSON.stringify(fs.list()))`. `view.openDocsView(fn)` **opens a
  view** directly, of one function's signature, documentation and types. Getting that
  wrong is not a slow turn but an empty one: a prompt that offers them as two ways to look
  something up teaches that `system.list()` shows you the functions on `system`, and it
  does not — it shows them to a program that then discards them, and the model reads a
  `Notice` saying its program put nothing in its context, having done exactly what it was
  told. Either route lands in the window on the *next* turn: *"Ask in one turn, use it in
  the next."* The prompt used to make that claim about the old `.docs()` method, which
  returned its text inline and made a liar of the sentence; a view is what makes it true.
  The rules those functions obey are documented for *humans* on
  the [responses as code](/gg/responses-as-code/#showing-yourself-things) page; the model
  opens a docs view.

The code arm also lists the **message headings** a run can produce — the `<label>\n----\n`
rule every message it receives obeys — and that list is gated the same way everything else
is: a heading whose capability is off (`Memories`, `Tasks`, `Board`, `File`) is not
described, because a model should never be told about a message kind this run cannot send
it. Everything else in the vocabulary is ungated, and that is most of it: `Task` for the
brief or a parent's message, `Compiler error` and `Runtime error` for the two ways a program
fails, `Notice` for a process fact from the harness, `Summary` for the recap a
[compaction](/gg/compaction/) restarts the thread from, `Documentation` for a lookup or a
skill, and `View` for something the program showed itself.

The two error rows are ungated because every program can fail, and their descriptions carry
the one distinction the model has to act on: a `Compiler error` means "none of it ran; fix
it and resend the whole program", while a `Runtime error` means "whatever the program did
before it threw stands, so do not repeat that work". `Documentation` is ungated for a
different reason — the band has two occupants and only one of them belongs to the
[skills](/gg/skills/) capability, since a docs view a program opened with
`view.openDocsView` arrives under that heading whether or not the run has skills at all.
It is also described as arriving "on the following turn", which is the same fact the
discovery paragraph states from the other side.

`View` is the heading **qualified by a selector** — `View: changed-files` rather than a bare
word — because a label is the sole thing telling two views apart, and `Documentation` is
qualified the same way, and for the same reason, when what it carries is a docs view
(`Documentation: openText`) rather than a read skill. A skill keeps the bare word: it is
pinned, its body opens by naming itself, and there is no `view.close` that could name it.

The list closes on the sentence that makes the whole vocabulary legible: *"When your program
compiles and runs, you are not told so — the views it opened are the result. You hear from
the harness only when something failed or when there is a process fact you could not
otherwise know."* That is the reading order gg wants: a turn with no message from the harness
is a turn that worked.

Both arms then carry an **Ending your session** section naming this agent's own
[ending calls](/gg/completion/#ending-calls) — `finish`, the two review verdicts, or
`selectWinner` — spelled the way that execution mode writes them. It is the only place
the ending is taught: the briefs gg dispatches with say nothing about it, because a brief
that restated the contract would be a second authority on it, arriving later in the
context and therefore winning any disagreement. That is how a code-mode reviewer once came
to be told to end with a final message its protocol does not have.

The code arm's version of that section carries one standing rule the tool-calling arm has no
use for: a program that throws does **not** end the session, even if it called an ending
function before it threw — the ending is revoked, because a program that failed did not
finish the work its summary claims. That rule used to be delivered as a line appended to the
report on the turn that tripped over it, which is the least useful moment to state it: a
model only ever read it *after* it had already lost an ending it thought it had, and, sitting
beside a diagnostic, it read as commentary on the program just written rather than as a fact
about the protocol. It belongs where a standing rule belongs — in the one place it is stated
once, ahead of the first program — and moving it there is what let the error messages carry
the error alone.

## The pinned blocks carry state, not instructions

The [task list](/gg/tasks/), [board](/gg/project-management/), and
[memories](/gg/memories/) are each pushed into the window as a **pinned** block that is
rebuilt whenever the model changes it. Those blocks are **state only** — a heading and
the current items:

```text
# Your tasks
- [x] `scaffold` (done) — Scaffold the project
- [ ] `movement` (pending) — Player movement  [blocked by `scaffold`]
```

How to _use_ the tools that maintain them is stated once, in the system prompt's section
for that capability, gated on the capability being enabled. Saying it in both places
would spend context re-teaching `add_task` on every refresh, for the life of the session
— and would give the model two texts to reconcile whenever they drifted apart.

The derived parts of a block — whether an item is _ready_ or _blocked by_ specific
incomplete items — are computed in Rust by the store that owns the DAG. The template only
lays the result out.

Which of the three an agent actually gets is decided by its [modules](/gg/modules/): a
block belongs to a module, and a module the agent does not hold contributes neither a block
nor the section that would have described it. The board adds one more way to withhold it —
an [unowned](/gg/modules/#ownership) board contributes neither half — which is what keeps
it out of an agent that has no board tools: it holds the run's board unowned, so it can be
[dispatched an issue](/gg/project-management/) from a board it is never shown. The task list
and the memory block have no such switch; a holder of either is shown it.

### The one message that is appended rather than pinned

A [linked memory instance](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote)
is the exception that proves the pinning rule. When another holder writes, `memory-notice.hbs`
renders a short message naming what changed, and gg **appends** it at the tail of the window
instead of rebuilding the pinned memory block. Rebuilding the block would rewrite a prefix
the provider has already cached, on a turn this agent did nothing at all; an append leaves the
whole previous request a byte-identical prefix of the next one. What the agent is told about
its memories being shared at all comes from the system prompt, so a mid-thread notice reads as
gg reporting a fact rather than as another agent addressing it.
