---
title: "Invariants"
---

Everything on this page is required of every turn of every agent in this
execution mode, whatever language that agent writes in. The pages under
[program languages](/gg/languages/overview/) record how each arm spells what is
required here. Two gates hold every registered arm to it: `authorship.rs`
compares what a preparation produced with the bytes it was handed, and `g8.rs`
drives five failure shapes through each arm and records what the model reads.
`authorship.rs` prepares each arm's program twice, once with a code module in
scope, because supplying a module is the point at which an arm has reason to
write into a program. Each gate pins the cells its arms do not satisfy, so
closing one is a visible edit and losing one is a failure.

A fenced program on these pages is a whole program of the arm its fence names,
and `docs.rs` compiles every one of them through that arm's own preparation. A
page teaching a program that would not run is a page teaching the model's own
first mistake.

## The program is the model's

The bytes gg compiles are the bytes the model sent. gg writes no prologue, no
epilogue, no entry point and no import around them, and the compiled text is the
text the next prompt carries back inside that turn's own recorded
`submit_program` call.

A model writes whatever its language requires of a whole program. Where a
language requires an entry point, the model declares it. Where a language
executes top-level statements, the model writes statements and declares nothing.
The [prompt](/gg/prompts/) states the requirement and the language's own compiler
holds the model to it.

### Code modules are gg's to wrap

A code [skill](/gg/skills/)'s or memory's module is an author's file rather than
a model's reply, so the rule above reaches the module's own text and stops there.
gg may open a namespace, a class or a module declaration around it, may lift the
author's own import lines to the position that construct requires, and may write
the line that brings gg's surface into it, which is what a compiled arm needs to
build one at all.

What still binds is the location: a module diagnostic is anchored by a
line-control directive the language honours, by a source map, or by a wrapper
that adds no line, and never by arithmetic. And what a module reaches is the
module's own business: a program reaches the module's namespace through its own
line, and the module reaches gg's surface through one it wrote itself.

The program that uses a module is a model's reply, so the rule above reaches it
in full. A module is made available the way an arm makes gg's SDK available, and
the program names it the way it names anything else.

## No repair pass

Nothing sits between the submitted `program` string and the compiler. gg
deletes nothing, inserts nothing and reorders nothing: the string the model
passed to `submit_program` is what compiles, what runs, what the
[program library](/gg/program-library/) records, and what the next prompt
carries inside the model's own recorded call. Text beside the call is the
assistant's message, surfaced and recorded verbatim, and never parsed for
code.

## Everything a program uses, it imports

Every library a program names is reached through a line that program wrote, gg's
SDK and the language's own standard library alike. What an arm offers is in
scope once the model has asked for it and not before. Names the language's own
definition puts in scope, such as `java.lang` or the JavaScript global object,
are in scope from a program's first line.

The entry point of an executed program is the model's own code, and every library
it uses is reached from inside it. That is what makes the measured program the
model's program rather than gg's arrangement of it.

An arm supplies package availability itself: a classpath entry, an extern, an
include path, a linked archive, each of which declares no name. A code
[skill](/gg/skills/)'s or memory's module is supplied through the same mechanism
as the SDK, so what an arm does for gg's own surface is what it does for an
author's.

Because a line is the only route in, a documentation view states the line a
program writes to reach the symbol it describes. An arm whose views omit it
offers a surface no program can call.

## Documentation comes from the language's own tool

Every word of an arm's catalogue is produced by that language's documentation
generator, reading documentation comments written on the declaration they
describe. rustdoc JSON, a javadoc doclet, Roslyn, clang's JSON AST, a Swift
symbol graph, `purs --codegen docs`, the Kotlin front end, YARD, griffe and
`tsc` are each the tool its own language's users would reach for.

The import line for a symbol is the one thing an arm may compose itself, and
only where its generator does not report it.

### The shape of a documentation comment

Every entry is written in Doxygen's implicit structure. The first line is the
brief and the lines under it are the detail.

Documentation covers the parameters a function takes, the failures it raises and
the value it returns, and states the preconditions, postconditions and
invariants a function holds. Concision carries the same weight: the detail says
what a model cannot read off the signature, and stops there.

A declared failure is recorded as well as read. An arm's catalogue carries, per
function, the error types that function's comment declares in its language's own
tag for one, and a documentation view opens those types beside the function it
documents. A function documenting none carries an empty list.

