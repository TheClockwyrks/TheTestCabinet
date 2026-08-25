---
title: "TypeScript"
---

TypeScript is a checked arm. A model's reply is a whole TypeScript module. `tsc`
reads it against the SDK's own declarations and either rejects it, in which case
nothing runs, or emits the JavaScript the
[ECMAScript guest](/gg/languages/ecmascript-guest/) evaluates.

## Preparation

One `tsc` invocation does both halves. It compiles `program.ts`, which carries
the reply and nothing else, and emits `program.js` beside it with `tsc`'s own
source map inlined and the reply embedded in that map.

A program the compiler rejects never reaches the guest. The model is handed the
compiler's diagnostics at the coordinates of the text it sent, with nothing
renumbered.

This arm declares that its preparation compiles, so the compile is timed on the
failing path as well as the succeeding one and reaches the run as `compileMs`. A
representative program measures ~91 ms in a warm process; the first compile of a
process pays ~450 ms materialising the compiler and filling Node's compile cache.

## The program is the model's, and so are its locations

The bytes gg compiles are the bytes the model sent: no prologue, no wrapper, no
appended line. Every SDK name a program uses comes from an `import` the program
wrote, and every top-level name is the program's own.

The bytes that *execute* are `tsc`'s emission, because types have to be erased
and `tsc` erases them by re-printing. That is the position every compiled arm is
in. What makes it legitimate is the source map: a frame the engine reports
against `program.js` is read back through `tsc`'s own map into the line and
column of `program.ts`, and gg computes no line number of its own. See
[invariants](/gg/responses-as-code/invariants/).

The map travels inside the emitted source rather than beside it, so it reaches
every consumer the source reaches, including a script prepared at a skill's read
and run several turns later.

## The import a program writes

A module is reached by a named import off the specifier the whole surface is
published under: `import { files } from "gg";` binds that module alone, and every
module's catalogue entry states its own such line. The call is then written
`files.readFile(path)`, which is the name a documentation view is filed under,
the name a search hit carries and the name the system prompt quotes, with its
leading `gg.` dropped. The language segment of the system prompt states that one
difference, so a name a model reads is one edit from compiling.

Two other specifiers resolve, and a program may write either. `import * as gg
from "gg";` binds every module under one namespace; `import * as csvTools from
"lib:csvTools";` reaches a [code module](/gg/modules/) the agent loaded. The full
set is on [the ECMAScript guest](/gg/languages/ecmascript-guest/).

## The guest

The arm evaluates programs in the ECMAScript guest, ~1.2 MB, embedded in the gg
binary. The component is encoded and compiled at most once per process.

## The toolchain

The compile runs `node` over the embedded `typescript.tsc.js`, taking the
interpreter from `TCAB_GG_NODE` and otherwise from `PATH`. The base run image
ships Node, so this arm installs nothing into any image.

Warm-up writes the ~6.7 MB of compiler inputs once per process into a
content-keyed shared directory, by rename, read-only from then on. It is
idempotent and best effort: a failure there is dropped, because the first compile
makes the same attempt and reports a toolchain failure properly.

Each compile runs in its own preparation workspace, holding that compile's own
`tsconfig.json`, `program.ts` and the `program.js` written beside it, and
exceeding 60 seconds is a toolchain failure. Concurrent compiles share one
`NODE_COMPILE_CACHE` directory, which holds Node's bytecode for the compiler and
can change no verdict.

## Build outputs

Nothing below is committed. Every file is cut on the build that embeds it, so the
pinned `typescript` a program is judged by and the pinned `typescript` its
catalogue was emitted with are one release by construction.

| Artifact | What it is | Built by |
| --- | --- | --- |
| `ecmascript.core.wasm` | The guest's core module, encoded into a component in gg's own process. | `crates/gg-sandbox-artifacts/typescript`, running `packages/gg-sandbox/build.sh` |
| `typescript.tsc.js` | The compiler the arm runs. | the same `build.sh` |
| `typescript.lib.d.ts` | The ES2022 standard library, 57 `lib.*.d.ts` files concatenated so one open replaces 57. | the same `build.sh` |
| `typescript.globals.d.ts` | The globals no SDK declaration covers. | the same `build.sh` |
| `typescript.checker.json` | Which release the above are. | the same `build.sh` |
| `typescript.signatures.json` | This arm's signature catalogue. | `crates/gg/build.rs`, running `packages/gg-sandbox/signatures.sh` |

The catalogue is parsed once per process and asserted to carry this arm's own
language id. One generated under another stem panics rather than reaching a model
as a prompt describing a sandbox nobody has. The same package emits the
JavaScript arm's catalogue from the same declarations under a second id.

## The SDK and the catalogue

The SDK is hand-written in `packages/gg-sandbox/src` and reads as idiomatic
TypeScript: `camelCase` names, required arguments positional, optional arguments
in a trailing options object, and failures thrown as `ApiError`. It maps that
idiom onto the WIT wire, and it validates the argument shapes the wire cannot
express, such as an options object that arrived as a bare number, a negative
`offset` that would wrap, or an absent `list<T>` field. The rules every arm's
surface obeys are on [the agent surface](/gg/languages/agent-surface/).

