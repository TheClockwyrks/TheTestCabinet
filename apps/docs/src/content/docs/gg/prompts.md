---
title: "Prompts"
---

Everything gg says to a model is authored as a Handlebars template rather than
as a string literal in Rust. The templates live in `crates/gg/templates/` and
are embedded into the binary at compile time, so the binary carries its own
prompts. They render through the same strict-mode, no-escaping engine that
renders a test case's [`prompt.hbs`](/testing/end-to-end/overview/#prompt-template).

Prompt text is product text: what gg says to a model is a design decision on the
same footing as the calls it offers a model. This page states the rules that
text is written under. The text itself lives in the templates.

## What gg authors

Four kinds of prose are authored as templates.

- **The system prompts.** One per [execution mode](#template-selection),
  carrying the base framing plus one section per enabled capability.
- **The pinned blocks.** The [task list](/gg/tasks/) and the
  [memories](/gg/memories/), pushed into the window as state and rebuilt when
  the model changes them.
- **The briefs.** A brief is the whole task from its reader's point of view, and
  it is the only thing a freshly spawned agent has been told. gg authors one for
  each way an agent is dispatched: to implement a [board
  issue](/gg/project-management/), to review that work, to act on a review that
  requested changes, and to resolve a branch conflict.
- **The in-loop messages.** What gg says to an agent mid-session: the
  [compaction](/gg/compaction/) instruction and the prose around it, the
  per-turn context-pressure signal, the feedback for a turn that requested
  nothing, the notice a program that showed itself nothing earns, and the notice
  a holder of a linked memory instance is given when another holder writes.

A brief carries the same weight as a system prompt, so it is authored in the
same place and under the same rules.

gg's answer to a failing program is authored nowhere. The [`Compiler error` and
`Runtime error` messages](/gg/responses-as-code/messages/) have no template,
because each carries the compiler's or the runtime's own text.

## What a prompt may say

A prompt states what a model cannot find for itself. A fact earns its place when
it is invisible in a signature and costs a turn to discover by trying it, such
as a standing rule about how a turn behaves. Everything else is read where it is
declared, at the moment the model asks for it.

A prompt therefore names no catalogued function or type. The [module
paths](/gg/modules/) the run's catalogue publishes are the whole vocabulary it
supplies, and anything finer is found by searching the documentation and opening
a documentation view of a name the search returned. The carve-out is a
language-level helper that no catalogue carries, which a search cannot find, and
the agent's own [ending calls](/gg/ending-a-session/#ending-calls), which are
taught in the system prompt alone.

Three gates hold that rule. Two read the template sources, so they cover the
branches a rendering context leaves off: one fails a template that names a
catalogued function however it came by the name, and one fails a code-reachable
template that names a bare gg tool. The first pools every arm's spellings, since
one template serves them all. The third reads what is actually rendered, for
every registered language.

Two further rules follow from stating only what is undiscoverable.

- A value the run configured is interpolated rather than restated in prose, so a
  prompt states this run's limits instead of a default.
- A capability whose calls the documentation already describes contributes only
  what the documentation cannot: a roster the run configured, gg's own process,
  or the judgement of when to reach for the capability at all.

## Assembly from the capability set

A capability that is off contributes no prompt text at all, which is what makes
two configurations cleanly comparable. A capability that is on contributes its
instructions and, where it has one, its state. The
[board](/gg/project-management/) and the [thread
archive](/gg/agent-managed-context/) contribute neither half, and are reachable
through their tools alone.

Each system template is one `{{#if}}` section per capability over a rendering
context carrying both whether each capability is on and how it is configured.
The context is a typed Rust struct, and rendering runs in strict mode, so a
template referencing a variable the context does not carry fails rather than
rendering a blank. The struct is the documented list of what a template may
reference, and the crate's tests render every template with the capability
sections both on and off.

### Operator prose

An operator supplies prose through an agent's
[configuration](/gg/configurations/) in two forms. Custom instructions are
inserted ahead of gg's own text, leaving every capability section intact. A full
template override replaces the file, and the console seeds its editor with gg's
own template for the agent's mode.

An override is held to the same contract as the template it replaces. gg parses
it at launch, and one that does not parse refuses the launch alongside every
other value in the capability set gg cannot honour exactly as written. An
override that parses and then fails to render against a live context ends the
run as a gg defect, because the prompt an agent runs under is the prompt its
profile wrote.

## Template selection

The template is selected from the run's execution mode alone: a tool-calling run
renders the tool-calling system prompt, and a
[responses-as-code](/gg/responses-as-code/overview/) run renders the code one,
whichever program language it is in.

The two modes are separate files because every capability's calls change shape
between them, and the base framing carries a different ending rule and a
different account of what a reply is.

### The language segment

The code template is language-agnostic apart from one gated segment per arm,
selected over the language view the rendering context carries. That view holds
an id, a display name and the arm's checker where it names one, and no prose: a
sentence a model reads lives in the template, gated on the id.

A segment states the shape of a whole reply in that language: what the compiler
or the runtime requires of a whole program, the import lines a program writes
for itself, and where the model's work goes. The language itself defines how a
failure is reported and how a call's arguments are passed, and a documentation
view renders the whole signature. Where a whole program's shape is written in
terms a catalogue does not carry, the segment names those terms, on the same
rule that lets it name a language-level helper.

A segment is held to two paragraphs and to a character ceiling. Every registered
language's render is held to four further claims: that every required section
survives, that it states the values the run configured, that it states the
standing rules a program runs under, and that it carries that arm's segment and
no other arm's.

## The pinned blocks

The task list and the memories are each pushed into the window as a pinned block
that is rebuilt whenever the model changes it. Those blocks are state only,
being a heading and the current items.

How to use the tools that maintain them is stated once, in the system prompt's
section for that capability, gated on the capability being enabled. Saying it in
both places would re-teach the calls on every refresh for the life of the
session, and would give the model two texts to reconcile whenever they drifted.

The derived parts of a block, meaning whether an item is ready or blocked by
specific incomplete items, are computed in Rust by the store that owns the DAG.
The template lays the result out.

Which of the two an agent gets is decided by its [modules](/gg/modules/): a
block belongs to a module, and a module the agent does not hold contributes
neither a block nor the section that would have described it. The
[board](/gg/modules/#what-reaches-the-prompt) contributes neither half, which is
what lets an agent be dispatched an issue from a board it is never shown.

### Linked-memory notices

When another holder of a linked memory instance writes, gg renders a short
message naming what changed and appends it at the tail of the window instead of
rebuilding the pinned memory block. Rebuilding the block would rewrite a prefix
the provider has already cached, on a turn this agent did nothing at all; an
append leaves the whole previous request a byte-identical prefix of the next
one. What the agent is told about its memories being shared comes from the
system prompt, so a mid-thread notice reads as gg reporting a fact.
