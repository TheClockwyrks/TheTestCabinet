---
title: "Prompts"
---

Everything gg says to a model is authored as a Handlebars template rather than as
a string literal in Rust. The templates live in `crates/gg/templates/` and are
embedded into the binary at compile time, so the binary carries its own prompts.
They render through the same strict-mode, no-escaping engine that renders a test
case's [`prompt.hbs`](/testing/end-to-end/overview/#prompt-template).

## The system prompt and the pinned blocks

- `system-tools.hbs` — the tool-calling system prompt: the base framing plus one
  section per enabled capability, each naming its free-standing tools
  (`add_task`, `create_epic`).
- `system-code.hbs` — the responses-as-code system prompt: the same capability
  sections plus the code-protocol framing, with one gated segment per [program
  language](/gg/languages/overview/).
- `tasks.hbs` — the pinned [task list](/gg/tasks/) block.
- `board.hbs` — the pinned [project management](/gg/project-management/) board
  block.
- `memories.hbs` — the pinned [memories](/gg/memories/) block.
- `memory-index.hbs` — the pinned index the `markdown` memory strategy keeps.
- `memory-notice.hbs` — the message a holder of a linked memory instance is
  given when another holder wrote, revised or deleted one.
- `code-nothing-shown.hbs` — the `Notice` a program that ran and put nothing in
  the window earns, checked against the assembled window rather than inferred
  from the outcome. The clause naming what would have shown the model something
  is gated on the program language, by the same mechanism `system-code.hbs`
  uses.

### Briefs

A brief is the whole task from its reader's point of view, and it is the only
thing a freshly spawned agent has been told. Briefs are product text of the same
weight as the system prompt, so they live in the same place.

- `issue-brief.hbs` — a [board issue](/gg/project-management/) as its assigned
  agent is given it: title, overview, in and out of scope, and what "done"
  means.
- `review-brief.hbs` — the reviewer's brief: the issue brief, earlier verdicts,
  and where the work is and what it touched.
- `fix-brief.hbs` — the brief an issue's own agent is re-dispatched with after a
  review requested changes, being the issue brief plus the reviewer's numbered
  items.
- `merge-brief.hbs` — the merge agent's brief when an issue's branch conflicts:
  which branch, and what git reported.

### In-loop prose

- `compaction-instruction.hbs` — the message that opens an in-loop
  [compaction](/gg/compaction/), one section per requirement (summary, `compact`
  call, memory writes) and mode.
- `compaction-unsatisfied.hbs` — the feedback for a reply that satisfied the
  pending compaction in no way, being the instruction again prefaced by what
  went wrong.
- `compaction-refusal.hbs` — the refusal that answers a call the pending
  compaction does not accept, naming both what was refused and what is wanted.
- `compaction-handoff-summary.hbs` — the system prompt the
  `handoff-summarization` strategy gives the separate compaction model.
- `compaction-handoff-compact.hbs` — the system prompt the `handoff-compaction`
  strategy gives the separate compaction model, which answers with a `compact`
  call.
- `compaction-preface.hbs` — the summary item a compacted thread is restarted
  from: the heading that frames it as a recap, then the summary itself.
- `compaction-fallback.hbs` — the note used when the summarization call fails,
  so a failed summary never aborts the run it serves.
- `compaction-memory-summary.hbs` — what a `memory` compaction restarts the
  thread from: a note that a boundary was crossed.