The catalogue is reflected out of those same declarations by `tsc`'s declaration
emit, so the briefs the
[opening turn](/gg/responses-as-code/views/#the-opening-turn)'s search listings
carry, the signatures a documentation view answers with, and the signatures the
compiler enforces all come off one set of declarations. A declaration's `@throws`
tags are the error types it declares, and the catalogue carries them as that
function's `throws` list.

## What a program is compiled against

`tsc` runs in strict mode with `noLib`, against three declaration files assembled
once per process:

- `typescript.lib.d.ts`, named explicitly. The standard library is ES2022 and
  nothing else, so `document`, `fetch` and the timers are compile errors rather
  than surprises at run time.
- `gg.d.ts`, generated from this arm's catalogue: one ambient module per
  specifier the guest's loader resolves, in the shape the loader resolves it.
  Nothing in it is hand-written.
- `typescript.globals.d.ts`, the names a program reaches that no SDK declaration
  covers, authored beside the guest that installs them.

`gg.d.ts` declares the whole surface, including the functions this agent was not
granted. The SDK is static, so those functions are bound and fail as themselves
at run time, and a compiler that refused them would refuse programs that run.

It declares a code module as the wildcard `lib:*`, so a `lib:` import is checked
and what it binds is `any`. The reason is under [code modules](#code-modules).

## Failures

A program that does not compile is a compile failure carrying `tsc`'s own
diagnostics. There is no separate syntax band on this arm: the compiler is the
whole preparation, and prose is rejected exactly as a mistyped program is.

Diagnostics located only in gg's generated declarations are a lowering failure,
which is gg's own defect: it reaches the operator rather than the model and ends
the run. A non-zero exit with no diagnostic at all is a toolchain failure, as is
a missing `node`, a `node` killed by a signal, and the 60 second timeout. A
toolchain failure tells the model its program was not run and carries no
diagnostic, while the operator gets the exit status and the stderr tail.

Both diagnostic bands are bounded at 8 diagnostics. A diagnostic is a group here
rather than a line: `tsc` runs with `--pretty false`, which writes the message
unindented and indents whatever elaborates it. Below the bound what reaches the
model is the string `tsc` printed and nothing else. The shared taxonomy these
bands belong to is on [compilation](/gg/languages/compilation/).

A program that fails at run time fails by capture: nothing catches its throw to
describe it. The engine's own rendering — name, message, stack and the
properties the thrown error carries — is reported to gg over
`feedback.report-error` with the failure's class, and the turn is filed as a
`program_fault`: an uncaught `ApiError` is `program_api_error`, a
`ReferenceError` is `program_unknown_name`, anything else is `program_throw`.
What the model reads is its own language's account of its own failure, with the
frames read back into `program.ts` through the map `tsc` emitted.

A stack the SDK raised from carries the SDK's own frames above the program's,
under the `sdk:` specifiers the guest resolves for its own modules alone. Those
frames are struck and counted before the report leaves the guest, so what the
model reads locates the failure in its own file and names the SDK only in the
count. Which construct the engine carries a position for, and when a rejected
promise counts as a failure, are the guest's own rules and are on
[the ECMAScript guest](/gg/languages/ecmascript-guest/) page.

## Code modules

A code module is an ordinary TypeScript file with `export`s, accepted as `.ts` or
`.js`, compiled by the same `tsc` a program is, in an invocation of its own and
in its own coordinates. It stays a separate artifact: the guest declares it as
its own module, under its own specifier, exactly as it declares the SDK's
modules.

A module is supplied to a program the way gg's SDK is, by making the specifier
resolve. That declares no name. The line the program writes is
`import * as csvTools from "lib:csvTools";`, and one export is then reached as
`csvTools.<name>`. A program that omits the line and writes
`csvTools.parse(text)` is refused by `tsc` for an undeclared name, exactly as a
program that writes `gg.files.readFile` without importing `gg` is.

The key is the skill's or memory's name in `camelCase`, so `csv-tools` is reached
as `lib:csvTools`. Every separator joins the next word, a name of nothing but
separators becomes `module`, and a leading digit is prefixed, so the key is
always a name a program can bind an import to.

What the module offers is what it exports, read off the JavaScript `tsc` emitted
for it. Each export is documented from the declaration its author wrote, with the
annotations `tsc` erased still on it, and a function's export also carries the
type names that declaration writes in return position and in parameter position.
Those names are what an agent's `docViewTypes` flags open views of beside the
function. A built-in such as `string` and a type parameter such as `T` are not
among them: neither names a declaration anything could open.

A view opens for a name something declares, which is an export of this module or
an SDK type. `tsc` erases a `type` or an `interface`, so one the module exports
is not in its namespace and a name only it declares opens nothing.

A module is evaluated by the program that imports it and by nothing else, so a
broken module another skill loaded cannot fail this turn.

### A module's exports are untyped to `tsc`

`gg.d.ts` declares `lib:*`, the wildcard, so every name an import from a `lib:`
specifier binds has the type `any`. The import is checked; what it binds is not.

gg reads a module's exports as text: the head of each declaration the namespace
offers, without its body. An ambient declaration assembled from those heads would
be missing the types they name and the members a class carries, and would refuse
calls the guest runs. What the model gets instead is the declaration itself,
quoted whole in the documentation view of the export, which is the author's own
account of the call it is about to write.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`typescript`, and `code-nothing-shown.hbs` through a clause naming `console.log`.
Neither names a catalogued function. The segment states that the reply is
compiled verbatim as a whole TypeScript module, whose top-level statements run in
the order they were written, and that a name gg prints is written at a call site
with its leading `gg.` dropped. Each entry of the module list beside it carries
its own named import as the line that brings that module into scope.

The arm names `tsc` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled in strict mode before it runs and one that
fails to compile is not executed.

Source gg synthesizes for this arm is written in the same idiom and imports only
the modules it calls into, since a model reads it as an example of its own
output. A file view is one call with an optional trailing options object carrying
`offset` and `limit`; a set of documentation views is a `const` array of names
with a `for…of` over it; the bootstrap program is one import, one search naming
the configured modules at once when there are any, and a `for…of` opening a
documentation view apiece when there are any. Paths and names are rendered
through JSON so a quote or a backslash cannot produce a program that will not
parse.
