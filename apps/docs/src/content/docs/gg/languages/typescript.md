---
title: "TypeScript"
---

TypeScript is gg's default program language and a checked arm. A model's reply
is type-stripped to JavaScript in process, type-checked with `tsc`, and
evaluated by an embedded `componentize-js` guest. A program that does not
type-check is not executed.

This arm does not keep the [invariants](/gg/responses-as-code/invariants/) yet,
and this page states what it does today. The strip prints the parsed program
back out, so a runtime diagnostic is located in gg's copy rather than in the
text the model sent, and the guest evaluates that copy as the body of a function
whose parameters carry `gg`, `ToolError` and `lib` into scope with no line the
model wrote.

## Preparation

Preparation is two passes over the reply, in this order.

The strip parses the reply with `oxc` and erases the types, in process, in ~0.2
ms. Its output is the JavaScript the guest evaluates. This pass also produces
the located syntax errors, the ECMAScript early errors and the refusals below.

The check runs `tsc` over the model's *unstripped* source, against the
declarations described below. A program it rejects is not evaluated. The model
is handed the compiler's diagnostics at the coordinates of the text it wrote.

The cheap pass runs first, so a program with a syntax error costs a parse rather
than a compiler. The two together take ~91 ms against a representative program
in a warm process, and the first check of a process pays ~450 ms. This arm
declares that its preparation compiles, so both passes are timed on the failing
path as well as the succeeding one and reach the run as `compileMs`.

The guest evaluates a program as the body of a function, so a top-level `return`
ends it and every statement after it is dead. That is legal JavaScript, nothing
refuses it, and the turn is recorded as one that worked. The reply that lands in
it is a model that drafted a second program and pasted it after the first.

## Refusals in the strip

Module syntax (`import`, `export`, `export … from`, a dynamic `import()`) and
top-level `await` are refused with a sentence naming what to change, because the
guest has no loader and no event loop. Nesting deeper than 200 bracket levels is
refused, which keeps an unguarded recursive-descent parser inside its stack. A
program is never refused for its length: the parse runs on a stack sized from
the length of the source, so an arbitrarily long reply is transpiled in full.

## The guest

`typescript.component.wasm` is a componentized JavaScript engine, ~13.4 MB,
built from `packages/gg-sandbox` with a pinned `componentize-js` and embedded in
the gg binary so that a single copied file carries everything a run container
needs. The component is compiled at most once per process. The trust boundary
above it is the typed WIT membrane, and the component is built with no network
and no module system, so a program reaches gg through that membrane alone.

The JavaScript and PureScript arms evaluate their prepared JavaScript in these
same bytes, reached through this arm's constant rather than through a second
embedding, and that sharing is declared in the seam's exemption table. The Java
and Kotlin arms are declared there too while they still compile to JavaScript;
[program languages](/gg/languages/overview/) states the wasm component each of
them is moving to.

## The toolchain

The check runs `node` over the embedded `typescript.tsc.js`, taking the
interpreter from `TCAB_GG_NODE` and otherwise from `PATH`. The base run image
ships Node, so this arm installs nothing into any image.

Warm-up writes the ~6.7 MB of checker inputs once per process into a
content-keyed shared directory, by rename, read-only from then on. It is
idempotent and best effort: a failure there is dropped, because the first check
makes the same attempt and reports a toolchain failure properly.

Each check runs in its own preparation workspace, holding that check's own
`tsconfig.json` and `program.ts`, and exceeding 60 seconds is a toolchain
failure. Concurrent checks share one `NODE_COMPILE_CACHE` directory, which holds
Node's bytecode for the compiler and can change no verdict.

## Build outputs

Nothing below is committed. Every file is cut on the build that embeds it, so
the pinned `typescript` a program is judged by and the pinned `typescript` its
catalogue was emitted with are one release by construction.

| Artifact | What it is | Built by |
| --- | --- | --- |
| `typescript.component.wasm` | The guest, embedded in the binary. | `crates/gg-sandbox-artifacts/typescript`, running `packages/gg-sandbox/build.sh` |
| `typescript.tsc.js` | The compiler the check runs. | the same `build.sh` |
| `typescript.lib.d.ts` | The ES2022 standard library, 57 `lib.*.d.ts` files concatenated so one open replaces 57. | the same `build.sh` |
| `typescript.globals.d.ts` | `console`, `lib`, `performance` and `crypto`. | the same `build.sh` |
| `typescript.checker.json` | Which release the above are. | the same `build.sh` |
| `typescript.signatures.json` | This arm's signature catalogue. | `crates/gg/build.rs`, running `packages/gg-sandbox/signatures.sh` |

The catalogue is parsed once per process and asserted to carry this arm's own
language id. One generated under another stem panics rather than reaching a
model as a prompt describing a sandbox nobody has. The same package emits the
JavaScript arm's catalogue from the same declarations under a second id.

## The SDK and the catalogue

