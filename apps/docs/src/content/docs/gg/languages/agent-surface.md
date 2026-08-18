---
title: "The agent-facing surface"
---

Every arm presents gg's capabilities to a model as functions in its own
language. The spelling belongs to the language. The rules on this page hold in
every arm.

## Call shape

- A capability is a function the program imported. The import is a line the
  model wrote, and a name gg offers is reachable from the line after it.
- A capability is reached through a qualified name. A module path, a type or an
  import qualifies every call.
- Every call is synchronous. Nothing returns a promise, a future or a
  coroutine. The sandbox is linked and driven synchronously, and no guest
  carries an event loop.
- A parameter with a fixed set of values takes a typed value. An enum member is
  a name the language either has or does not.
- Arguments and results are typed values rather than JSON documents. A program
  reads a result's fields directly, and hand-assembles nothing to make a call.
- Required arguments are positional, and optional arguments follow the
  language's own idiom. TypeScript takes a trailing options object and Python
  takes keyword arguments. The SDK bridges its idiom onto the wire.

An arm whose surface is less typed than another's makes a cross-language
comparison a measurement of the surface rather than of the language.

## The SDK

Each arm's SDK is written by hand, reads as idiomatic code in its own language,
and is the whole of what the model sees. It bridges that idiom onto the WIT
wire. Generated code belongs one layer down, in the WIT bindings under the SDK.
The hand-written layer above them stays thin: it validates the argument shapes
the wire cannot express, maps the wire's `result<T, api-error>` onto the
language's failure idiom, and gives every function the shape its language would
give it.

## Call dispatch

A program calls the SDK, the SDK lowers the call through its generated WIT
bindings, and the host receives a typed function on the membrane.
`crates/gg/wit/gg-sandbox.wit` is the contract, and the compiler guarantees a
WIT function cannot exist without a host implementation.

Every model-facing host function opens a recording bracket, which records the
call under gg's own identity and is the only source of the token a host function
needs to reach anything further. Every function that dispatches a gg tool then
funnels through one place, where the run's wall-clock deadline is honoured, the
ordered call record is kept, and a failed outcome becomes a typed `api-error`.
The three session endings, the documentation lookups, four of the five view
calls and the program-library calls dispatch no tool and reach the host API
directly. The fifth, the call that opens a file view, dispatches a `read_file`
like any other read and is still recorded as itself. A host function cannot
trap, so a refusal, a spent budget and a failed call all arrive inside the
program as values the model can catch and work around.

## Gating at the boundary

Every arm's SDK is [static](/gg/languages/static-sdks/): every function it
declares is compiled, linked and callable in every program, whatever the run
enabled. A program can therefore write a call this run does not offer, and the
boundary decides it. The recording bracket asks one question, once, for every
model-facing call, tool or not: whether this agent's grant permits the binding
gg states for the operation. The documentation runtime filters a search with the
same predicate over the same grant, so what a model can be shown and what a
model can call cannot disagree.

A refused call returns the `unavailable` error class. Its message says the call
is not available and, where the agent has one, which call to make instead,
spelled in the language this program is written in. Its `operation` field
carries the operation's key, so a catch site branches on what failed rather than
on prose.
Every refusal is opened and closed as an API call and lands on the turn's refusal
roster under gg's own operation id, caught or uncaught, which is the record a
cross-arm count joins on. A new SDK exposes the whole surface, so that every arm
offers the same one.

## WASI and the guest context

A guest toolchain emits a component that imports the WASI p2 surface (`wasi:io`,
`wasi:filesystem`, `wasi:clocks`, `wasi:random`, `wasi:sockets`, `wasi:cli`)
whether or not a program touches any of it. gg therefore defines the whole
surface for every guest, unconditionally, and a language declares nothing about
it.

A component is affected only by the imports it declares, and gg's
`test-cabinet:gg/*` namespace does not overlap WASI's, so a guest pays nothing
for what it leaves out. The ECMAScript guest is a preview1 module through the
reactor adapter, so the adapter's whole surface is declared whether the engine
reaches it or not. The Ruby guest imports seven interfaces: `wasi:clocks`,
`wasi:random` and `wasi:io`, which is how a program reads the host clock, and
`wasi:cli/stderr`. The Python guest imports the whole surface, twenty-five of
them.
Each guest's list is asserted against its built artifact, because the list is
decided by how that arm's guest is built.

