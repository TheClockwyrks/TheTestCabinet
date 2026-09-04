---
title: "The ECMAScript guest"
---

The ECMAScript guest is quickjs-ng inside a `wit-bindgen` component that
declares gg's own sandbox world. Every arm whose program becomes JavaScript is
registered against it: [TypeScript](/gg/languages/typescript/),
[JavaScript](/gg/languages/javascript/) and
[PureScript](/gg/languages/purescript/).

It exists because a program must be able to reach its SDK through an `import`
the program wrote, which the [invariants](/gg/responses-as-code/invariants/)
require of every arm.

## What the guest guarantees

A model's program is declared as a module named `program.js`, from the bytes the
host sent, with nothing prepended and nothing appended. Line 1 column 1 of the
model's text is line 1 column 1 of the module, so every location the engine
reports is already in the model's own coordinates and no arm-side arithmetic
adjusts it.

A program may declare any top-level name, write `import` and `export`, and use
top-level `await`.

## What a program may import

| Specifier | What it resolves to |
| --- | --- |
| `gg` | the whole SDK: one namespace per family, plus `ApiError` |
| `gg:<family>` | one family alone, such as `gg:files` |
| `lib:<name>` | a [code module](/gg/modules/) the agent loaded |

`gg:<family>` and the SDK's own copy of that family are one module instance, so
`error instanceof ApiError` holds for an error the SDK threw.

A `lib:<name>` module is one the loader was handed for this turn, declared as its
own module and evaluated by whichever program imports it. Every specifier in the
table resolves the same way: the loader answers it, the program writes the
`import` line, and a program that writes no line for a name reads that name's own
`ReferenceError`.

The SDK's own files and the membrane interfaces beneath them resolve only for an
importer inside the SDK. A program that names one is told which specifier to
write instead.

## The membrane

The guest imports every interface of the sandbox world directly. The lowering
between WIT values and JavaScript values is generated from
`crates/gg/wit/gg-sandbox.wit`, so a family gg adds is reachable from the SDK as
soon as its declarations land, and the guest's `bound-operations` export is
derived from the same source. It follows the canonical component-model mapping,
so the guest lowers a call exactly as a generated binding would.

Building the lowering from the WIT requires that gg's membrane use only the
constructs the generator covers: records, variants, enums, options, lists and
the scalar types. A construct outside that set fails the guest's build by name.

## Failures

A failure reaches the model as the engine's own words: the guest reports the
engine's rendering of the uncaught value over `feedback.report-error`, with the
failure's class read off the value — `api-failure` with the wire's own code when
the value carries an `ApiError`'s `code` and `operation`, `unknown-name` for a
`ReferenceError`, `other` for anything else — and then returns normally. The
turn is filed under `program_fault`, never as a `sandbox_trap`: an uncaught
API failure is the program's fault, and a trap is reserved for a ceiling gg
imposed. The one failure that still ends in a trap is gg's own execution
budget, below. Five shapes are covered:

- an uncaught throw, including an `ApiError` from a refused call. An error's own
  properties are rendered beside its message, which is how an `ApiError` names
  the call that failed and the class it failed under;
- a syntax error, at the model's own line;
- a rejected promise nothing ever handled, through the engine's rejection
  tracker;
- a stack overflow, as `RangeError: Maximum call stack size exceeded` with the
  frames;
- a runaway loop, as `InternalError: interrupted` naming the function that was
  looping. This one is gg's execution ceiling rather than the program's fault,
  so the guest writes the rendering to standard error and dies, and the turn is
  filed as `sandbox_timeout` with the engine's words in front of gg's.

One failure can arrive from more than one of the engine's channels. The guest
reports each distinct rendering once.

### Which frames the model reads

A stack the SDK raised from carries the SDK's own frames — under the `sdk:`
specifiers the loader resolves for the SDK alone, and a `native` frame for the
membrane call itself — above the program's. Those name code the model cannot
open, so the guest strikes them and closes the stack with a count of what it
struck. What survives is every frame in `program.js` and in a loaded code
module, which on the TypeScript and PureScript arms the host then reads back
through the compiler's own map.

The engine captures the innermost ten frames of a stack and discards the rest,
and the striking above happens after the capture, so every frame an SDK spends
comes out of the same ten. gg's SDK spends four of them raising a failure from a
membrane call. An arm that compiles a second SDK into the program keeps that
SDK's crossing to one engine frame, which leaves the program's own innermost
frame inside the capture.

### A rejection is read after the queue drains

The engine's tracker fires the instant a promise rejects with nothing attached to
it, and every handler in JavaScript is attached after that instant. So a
rejection is held until the program's job queue is empty and reported only if it
is still unhandled then. `try { await p } catch`, `p.catch(…)` and
`Promise.allSettled` all run to completion.

### Where a frame points

The engine carries a position for a statement, a call, a `new`, a `throw` and a
binary operator. A fault raised inside a variable declarator's initializer by
anything else — a property read on a bad base, an unresolved name — carries the
position of the statement before it, which is the last one the engine emitted.

wasmtime's own backtrace under the engine's rendering names the engine's
internals by index alone, so those frames are struck and the reason is what the
model reads after the engine's words.

### The two stacks a recursion spends

A JavaScript recursion spends the engine's own stack, which lives in the guest's
linear memory, and the host's wasm call stack under it. The engine's ceiling has
to be the one reached first, or the store dies with a trap that names nothing.
The guest sets its own ceiling to 512 KiB and gg sets `max_wasm_stack` to 1 MiB,
which is measured to give a recursion depth of about 1800 frames before the
engine reports the overflow itself.

### The execution budget

gg's [execution timeout](/gg/execution-limits/) is enforced by the host's epoch
deadline and remains the ceiling. gg also states the budget to the guest in
`GG_SANDBOX_DEADLINE_MS`, half a second short of its own, so that a guest whose
engine can stop a runaway loop itself answers first and in the model's language.
The guest subtracts the time it spent inside membrane calls before deciding, so
a program parked in a long shell command reads as parked rather than as looping.

A guest that leaves the variable alone has gg's epoch deadline as its only
ceiling.

## Globals

The guest installs `TextEncoder`, `TextDecoder`, `structuredClone` and `crypto`,
which quickjs does not carry. `Intl` is absent.

`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`,
`requestAnimationFrame` and `fetch` are installed as named throwers, so a program
that reaches for one is told which name is absent and why. `queueMicrotask` is
real: the job queue is drained before the guest returns, which is the same
mechanism a top-level `await` finishes on.

## Build outputs

`packages/gg-sandbox/build.sh` writes three files, embedded in the gg binary:
the preview1 core module, the pinned `wasi_snapshot_preview1` reactor adapter,
and a manifest naming what built them. gg encodes the component from the first
two in its own process, so the component a run instantiates is produced by the
encoder gg's own wasmtime agrees with.

They are built from `packages/gg-sandbox`'s own SDK sources, which is why they
are that package's artifacts rather than a package of their own.
