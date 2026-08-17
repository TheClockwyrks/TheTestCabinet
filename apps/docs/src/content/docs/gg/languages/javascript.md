---
title: "JavaScript"
---

An agent on the JavaScript arm answers a turn by writing one JavaScript program.
gg parses the reply, erases any type annotations in it, and hands the stripped
source to the embedded `componentize-js` guest, which evaluates it. Nothing reads
the program between the strip and the guest.

This arm does not keep the [invariants](/gg/responses-as-code/invariants/) yet,
and this page states what it does today. The strip prints the parsed program back
out, the guest evaluates that copy as the body of a function whose parameters
carry `gg`, `ToolError` and `lib` into scope with no line the model wrote,
`import` is refused in writing, and a reported line is reached by arithmetic over
a calibration throw. Moving the arm onto the
[ECMAScript guest](/gg/languages/ecmascript-guest/), which the
[TypeScript arm](/gg/languages/typescript/) already runs on, is what closes all
four.

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

## The pair with the TypeScript arm

The pair exists to measure what compiling a program before running it is worth,
so what the two arms share is pinned by the seam's own gate:

- the signature catalogue carries the same declarations, entry for entry,
  including the type annotations;
- the healing dialect and the camelCase binding convention are the ECMAScript
  ones.

They differ in more than the compiler until this arm converts, and a study across
them has to say so: the TypeScript arm compiles the model's own file and
evaluates a module in the ECMAScript guest, and this arm re-prints the program
and evaluates it as a function body in the guest below. The seam's gate records
that difference and fails when it closes.

What this arm owns is its id, its display name, its own catalogue file, its guest
component, and its own segment of the shared prompt templates.

## Toolchain and build outputs

There is no toolchain on the turn path. No compiler runs, and the run image
installs nothing for this arm.

The guest artifact, `typescript.component.wasm`, is ~13.4 MB because it embeds a
JavaScript engine. It is built by `crates/gg-sandbox-artifacts/typescript` with
`componentize-js` over `packages/gg-sandbox` and embedded in the gg binary. The
[PureScript arm](/gg/languages/purescript/) serves these same bytes, declared as
a share in the seam's exemption table.

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

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`javascript`, and `code-nothing-shown.hbs` through a clause naming
`console.log`. The segment states:

- the reply is a sequence of top-level statements, and a `return` at that level
  ends the program;
- a failed call throws a `ToolError`, the one gg name bound as a value, whose
  `tool` and `code` an `instanceof` check reaches;
- optional arguments are the fields of a trailing options object, and every
  module is already in scope under `gg`.

The arm names no [checker](/gg/languages/compilation/), so nothing in the
prompt describes a compile step and nothing describes a call that compiles and
then fails on a capability the run withheld.

Source gg synthesizes for this arm is a bare qualified call and no import line,
because that is what this guest evaluates: gg's surface is bound into a program's
scope here, and an import would be refused.
