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

Code modules on this arm are `.js` files, handed over the same way. What a module
offers is what its top level exports.

## The import a program writes

`import * as gg from "gg";` reaches the whole surface, and every call is then
written out in full: `gg.files.readFile(path)`. That is the name a documentation
view is filed under, the name a search hit carries, and the name the system
prompt quotes. Every module's catalogue entry states that line.

Two other specifiers resolve, and a program may write either. `import { files }
from "gg";` reaches one family; `import * as csvTools from "lib:csvTools";`
reaches a [code module](/gg/modules/) the agent loaded. The full set is on
[the ECMAScript guest](/gg/languages/ecmascript-guest/).

## The pair with the TypeScript arm

The pair exists to measure what compiling a program before running it is worth,
so everything but the compiler is held equal by the seam's own gate:

- both arms evaluate a module in one guest artifact, reached through one
  constant;
- the signature catalogue carries the same declarations, entry for entry,
  including the type annotations;
- the healing dialect, the camelCase binding convention, the import line and
  every program gg synthesizes are shared.

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

A program fails by capture: nothing catches its throw to describe it, the engine
writes its own rendering to standard error, and gg puts that in front of the trap
that follows. What the model reads is the engine's account of its own failure,
with every frame located in `program.js`, which is the model's own file. There is
no map between the two and no arithmetic anywhere, because the bytes that ran are
the bytes the model sent.

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

Each entry of the module list beside it carries `import * as gg from "gg";` as
the line that brings that module into scope.

The arm names no [checker](/gg/languages/compilation/), so nothing in the
prompt describes a compile step.

Source gg synthesizes for this arm is the TypeScript arm's, written in the same
idiom and opening with that same import line, since a model reads it as an
example of its own output.