A program's context inherits the process environment and the network, and
preopens the container's root. A model reaching for its language's ordinary file
or clock APIs is writing the language it was told to write in. The one thing the
host withholds is stdout. gg's [telemetry](/gg/telemetry/overview/) stream is the
process's own stdout, so the guest's WASI context is built without it and a
guest's console output is rebound to gg's feedback channel.

Standard error is bound and captured on every arm. It is where a runtime writes
its dying words, so it is how a program's own failure reaches the model with the
runtime's own text and location. An arm's guest is built with the channel open,
and what a failing program wrote on it rides out with the failure gg reports.

## The signature catalogue

A catalogue is the whole of what a model is told about an arm's surface, and
every word of it is reflected out of documentation written on the declaration it
describes. A module's description comes from the comment on the module, an
argument's from the annotation on that argument, and a type member's from the
comment above the member.

That reflection is the language's own documentation generator reading the SDK's
sources. Each arm reaches for the tool its own users would, and reads the tool's
output rather than the sources. The import line for a symbol is the one thing an
arm may compose itself, and only where its generator does not report it.

Every entry is written in Doxygen's implicit structure, first line the brief and
the lines below it the detail. Each function documents the arguments it takes,
the failures it raises and the value it returns, and states the preconditions,
postconditions and invariants it holds.

Every registered arm emits schema 1: three provenance lines naming the schema,
the language it was generated for and what it was reflected out of, then four
sections. A catalogue must declare its schema, and gg refuses any number but 1.

| Section | What it carries |
| --- | --- |
| `modules` | Every module the surface is divided into, in the order a model meets them, each with its gg id, the path this arm spells it under, a brief and optional detail, and the line a program writes to bring it into scope. |
| `libraries` | The libraries a program may import, grouped as the artifact that decides the set groups them, each name spelled as a program must write it. Absent where an arm's programs get their runtime's standard library and nothing more. |
| `functions` | Every call a program can write, in one flat array. Each entry names the gg `operation` it binds, the `module` it is documented under, its `kind` and `receiver`, the `name` a program calls it by, its `fqn`, a brief with optional detail, its `signatures`, and its `returns` and `types` as resolved references. A second way into a capability the arm already binds carries `aliasOf`. |
| `types` | Every type a signature refers to: its `fqn` and `module`, its declaration, the prose explaining what it is for, a line per member, and the member functions an arm hangs off the type. |

An entry reaches its gate through the `operation` id it names, and gating is
gg's, so a catalogue carries no gate field and no capability id. A function
entry carries an array of signatures, which is how an arm expresses its own
idiom without changing what the function is: an optional argument is a Java
overload pair, a Kotlin default, a Python keyword argument and a TypeScript `?`.
An overload group is one entry with several signatures. Two entries sharing a
module, a receiver and a name are refused by the capability gate, because one
would shadow the other at the call site.

Each signature carries its arguments in order, and each argument carries its
name, its type, whether it is optional, whether it is passed by position or by
name, its default, its description, and the same again for the fields of a
structured argument written inline at the call site.

No catalogue is committed. Each is reflected as a step of building `crates/gg`,
so what a model is told about an arm comes out of the SDK sources of the
checkout that compiled the host telling it. What the build runs to do that is on
[registration](/gg/languages/registration/).

`scripts/gg-signatures.sh` is also what a person runs by hand, writing each
catalogue to `target/gg-signatures/`, because a reflector's bugs are invisible
in the SDK and obvious in the emitted JSON. It needs every arm's documentation
tool present. A model consumes a catalogue by searching the documentation and
opening a view of what it finds, filtered by the grant its agent holds.

## Names in gg's own prose

No name a model reads is written anywhere but on the declaration it describes.
gg's prompts name no catalogued function at all, because a model finds one by
searching. Three gates hold that line.

- No template names a function of the surface it describes, read off the
  template sources so that it covers a branch no test context renders. The
  code template serves every arm, so it is judged against every arm's spellings
  pooled and a language segment may name none of them.
- No template a code agent reads names a bare gg tool. A tool name is the right
  identity in the tool-calling prompt, and a program calls a function in a
  module.
- Every name a rendered prompt writes under one of gg's modules is one that
  module publishes. This reads what is rendered, for every language.

A prompt may name what a model could not find for itself: the module paths that
are the entry point into search, the language-level helpers no catalogue
carries, and the ending calls, which reach it through its context and are
spelled per language.

The same rule holds on the host side. No string literal in gg's own source
contains a catalogued `object.name` pair, with the mock model's canned fixtures
and the catalogue test fixture as the two exemptions.