The SDK is hand-written in `packages/gg-sandbox/src` and reads as idiomatic
TypeScript: `camelCase` names, required arguments positional, optional arguments
in a trailing options object, and failures thrown as `ToolError`. It maps that
idiom onto the WIT wire, and it validates the argument shapes the wire cannot
express, such as an options object that arrived as a bare number, a negative
`offset` that would wrap, or an absent `list<T>` field. The rules every arm's
surface obeys are on [the agent surface](/gg/languages/agent-surface/).

The catalogue is reflected out of those same declarations by `tsc`'s declaration
emit, so the briefs the
[opening turn](/gg/responses-as-code/views/#the-opening-turn)'s search listings
carry, the signatures a documentation view answers with, and the signatures the
check enforces all come off one set of declarations.

## The type check

`tsc` runs in strict mode with `noLib`, against three declaration files
assembled once per process:

- `typescript.lib.d.ts`, named explicitly. The standard library is ES2022 and
  nothing else, so `document`, `fetch` and the timers are compile errors rather
  than surprises at run time.
- `gg.d.ts`, generated from this arm's catalogue: one ambient namespace per
  capability module carrying that module's types and functions, plus the bare
  aliases the shim binds. Nothing in it is hand-written.
- `typescript.globals.d.ts`, the names a program reaches that no SDK declaration
  covers.

`gg.d.ts` declares the whole surface, including the functions this agent was not
granted. The SDK is static, so those functions are bound and fail as
themselves at run time, and a checker that refused them would refuse programs
that run. A verdict must also depend on the program alone, because the same text
is checked as a turn's program, as a skill's on-use script and as the code half
of a memory. A code module is checked as a module, in its own coordinates.

`tsc` has no notion of a program that is a function body, so the source is
wrapped in a function declaration before it is checked. Every diagnostic
therefore arrives exactly one line low and is renumbered back by one, leaving
the message, the column and the indented continuation lines untouched.

## Failures

The strip's failures are the model's own text: syntax errors from the parser,
early errors as a semantic failure, a refused feature or an over-nested program
as unsupported. The first two are rendered in gg's located form against the
reply's own coordinates, with the offending source line quoted; a refusal is a
sentence naming what to change and carries no coordinates.

The check's verdict is decided on whether `tsc` produced a diagnostic about the
file gg gave it. A diagnostic located in the program is a compile failure.
Diagnostics located only in gg's generated declarations are a lowering failure,
which is gg's own defect: it reaches the operator rather than the model and ends
the run. A non-zero exit with no diagnostic at all is a toolchain failure,
as is a missing `node`, a `node` killed by a signal, and the 60 second timeout.
A toolchain failure tells the model its program was not run and carries no
diagnostic, while the operator gets the exit status and the stderr tail.

Both diagnostic bands are bounded at 8 diagnostics. A diagnostic is a group here
rather than a line: `tsc` runs with `--pretty false`, which writes the message
unindented and indents whatever elaborates it. Renumbering happens before the
bound, so what the bound keeps is byte-for-byte what the compiler wrote. The
shared taxonomy these bands belong to is on
[compilation](/gg/languages/compilation/).

## Code modules

A code module is an ordinary TypeScript file with `export`s, accepted as `.ts`
or `.js`. Preparation parses it as a module, collects the exported names, blanks
the `export` keywords with spaces so every later byte keeps its offset, runs the
ordinary program pipeline, and appends one `return` of the namespace. A module
that exports nothing exports everything it declares. Type-only declarations are
not exported.

A module binds at `lib.<key>` under a `camelCase` name, so `csv-tools` becomes
`lib.csvTools`. Every separator joins the next word, a name of nothing but
separators becomes `module`, and a leading digit is prefixed, so the binding
always parses as an identifier.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`typescript`, and `code-nothing-shown.hbs` through a clause naming
`console.log`. Neither names a catalogued function. The segment states:

- the reply is a sequence of top-level statements, and a `return` at that level
  ends the program;
- a failed call throws a `ToolError`, which a `catch` narrows to before reading
  it, since a caught error is `unknown`;
- optional arguments are the fields of a trailing options object, and every
  module is already in scope under `gg`.

The arm names `tsc` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled in strict mode before it runs and one
that fails to type-check is not executed.

Source gg synthesizes for this arm is written in the same idiom, in the plainest
form that does the job, since a model reads it as an example of its own output.
A file view is one call with an optional trailing options object carrying
`offset` and `limit`; a set of documentation views is a `const` array of names
with a `for…of` over it; the bootstrap program is a sequence of top-level
statements. Paths and names are rendered through JSON so a quote or a backslash
cannot produce a program that will not parse.

## Healing dialect

Response healing reads a reply lexically, never with a parser, because it runs
on text that is not yet known to be a program. This arm's dialect answers which
fence tags mark the program, which lines are code, which are prose, and which
bytes are string or comment text. The JavaScript spellings of the fence tags are
recognised alongside the TypeScript ones, since the strip accepts either, and
the JavaScript arm reads its replies with this same dialect.