## Search and documentation views

Search reaches three kinds of entry: modules, functions and types. A module is
whatever that language makes importable, so C++ publishes namespaces rather than
headers and PureScript publishes its own modules.

A search hit carries the entry's brief and nothing further. The detail, the
signatures and the import line are what opening a
[documentation view](/gg/responses-as-code/views/) of the hit is for.

Everything search can return can be opened as a documentation view. A hit a
model can find and cannot read in full is a name it has no route to use.

## Failures

A program owns its own failures. One that throws, panics or aborts fails the
turn, and what the model reads is what its language emitted, including the
location that language reported and whatever the program wrote to standard
error.

How the turn is **filed** follows from what the guest can see, and the rule has
two halves. A guest whose runtime delivers an uncaught failure to its single
entry point — an interpreter's top-level `except`, an engine's exception slot,
a rejection tracker — reports it over `feedback.report-error` with the class
the failure carries: a failed gg call's own code, an unknown name, or anything
else the program threw. The turn is a `program_fault`, and an uncaught failed
call is `program_api_error` on every such arm, whichever language it was
written in. Reporting is not interception: nothing catches the throw to
describe it, the runtime's own rendering is what is reported, and no guest may
build a catch chain to type a failure it would otherwise have died of. Only a
guest whose runtime kills the program before any entry point can see the throw
lets it die as a trap, and then the runtime's words reach the model from
standard error.

A `sandbox_limit` is therefore reserved for a ceiling gg imposed or a real
wasmtime trap: the execution timeout, the memory cap, a store killed by a
runtime gg does not hear from. An API failure a program did not catch is never
one, and a guest that can report it and instead dies is a defect.

The location is the model's own, because the text that compiled is the text the
model wrote and the text the next prompt carries. gg may resolve a location
through a source map, which is a mechanism the toolchain maintains and the
compiler emits. An arm that arrives at a line number by arithmetic of its own is
reporting a program other than the one the model sees.

Every error a model reads names what went wrong and, where the language reported
one, where it went wrong. That is what a turn spent on a failure buys: a
diagnostic a model can act on. A message naming neither is tokens spent to say
that something happened.

### Trimming

A report may be shortened, and shortening is deletion. What the model reads is a
subsequence of what the compiler or the runtime emitted, and each trim closes by
counting what was dropped so a model can tell a bounded report from a whole one.

Trimming exists for the diagnostics that grow without carrying more meaning, C++
template instantiation traces above all. Reaching the same size by rewriting a
compiler's words would put gg's account of the failure in front of the
language's.

A line the runtime emitted that states nothing true is struck rather than
trimmed, and closes without a count. A stack frame carrying neither a name nor a
location, and a location a toolchain misattributed, are the two gg strikes. What
is left is the whole of what the runtime had to say, so a count there would tell
a model there is more to read when there is not. Each strike states at its own
site what it removes and why it is untrue.

A frame in code the model cannot open is struck and counted: a frame inside
gg's own SDK, or in a line a compiler emitted that no source map resolves. What
survives names a file the model wrote or a library its program compiled
against, and the count under it says how many frames were in neither.

## The system prompt

The prompt states what a model can neither find by searching the documentation
nor be told at the moment it matters: the shape of a reply in the agent's own
language, the module list, the message headings, the ending rule, and the facts
only this run's configuration answers.

One section carries what is specific to the arm, in no more than two paragraphs,
and that bound is what lets every arm share one prompt. Everything else a model
needs reaches it the way the rest of the surface does: through a brief the
opening turn placed in the window, a documentation view it opened, or the
diagnostic its own program earned.

## The opening turn

Every agent in this mode whose configured
[opening turn](/gg/responses-as-code/views/#the-opening-turn) names anything it
holds opens with a turn gg wrote in the protocol's own shape, a `submit_program`
call carrying the program acknowledged the way the model's own submissions are —
with the id the [program library](/gg/program-library/) issued it, or the fixed
`ok` when the agent keeps no library — and gg runs that program. What the window
then holds is
what the program's own calls placed there, so the model's first example of a
well-formed reply is one that provably ran. The result may be cached across
the agents of a run, keyed by the language and the source.

A synthesized program that fails to compile or fails to run is gg's own defect
and ends the run. A model handed a broken example as its model of a valid reply
is worse off than one handed no example at all.