On the Rust, Swift, C++ and C# arms, every example a model is shown is gathered
into one program and put through the arm's production prepare step, with the
same compiler and library set a model's own reply gets. That covers the
prompt's fenced blocks, the nothing-shown notice and the fenced blocks in that
arm's own catalogue. On a compiled arm an example that does not build costs the
whole turn.

## Prompt requirements

Each arm reaches the shared templates through a segment of its own, and a gate
renders every registered arm under every context fixture and reads what came
out. Four things must survive the rendering.

- Every required section. A copied template can lose a section whole, and a
  heading can survive with nothing under it.
- Every value the run configured: each roster entry's id and description, the
  assigned issue's id.
- The ending call, resolved through that arm's own catalogue rather than written
  down, so the sentence names something the model could type. It is the one
  catalogued call a prompt is allowed to name at all.
- Every rule a program is written under: that calls are synchronous, that a
  view is the only way to read data out and nothing a program prints reaches
  the model, that what a view holds arrives on the next turn, and that a failed
  program's ending is revoked.

A fifth is read the other way, off a context with every capability off: a
capability the agent was not granted appears nowhere. Both contexts are needed,
because the maximal one alone cannot show that an ungranted capability stays
out.

A sixth reads the language segments against each other. Every arm's render
carries that arm's segment, no arm's render carries another's, and every segment
stays within two paragraphs and a character bound. What an arm might have said
beyond them is said by the error that reports it, which is where the library set
an arm declares reaches its model.

Wording is not asserted. The gate reads names, numbers, identifiers and the one
term each rule cannot be stated without, so rewrapping a paragraph or rewriting
a sentence is ordinary work.

## The capability gate

Two arms may present different surfaces as long as a model can do the same
things with them. That is asserted for every registered language on every test
run. Each arm is held, one at a time, to gg's own operations table: every
model-facing operation gg has, what buys each one, and whether a program passes
it anything. Nothing is compared between arms.

- Gating, over the table alone. Every capability-bound operation names a real gg
  capability, paired with that operation's family; the ending operations are
  gg's three under the [roles](/gg/ending-a-session/) that own them; a view is
  gated exactly where it reads the workspace; the documentation search is bound
  to every program. This runs once rather than per arm.

  Nothing here is checked against gg's tool vocabulary. The two surfaces are
  independent and an agent has exactly one of them, so a rule holding the two
  name sets in bijection would assert a symmetry gg does not have: this surface
  is the strictly richer one, and a tool added for a tool-calling agent has no
  bearing on this table.
- Capability coverage, per arm. Every operation gg offers has exactly one
  canonical binding on every arm that is not excused; every operation an arm
  names is one gg has; every alias names an operation that arm canonically
  binds. A binding is identified by the arm's own module, kind, receiver and
  name, which names it in a complaint rather than requiring two arms to agree.
- The propagation rule. A helper added to one SDK is added to every other where
  applicable, and that judgement is written beside the operation, in gg, with a
  prose reason. An arm omitting a universal operation fails by name, and an
  exemption naming an arm that does bind it fails too. The rule ranges over
  operations, so a second spelling of a capability every arm binds needs no row.
- Whether an operation takes input at all, per arm against gg. A capability
  that needs a path needs one everywhere. A receiver counts as input, because on
  a method it is the input.
- That every spelling is one a program could write. A name; a signature that
  begins with it; one spelling per module and receiver; a description on every
  argument and every field of a structured one; a qualified name on every
  function; and every documented argument named by the signature that takes it.
  A notation with nowhere to put a parameter name is exempt from the last, which
  is still asked of the fields of a structured argument, since a type names
  those in every notation.
- That the prose and the names hold up. The register gate asks whether a brief
  is one line, closes its code spans and is written in the register gg chose.
  The name rule requires a declared type to be reachable and every reference to
  resolve.

The gate returns its complaints rather than asserting them, so it can be shown
to catch something: damaged catalogues prove the per-arm half, and damaged
operations tables prove the gating half, which is why the gate takes the table
as a parameter.

A fixture language, available only under `#[cfg(test)]`, offers every operation
gg has and offers them differently: one is filed under a module gg has no word
for, two are methods on the types they operate on, one is bound twice as an
alias, and every name is spelled another way. The gate accepts all of it, and
the test asserts the reshape is real. The fixture carries its own preparation
step, healing dialect and bootstrap program, and it has no wire id, so it can
never be configured, recorded or run, and no prompt segment is gated on it.
