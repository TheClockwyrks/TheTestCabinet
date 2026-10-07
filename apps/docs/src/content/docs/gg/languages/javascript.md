---
title: "JavaScript"
---

An agent on the JavaScript arm answers a turn by writing one JavaScript module.
The reply's own bytes are what the
[ECMAScript guest](/gg/languages/ecmascript-guest/) declares as `program.js` and
evaluates. Nothing reads the program between the reply and the guest.

## Preparation

There is none beyond handing the bytes over. This arm opens no workspace, starts
no process and parses nothing on the host, so a JavaScript turn spends nothing at
all before its program runs.

What the arm accepts is what the guest's engine accepts, because that engine is
the first thing to read a program. A construct the engine does not have is its
own `SyntaxError`, at the line the model wrote it on, and nothing runs. The
engine anchors a syntax error at the start of the statement carrying it.

## The import a program writes

A module is reached by a named import off the specifier the whole surface is
published under: `import { files } from "gg";` binds that module alone, and every
module's catalogue entry states its own such line. The call is then written
`files.readFile(path)`, which is the name a documentation view is filed under,
the name a search hit carries and the name the system prompt quotes, with its
leading `gg.` dropped. The language segment of the system prompt states that one
difference.

Two other specifiers resolve, and a program may write either. `import * as gg
from "gg";` binds every module under one namespace; `import * as csvTools from
"lib:csvTools";` reaches a [code module](/gg/modules/) the agent loaded. The full
set is on [the ECMAScript guest](/gg/languages/ecmascript-guest/).

## Code modules

A code module on this arm is a `.js` file, handed to the guest as its author
wrote it and declared there as its own module, under its own specifier, exactly
as the SDK's modules are.

A module is supplied to a program the way gg's SDK is, by making the specifier
resolve. That declares no name. The line the program writes is
`import * as csvTools from "lib:csvTools";`, and one export is then reached as
`csvTools.<name>`. A program that omits the line and writes
`csvTools.parse(text)` gets the engine's own `ReferenceError` naming `csvTools`,
at the program's own line, with nothing having run.

The key is the skill's or memory's name in `camelCase`, so `csv-tools` is reached
as `lib:csvTools`. Every separator joins the next word, a name of nothing but
separators becomes `module`, and a leading digit is prefixed.

What the module offers is what its top level exports, and each export is
documented from the declaration its author wrote. The return and parameter types
a documentation view opens beside a function are empty here, because a JavaScript
declaration writes none. Reading them is what the annotations on
[the other arm](/gg/languages/typescript/) buy.

## The pair with the TypeScript arm

The pair exists to measure what compiling a program before running it is worth,
so everything but the compiler is held equal by the seam's own gate:

- both arms evaluate a module in one guest artifact, reached through one
  constant;
- the signature catalogue carries the same declarations, entry for entry,
  including the type annotations;
- the camelCase binding convention, the import line and every program gg
  synthesizes are shared.

What this arm owns is its id, its display name, its own catalogue file, and its
own segment of the shared prompt templates.

The type annotations in the catalogue's signatures are documentation of what a
call takes and hands back. Writing one in a program is TypeScript, which is the
[other arm](/gg/languages/typescript/).

## Toolchain and build outputs

There is no toolchain on the turn path. No compiler runs, and the run image
installs nothing for this arm.

Its signature catalogue is `javascript.signatures.json`, emitted into the
build's `OUT_DIR` by `packages/gg-sandbox/signatures.sh` and embedded from
there. That script emits this arm's catalogue and TypeScript's from one
reflection of one set of declarations, so the two cannot drift apart. Neither
file is committed. The host asserts on first use that the catalogue it parsed
declares this language.

## The SDK

The SDK is the guest package's hand-written TypeScript SDK, which the guest bakes
in as the modules its loader resolves. It is bound statically: every module and
every function resolves in every program that imports it, and a call the agent
was not granted fails as a host refusal rather than as a missing name. The shared
rules for that surface are on
[the agent surface page](/gg/languages/agent-surface/).

The spellings are ordinary JavaScript. A module is a property of the imported
`gg` namespace (`gg.files`, `gg.views`), a function is camelCase, optional
arguments are a trailing options object, a call returns its value directly, and a
failure is a thrown `ApiError` carrying `operation`, `code` and `message`.

## Checker

This arm declares no checker. A JavaScript turn therefore reports no compile
time at all: the outcome's compile field is absent rather than zero.

## Failures

Everything is a run-time failure, because nothing on the host reads a program.

A program fails by capture: nothing catches its throw to describe it. The
engine's own rendering is reported to gg over `feedback.report-error` with the
failure's class, so the turn is a `program_fault` — `program_api_error` for an
uncaught `ApiError`, `program_unknown_name` for a `ReferenceError`,
`program_throw` for anything else — and never a `sandbox_trap`. What the model
reads is the engine's account of its own failure, with every frame located in
`program.js`, which is the model's own file, and the SDK's own frames struck and
counted. There is no map between the two and no arithmetic anywhere, because
the bytes that ran are the bytes the model sent.

Which construct the engine carries a position for, and when a rejected promise
counts as a failure, are the guest's own rules and are on
[the ECMAScript guest](/gg/languages/ecmascript-guest/) page.

The SDK validates the argument shapes the wire cannot express, such as an options
object that arrived as a bare number, an `offset` outside the `u32` range, or a
list argument that is not an array, and raises an `ApiError` naming what it
wanted. Any other mistyped argument reaches the generated bindings and raises
their `TypeError`. An uncaught throw ends the turn there, so the statements after
it do not run.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`javascript`, and `code-nothing-shown.hbs` through a clause naming
`console.log`. The segment states:

- the reply is evaluated verbatim as a whole JavaScript module, and top-level
  statements run in the order they were written;
- the type names a signature carries are documentation.

Each entry of the module list beside it carries its own named import as the line
that brings that module into scope.

The arm names no [checker](/gg/languages/compilation/), so nothing in the
prompt describes a compile step.

Source gg synthesizes for this arm is the TypeScript arm's, written in the same
idiom and opening with that same import line, since a model reads it as an
example of its own output.
