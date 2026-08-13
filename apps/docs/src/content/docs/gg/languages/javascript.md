---
title: "JavaScript"
---

An agent on the JavaScript arm answers a turn by writing one JavaScript program.
gg parses the reply, erases any type annotations in it, and hands the stripped
source to the embedded ECMAScript guest, which evaluates it. Nothing reads the
program between the strip and the guest.

## Preparation

Preparation is a single in-process `oxc` pass over the reply, the same parse and
type-strip the [TypeScript arm](/gg/languages/typescript/) runs. It opens no
workspace and starts no process, so a JavaScript turn spends nothing on the host
beyond that pass.

The pass parses the reply as TypeScript source, refuses the shapes the sandbox
cannot run, erases the annotations, and prints the result. The printed source is
what crosses to the guest, as a string. The guest evaluates it as the body of a
function whose parameters are the names in scope, so a program's top-level
declarations are the function's locals.

Code modules on this arm are `.js` or `.ts` files. A module is prepared by the
same strip, under its own coordinates.

## Shared with the TypeScript arm

The two arms differ in whether gg type-checks a program before handing it over.
Everything else is required to be identical, and the seam's own gate holds the
arms to it:

- the evaluator is TypeScript's component bytes, reached through that arm's
  constant. This arm embeds no guest artifact of its own, and the two arms must
  serve the same bytes rather than two copies of one file;
- the signature catalogue carries the same declarations, entry for entry,
  including the type annotations;
- the preparation is TypeScript's, with the check absent;
- the healing dialect and the camelCase binding convention are the ECMAScript
  ones.

What this arm owns is its id, its display name, its own catalogue file, and its
own two prompt templates.

## Toolchain and build outputs

There is no toolchain on the turn path. No compiler runs, and the run image
installs nothing for this arm.

The guest artifact it serves, `typescript.component.wasm`, is built by
`crates/gg-sandbox-artifacts/typescript` with `componentize-js` over
`packages/gg-sandbox` and embedded in the gg binary.

Its signature catalogue is `javascript.signatures.json`, emitted into the
build's `OUT_DIR` by `packages/gg-sandbox/signatures.sh` and embedded from
there. That script emits this arm's catalogue and TypeScript's from one
reflection of one set of declarations, so the two cannot drift apart. Neither
file is committed. The host asserts on first use that the catalogue it parsed
declares this language.

## The SDK

The SDK is the guest package's hand-written TypeScript SDK. It is bound
statically: every module and every function is in scope in every program, and a
call the agent was not granted fails as a host refusal rather than as a missing
name. The
shared rules for that surface are on
[the agent surface page](/gg/languages/agent-surface/).

The spellings are ordinary JavaScript. A module is a property of `gg`
(`gg.files`, `gg.views`), a function is camelCase, optional arguments are a
trailing options object, a call returns its value directly, and a failure is a
thrown `ToolError` carrying `tool`, `code` and `message`. Type names are
documentation only. `ToolError` is the one gg name bound as a value, so
`error instanceof ToolError` is the shape that reads a failure.

A program may write type annotations of its own. They are erased before it runs.

## Checker

This arm declares no checker. A JavaScript turn therefore reports no compile
time at all: the outcome's compile field is absent rather than zero.

## Failures

Preparation refuses a reply in three bands, all of them model-facing:

- Syntax: the parser's diagnostics, at the model's own line and column with the
  offending source line quoted.
- Semantic: ECMAScript's early errors, such as a duplicate binding, located the
  same way.
- Unsupported: module syntax (`import`, `export`, a dynamic `import()`),
  top-level `await`, and bracket nesting past the parser's cap. Each is a
  sentence naming what to change rather than a located diagnostic: the top-level
  `await` message tells the model the sandbox is synchronous and to remove the
  `await`.

A refusal is what the model reads, and the model writes another program. The
shared taxonomy these bands belong to is on
[the compilation page](/gg/languages/compilation/).

Everything else surfaces at run time. The SDK validates the argument shapes the
wire cannot express, such as an options object that arrived as a bare number, an
`offset` outside the `u32` range, or a list argument that is not an array, and
raises a `ToolError` naming what it wanted. Any other mistyped argument reaches
the generated bindings and raises their `TypeError`. Either is reported at the
model's own coordinates. An uncaught throw ends the turn there, so the
statements after it do not run.

## Prompt dialect

The arm's two templates are `system-code.javascript.hbs` and
`code-nothing-shown.javascript.hbs`. They must state:

- the whole response is processed as a JavaScript program, with no prose or
  Markdown around it;
- views are the only way a program's data reaches the model. Nothing
  `console.log` writes is readable, and a returned value is discarded;
- every function is synchronous, so a program uses no `await` and treats no
  return value as a promise;
- signatures are written with type annotations, which a program may use or leave
  off, and any it uses are erased before it runs;
- the standard library is ES2022;
- type names are documentation and do not exist while a program runs;
  `ToolError` is the one gg name bound as a value, and `tool` and `code` are its
  fields;
- gg's surface needs no import: every module is reachable through `gg`, and the
  path the documentation is keyed by is the path a program writes;
- a few short names, `gg`, `ToolError` and `lib` among them, are the evaluated
  function's parameters, so redeclaring one is a `SyntaxError` that ends the
  turn before the program runs;
- every function is bound whatever the run enabled, so a call the agent was not
  granted runs and fails as a refusal.

The templates describe a program that is evaluated as written. Neither carries a
section about a compile step.