- `completion-missing.hbs` — the feedback for a tool-calling turn that requested
  no tools, naming this agent's own
  [ending calls](/gg/ending-a-session/#ending-calls).
- `context-pressure.hbs` — the per-turn context-pressure signal: how full the
  window is, what is filling it, and how to reclaim space.

### Code-turn messages

gg answers a [responses-as-code](/gg/responses-as-code/overview/) turn with one
of three messages: a `Compiler error`, a `Runtime error`, or a `Notice`. A
program that compiled, ran and did what it meant to earns none of them, because
the views it opened are the turn's result.

The two error messages have no template. Each carries the compiler's or the
runtime's own text: no preamble, no advice, no roster of what the program
called, and no restatement of a rule the system prompt already states. gg may
remove from an error, such as stack frames that are gg's own internals.
Everything a failing turn would otherwise be told is either something the
program already learned by running, since a failed call throws into the program,
or a standing rule stated once in the system prompt.

A compiler error carries one thing beside the diagnostic: the library set the
arm's catalogue declares, where it declares one. That set is what the compiler
measured the program against, so it is part of the diagnostic rather than advice
about it, and it is rendered by the module that owns the [diagnostic
bound](/gg/languages/compilation/#diagnostic-bounds). No prompt carries a
package inventory.

## Assembly from the capability set

A capability that is off contributes no prompt text at all, which is what makes
two configurations cleanly comparable. A capability that is on contributes
its instructions and, where it has one, its state: the pinned blocks and the
skills catalog. For the two capabilities that carry an
[`ownership`](/gg/modules/#ownership) param, an unowned module contributes
neither half and is reachable through its tools alone.

Each system template is therefore one `{{#if}}` section per capability over a
rendering context that carries both whether each capability is on and how it is
configured. A run's actual configuration is interpolated inline rather than
restated in prose, and each template interpolates what its own mode acts on.

The code template interpolates:

- the language's display name, and the arm's checker where it names one;
- the module list, the message headings, and this agent's ending calls;
- the catalog of available skills, each with its description and with whether it
  carries code and whether it carries an on-use script that runs on every use, so
  that using one is described by what it will actually do. The catalog is this
  agent's own: the skills authored under the directory its profile names, joined
  with the built-ins gg generates for its own function families;
- the agents this one may spawn as subagents and the rosters an issue's agent
  and reviewers may be named from, each entry listing the
  [profile id](/gg/configurations/#identity) the model writes with that
  profile's name beside the caller's guidance, and the id of the issue this
  agent was dispatched to implement;
- whether this run's model can be shown an image, where the run offers a file
  read.

The tool-calling template interpolates this agent's ending calls, the same
skills catalog, the same three rosters, the assigned issue's id, whether the
model can be shown an image, and the scope a linked memory set is shared under.
It also interpolates the three limits the code arm leaves to the refusal that
reports a breach: the `read_file` line cap where one is in force, a memory's
description length, and the task count ceiling.

The rendering context is a typed Rust struct (`prompts::SystemContext`), and
rendering runs in strict mode: a template that references a variable the context
does not carry fails rather than rendering a blank. The struct is the documented
list of what a template may reference, and the crate's tests render every
template with the capability sections both on and off.

An operator's per-agent override is held to that same contract. gg parses it at
launch, and one that does not parse refuses the launch alongside every other
value in the capability set gg cannot honour exactly as written. An override that
parses and then fails to render against a live context ends the run as a gg
defect, because the prompt an agent runs under is the prompt its profile wrote.

## Template selection

`prompts::render_system` selects the template from the run's execution mode
alone. A tool-calling run renders `system-tools.hbs`; a code run renders
`system-code.hbs`, whichever program language it is in.

The two modes are separate files because every capability's calls change shape
between them and the base framing carries a different ending rule and a
different account of what a reply is. An operator's per-agent override renders
against the same context in either mode, and the console seeds its editor with
gg's own template for the agent's mode.

### The language segment

`system-code.hbs` is language-agnostic apart from one gated segment per arm,
selected with an `eq` helper over the `language` view the rendering context
carries. That view holds an id, a display name and the arm's checker where it
names one, and no prose: a sentence a model reads lives in the template.

A segment states the shape of a whole reply in that language: what the compiler
or the runtime requires of a whole program, the import lines a program writes
for itself, and where the model's work goes. The language itself defines how a
failure is reported and how a call's arguments are passed, and a documentation
view renders the whole signature, so a segment names no catalogued type.

Where a whole program's own shape is written in terms a catalogue does not carry,
the segment names those terms, on the same rule that lets it name a
language-level helper: a search cannot find them. Rust's entry point returns
`Result<(), gg::Failure>`, which is what makes `?` compose against a call, and
both that type and the constructor a program builds a failure of its own with
live in the SDK's prelude rather than in a published module.

A gate holds every arm's segment to two paragraphs and to a character bound.

Four gates hold what renders. One asserts every required section survives for
every registered language; a second asserts each rendered prompt states the
values the run configured; a third asserts it states the standing rules a
program runs under; a fourth asserts each arm's render carries that arm's
segment and no other arm's.

## The code arm

The opening section states the reply contract: the model's whole reply is one
legal program in this run's language and nothing else, run as that program every
turn. It also states that the session has no tools and no tool-calling protocol:
tool-call syntax of any kind — native tool-call tokens, XML invoke blocks, JSON
function-call objects — is an error nothing dispatches, and the reply is one bare
program with no prose around it and no code fences. Tool-call-trained models
reach for that syntax by reflex, and the runtime really does dispatch none of it:
a code turn offers no tool definitions, and a native tool call emitted anyway is
dropped from the window with a warning.

Three rules follow it, stated for every arm, because none of them is visible in
a signature and each costs a turn to discover by trying it:

- every call is synchronous;
- a view is the only way to read data out of a program, and nothing a program
  prints reaches the model;
- what a view holds arrives on the next turn.

A fourth is stated where the endings are: a failed program's ending is revoked.
A gate holds every registered arm's rendered prompt to the reply contract and
all four rules.

Beyond those, the prompt states the one fact about this run that no function's
brief can answer: whether this run's model can be shown an image, carried by
itself under the Views heading on a run that offers a file read. The read cap
the run's [read mode](/gg/filesystem/#read-modes) sets, the window an offset and
a limit name, and the exit code and merged output a [shell](/gg/shell/) call
hands back each belong to the documentation of the function that does it.

A capability whose calls a brief already describes contributes only what a brief
cannot: a roster the run configured, gg's own process, or the judgement of when
to reach for the capability at all. The [Tasks](/gg/tasks/) section is one
sentence saying to break complex work into steps and track progress through them,
and it names no call, no ceiling and no dependency rule.

Where the arm names a [checker](/gg/languages/compilation/), the prompt states
that the program is compiled before it runs, names the checker, and states that
a program the checker refuses is not executed. The same gate carries the one
consequence of a checked arm a model has to act on: the SDK declares every
function whatever this run enabled, so a call to one the run withheld compiles
and then fails when it runs, naming the call. What the documentation holds is
what the run granted.

### The trailing contract notice

The reply contract is also restated at the very end of every request, as one
constant `Notice`-style sentence: the reply is one bare program in this run's
language, with no prose, no fences and no tool calls. Measured across models,
this trailing restatement is the single most effective lever for keeping a
tool-call-trained model on the contract, so it earns a permanent seat at the
position models weight most.

It is a [slot](/gg/context-visibility/#slots) rather than a thread item: one
instance, rendered after everything else on every request, set once per agent
and cleared when a [succession](/gg/fork-and-exec/) hands the window to a
different holder. Because everything a provider's prompt cache reads sits before
it, the notice never disturbs the append-only prompt, and the tail cache marker
deliberately lands on the newest conversation message rather than on it.

### Modules

The prompt lists one line per capability module: the path this arm spells it
under, the line the module's own declaration introduces it by, and the import
that brings it into scope. Every field is the catalogue's, reflected from the
module's declaration in the guest SDK.

That list is the whole vocabulary the prompt supplies. Nothing enumerates a
module's functions; a module path is an exact lookup into the surface, and
everything finer is found by searching the documentation and opening a
documentation view of a name the search returned.

The list closes on the discovery order the surface requires: open a documentation
view of each function the model intends to call, and write the call on a later
turn. A view arrives on the turn after the program that opened it, so the order
is what makes a signature readable before it is relied on.

Because the calls that do the discovering are themselves functions, every code
agent's session opens with a program gg wrote in that agent's own language and
ran. It lists the agent's filesystem and shell modules and opens the
documentation of the two discovery calls, so the window opens on the functions
an agent reaches for first, one line each, beside the source of a program that
provably ran. Every other module is reached through the prompt's own list, at
the cost of one search. See [the opening
turn](/gg/responses-as-code/views/#the-opening-turn).

### Function names

A prompt may name only what a model could not find for itself: the module paths,
the language-level helpers no catalogue carries, and the agent's own ending
calls. It may never name a catalogued function, because that is precisely the
set a search will hand over.

Three gates hold this. Two read the template sources, so they cover every branch
including the sections a test's context leaves off: one fails a template that
names a catalogued function however it came by the name, and one fails a
code-reachable template that names a bare gg tool. The first pools every arm's
spellings, since one template serves them all, so a language segment may not
name a catalogued call of any language. The third reads what is actually
rendered, for every language.

### Message headings

The code arm lists the message headings a run can produce, each message it
receives being headed by a label on its own line followed by a `----` rule. A
heading whose capability is off is not described, which covers `Memories`,
`Tasks`, `Board` and `File`. The rest are ungated: `Task` for the brief or a
parent's message, `Compiler error` and `Runtime error` for the two ways a
program fails, `Notice` for a process fact from the harness, `Summary` for the
recap a [compaction](/gg/compaction/) restarts the thread from, `Documentation`
for a lookup or a skill, and `View` for something the program showed itself.

The two error rows carry the distinction the model has to act on. A
`Compiler error` means none of it ran, so fix it and resend the whole program. A
`Runtime error` means whatever the program did before it threw stands, so do not
repeat that work.

`View` is qualified by the label the view was opened under (`View: changed-files`),
because a label is the only thing telling two views apart. A documentation view
is qualified the same way. `File` is qualified by the path the view was opened
under, the 1-based inclusive line range it shows and the file's total line
count (`File: src/main.ts:100-250 of 400 lines`; a whole file's range runs
`1-N`), because the body is the file's text alone. The `File` row describes both
the views the run seeds, under
[autoload](/gg/autoload-specifications/), and the ones the program opens itself.
A worked example of one heading and its `----` rule follows the list, and the
list closes on the sentence that makes the vocabulary legible: a program that
ran is not announced, because the views it opened are the result.

### Ending a session

Both arms carry an Ending your session section naming this agent's own
[ending calls](/gg/ending-a-session/#ending-calls), spelled the way that
execution mode writes them. It is the only place the ending is taught. The
briefs gg dispatches with say nothing about it, because a brief that restated
the contract would be a second authority on it, arriving later in the context.

The code arm's version carries one further standing rule: a program that throws
does not end the session even if it called an ending function before it threw.
The ending is revoked, because a program that failed did not finish the work its
summary claims.

## The pinned blocks

The task list, board and memories are each pushed into the window as a pinned
block that is rebuilt whenever the model changes it. Those blocks are state
only, being a heading and the current items:

```text
# Your tasks
- [x] `scaffold` (done) — Scaffold the project
- [ ] `movement` (pending) — Player movement  [blocked by `scaffold`]
```

How to use the tools that maintain them is stated once, in the system prompt's
section for that capability, gated on the capability being enabled. Saying it in
both places would re-teach `add_task` on every refresh for the life of the
session, and would give the model two texts to reconcile whenever they drifted.

The derived parts of a block, meaning whether an item is ready or blocked by
specific incomplete items, are computed in Rust by the store that owns the DAG.
The template lays the result out.

Which of the three an agent gets is decided by its [modules](/gg/modules/): a
block belongs to a module, and a module the agent does not hold contributes
neither a block nor the section that would have described it. An
[unowned](/gg/modules/#ownership) board contributes neither half, which is what
lets an agent be dispatched an issue from a board it is never shown. A holder of
the task list or the memory block is shown it.

### Linked-memory notices

When another holder of a linked memory instance writes, `memory-notice.hbs`
renders a short message naming what changed, and gg appends it at the tail of
the window instead of rebuilding the pinned memory block. Rebuilding the block
would rewrite a prefix the provider has already cached, on a turn this agent did
nothing at all; an append leaves the whole previous request a byte-identical
prefix of the next one. What the agent is told about its memories being shared
comes from the system prompt, so a mid-thread notice reads as gg reporting a
fact.
