# `@test-cabinet/gg-sandbox` — gg's TypeScript guest

The **TypeScript** guest for gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls; gg prepares that program in-process
and evaluates it inside a wasm component. This package is one such component's
source: the typed tool surface a program calls, the interpreter shim that evaluates
it, and the build that bakes both into the artifacts the Rust host embeds.

**One guest, not the guest.** The language a program is written in is a first-class
axis of gg — it is what a cross-language A/B study compares arms on — so gg
registers a *set* of program languages and most of them have a guest of their own.
TypeScript is the first and the default; a further language is normally a **sibling
directory**, not a change here. This one is the exception in one direction: it
serves **two** registered arms, because `javascript` is this arm with the type
check removed, and its component is also what the compiled PureScript arm is
evaluated by. What every guest shares, and what a new one has to satisfy, is in
[Another language](#another-language) below and in
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md).

It is not published and has no runtime dependents. Its output is a set of **committed
binary/generated artifacts** in the Rust crate, named for the language rather than
for this package:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/guests/typescript.component.wasm`](../../crates/gg/src/sandbox/guests/) | The baked component, `include_bytes!`d by the host. **14,004,036 bytes** (13.4 MiB) as committed. |
| [`crates/gg/src/sandbox/guests/typescript.signatures.json`](../../crates/gg/src/sandbox/guests/) | The signature catalogue, `include_str!`d and rendered into the system prompt. |
| [`crates/gg/src/sandbox/guests/javascript.signatures.json`](../../crates/gg/src/sandbox/guests/) | The same catalogue under a second language id. gg registers `javascript` as `typescript` with the type check removed — same component, same SDK, same signatures, annotations included — so the two arms differ only in whether a program is checked before it runs. There is deliberately no second `.wasm`. |
| [`crates/gg/src/sandbox/checkers/typescript.tsc.js`](../../crates/gg/src/sandbox/checkers/) | The compiler gg type-checks a model's program with, cut from the pinned `typescript`. **6.2 MB**, `include_str!`d and written out once per process. |
| [`crates/gg/src/sandbox/checkers/typescript.lib.d.ts`](../../crates/gg/src/sandbox/checkers/) | The ES2022 standard library, 57 files concatenated so a check opens one. |
| [`crates/gg/src/sandbox/checkers/typescript.globals.d.ts`](../../crates/gg/src/sandbox/checkers/) | `tools/program-globals.d.ts`, verbatim: the names a program reaches that no SDK declaration covers. |
| [`crates/gg/src/sandbox/checkers/typescript.checker.json`](../../crates/gg/src/sandbox/checkers/) | Which compiler, at which language level. |

## Layout

| Path | What it holds |
| --- | --- |
| `src/membrane.d.ts` | The hand-maintained TypeScript mirror of `crates/gg/wit/gg-sandbox.wit`. Emits no code; `componentize-js` injects the real bindings. |
| `src/gg/*.ts` | **The model-facing surface**: one module per capability family, each exporting that family's functions and declaring the types they speak in. `src/gg/core.ts` declares no function and holds the types every other module names — `ToolError` above all. |
| `src/internal/*.ts` | Everything the modules are built out of and no model reads: the argument validators, the failure normaliser, and the membrane lowerings shared by two modules. It is outside `src/gg/` because that is exactly what the reflector walks. |
| `src/catalogue.ts` | The one thing a declaration cannot state: **what buys a call at run time**. The module order, and the four tables that map a gg operation onto the tool, capability or role that binds it. No name, no description and no operation id lives here. |
| `src/shim.ts` | The component's entry point: `run(program, …)` and `boundTools()`. It builds a program's scope by deriving each module's exports from the operations this run bought. |
| `tools/signatures.mjs` | Reflects the catalogue out of the emitted `.d.ts` files under `dist/headers/gg/`. |
| `tools/checker.mjs` | Cuts the committed `tsc` and its standard library out of the pinned `typescript`. |
| `tools/program-globals.d.ts` | `console`, `lib`, `performance`, `crypto` — declared for the checker, beside the shim that installs them. |
| `build.sh` | Refreshes every committed artifact. |

There is deliberately **one** copy of the WIT, and it lives in the Rust crate that
embeds the component (`crates/gg/wit/`); `build.sh` points `componentize-js` at it.

## What a model reads, and where it is written

Every word of it is on the declaration it describes. A module's own header
introduces the module; a function's JSDoc is its documentation, with its **first
line the brief and everything after the blank line that follows the detail**; a
`@param` describes one argument, and `@param options.offset` one field of an
argument written inline; a type's and each member's doc comment travel with the
declaration. `tools/signatures.mjs` refuses to emit a catalogue with a blank in it,
so an undocumented declaration is a build error rather than a gap in front of a
model.

The gg **operation** each function binds is written on the declaration too, as
`@ggop <namespace>.<key>`, and never in a table beside it — a table is a second
place to be wrong. The reflector fails in both directions: an exported function of
`src/gg/` that names no operation is refused, and so is an operation
`src/catalogue.ts` says this arm offers that no declaration binds. The operation's
key also has to *name* its function (`files.read_file` is `readFile` and nothing
else), because that derivation is how `src/shim.ts` binds an operation without a
second table to keep in step.

The name a documentation view is opened by is `gg.<module>.<name>`, and it is a
path a program can really write: the shim binds `gg` with one object per module
this run offers, and binds each module under its bare id as well, so
`gg.files.readFile` and `files.readFile` are one function. Types are bound bare,
as `ToolError` is, and filed under their module's name, so `gg.files.FileRead` is
where the declaration lives and `FileRead` is what a signature writes.

Four families are model-facing and are **not** gg tools, so no `ALL_TOOL_NAMES`
entry stands for one: the ending calls of `src/gg/session.ts`, which a role buys;
the view calls of `src/gg/views.ts`, four of which nothing gates at all; the
documentation calls of `src/gg/docs.ts`, of which the search is bound to every
program and the two closes are bought by a capability; and the program library of
`src/gg/programs.ts`, which a capability buys. Keeping them out
of the tool vocabulary is what keeps `boundTools() == ALL_TOOL_NAMES` — the one
drift gate that inspects the committed `.wasm` rather than a source file — in exact
bijection.

## Refreshing the artifacts

```sh
packages/gg-sandbox/build.sh
```

Run it — and commit every output with the source change — after editing:

- `crates/gg/wit/gg-sandbox.wit` (the membrane),
- anything under `src/` (the SDK, the shim, or the catalogue),
- `tools/program-globals.d.ts` (the globals a checked program may name),
- the pinned `typescript` version in `package.json`.

The script type-checks the guest, bakes the component with the **pinned**
`componentize-js@0.21.0` through `npx`, regenerates the signature catalogue, and
cuts the **checker** gg type-checks a model's program with out of the pinned
`typescript`. It takes a few seconds. `componentize-js` is intentionally *not* a
dependency of this package: it is ~208 MB of `node_modules`, and `npm ci` runs in
three CI jobs that have no use for it.

A rebuild is **not** byte-identical even when nothing changed: the component
snapshots its own build instant. Two refreshes of identical source were measured a
few dozen bytes apart, so a diff on this artifact proves nothing on its own — do not
re-run the script just to see whether it would produce something different.

Nothing in a normal build runs this script. `cargo build` embeds the committed
artifacts, and this package deliberately has **no `build` npm script** so that a
plain `npm run build` at the repo root never requires `componentize-js`. The one
CI-visible script is `signatures`, which needs only TypeScript and is the drift
gate for the catalogue.

## What stops it drifting

| Gate | Catches |
| --- | --- |
| `componentize-js` fails to link | `src/membrane.d.ts` disagreeing with the WIT, at refresh time |
| gg's instantiation test | a WIT change with no artifact refresh — the committed component's imports no longer match the host's linker |
| gg's `bound-tools` test | a tool added, renamed or removed in gg with a **stale committed `.wasm`** |
| `npm run -w @test-cabinet/gg-sandbox signatures` + `git diff --exit-code` in CI | an SDK signature or JSDoc edited without regenerating the committed catalogues |
| `tools/signatures.mjs` exiting non-zero | an exported function of `src/gg/` naming no gg operation, an operation `src/catalogue.ts` lists that nothing binds, an operation whose key does not name its function, or two functions claiming one operation |
| `tools/signatures.mjs` exiting non-zero | a **module**, a **function**, an **argument**, an inline argument **field**, a **type** or a type **member** with no doc comment — an `@param` naming something the signature does not declare — a first paragraph that wraps onto a second line, so there is no brief in it — or a declared type nothing refers to |
| gg's register gate | prose that has a brief and gets its register wrong: a paragraph in the brief field, a second-person instruction, emphasis by capitals, an unclosed code span |
| gg's name rule and agreement gate | a fully-qualified name that is not module-qualified or does not end in the name a program writes, and the completeness rules read off the emitted catalogue rather than off TypeScript's AST, so every language is held to them |

Every one of those is the same rule under a different subject: **nothing a model reads
about this SDK may be written anywhere but on the declaration it describes.** The JSDoc on
a function is what a model reads beside that function's signature; the `@param` on an
argument is the line it reads under it; the comment above an interface member is what tells
it what the field means; and a module's own file header is how the surface introduces that
module. Write all of them for that reader.

## Why the component is committed raw, at ~13 MB

A componentized JavaScript guest embeds a whole JavaScript engine, so its size is
structural, not accidental. Committing it follows the precedent already set by the
`foray-ref-*` guests: a documented `build.sh` produces it and it is checked in
beside its source, so no build or CI step ever needs `componentize-js` — the only
Node CI touches for this package is the `signatures` regeneration described above.
The cost is
real and accepted — `tcab` grows by roughly the artifact's size on all three
release platforms, and each refresh adds a few MB to the git pack, which is why
refreshes are deliberate rather than routine.

Committing it **zstd-compressed** (~4 MB) was considered and rejected: it would
drag a C toolchain onto a binary that is release-built for Linux, Windows and macOS
and statically linked against musl, in order to shrink a developer/CI binary nobody
downloads on a budget.

`.gitignore` has an unanchored `dist` rule, so this package's `dist/` — the
intermediate JavaScript and declarations — is ignored for free. That is precisely
why both committed outputs live under `crates/gg/src/sandbox/guests/` instead.

## Another language

The design of the seam — why the language is an axis, the rules every language's SDK
obeys, and a worked walkthrough of adding Python — is
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md). What
follows is this package's own side of it.

A second program language is a **sibling directory**, and there are now three to read:
[`packages/gg-sandbox-python/`](../gg-sandbox-python/), whose `build.sh` drives
`componentize-py`; [`packages/gg-sandbox-ruby/`](../gg-sandbox-ruby/), which bakes
Opal's runtime into a guest of its own; and
[`packages/gg-sandbox-purescript/`](../gg-sandbox-purescript/), which bakes **no guest
at all** — it compiles a library set the host's `purs` needs, because that arm's
compiled programs are self-contained JavaScript evaluated by *this* package's
component. None is an npm workspace and none shares code with this package. All are
additive: nothing here changed when any of them landed. What they do share is three
things, and only three.

**1. The WIT.** `crates/gg/wit/gg-sandbox.wit` is the wire, and there is exactly one
copy of it: ~14 interfaces of typed functions with real records, enums and variants,
one per gg tool. WIT is a language-neutral IDL, and other guest toolchains bind this
world directly — `componentize-py` generates clean Python bindings for it. A guest
binds the WIT itself; it does not go through this package.

**2. The catalogue schema.** It emits
`crates/gg/src/sandbox/guests/<language-id>.signatures.json` in the same shape, with
`language: "<language-id>"`, `schema: 2`, a `modules` section in presentation order, one
flat `functions` array whose entries name a gg **operation** and carry a module-qualified
`fqn` and a `signatures` array (one entry per shape that language offers the function in,
each with its own documented arguments), and every type with its own brief, its members'
and the module it belongs to. It need not use `tools/signatures.mjs` — only the emitted
JSON is contractual, and a Python guest reflects its own docstrings and type hints with its
own script. The **operation** is what makes two catalogues comparable: gg asserts that
every registered language offers the same operations, and that what is free to differ
between them is the **shape** each language gives them. If one language were missing
`files.edit_file`, an A/B between the two would be measuring the surfaces rather than the
languages.

**3. The artifact convention.**
`crates/gg/src/sandbox/guests/<language-id>.{component.wasm,signatures.json}`, both
committed, both embedded by that language's module in `crates/gg/src/sandbox/language/`.
A catalogue is always the language's own — it carries the id it was generated for and the
host asserts it — while a *component* may be shared by two languages whose programs it
evaluates identically, as `javascript` shares this guest's.
A language whose prepare step judges the model's program commits what it judges it with
beside them, under `crates/gg/src/sandbox/checkers/<language-id>.*` — gg is copied as a
single file into a run container, so a compiler it needs is a compiler it carries. A
compiler too large to carry is installed into the gg toolchain image instead, and what is
committed is whatever the compiler cannot work without: `purescript`'s artifact there is its
compiled library set, not a compiler at all.

Everything else is that language's own. In particular its **SDK is hand-written and
idiomatic for it** — `snake_case` names, keyword arguments where TypeScript takes a
trailing options object, typed dataclass-style results — and the SDK, never the
model, bridges that shape onto the WIT. The rules it has to keep obeying are the
ones this SDK obeys, and they are about what reaches the model:

- capabilities arrive as **typed, standalone, namespaced bindings**
  (`fs.readFile(...)`, `system.shell(...)`), never a generic dispatcher taking the
  capability name as data;
- **every call is synchronous** — nothing returns a promise, future or coroutine;
- **no strings-as-enums** where a fixed choice exists, **no model-authored JSON as an
  argument**, and **no JSON document as a result**: a result is a typed value whose
  fields the program reads directly;
- **optional arguments use the language's own idiom**; **required arguments are
  positional**.

**What the host links** is not a language's business. A `componentize-py` guest
imports the full WASI p2 surface (`wasi:cli`, `wasi:filesystem`, `wasi:sockets`,
`wasi:clocks`, `wasi:random`, `wasi:io`) whether or not the program touches any of
it, so gg's linker defines the whole of that surface for every guest,
unconditionally — a program gets the host's clock, randomness, filesystem and
sockets. The one exception the host owns is **stdout**, which is gg's telemetry
stream; the component is baked `--disable stdio` for the same reason and rebinds
`console.*` to the feedback channel. This component imports part of that surface
and not the rest: alongside the membrane it declares `wasi:clocks`, `wasi:random`
and `wasi:io`, which is why a program's `Date.now()` is the host's wall clock and
`crypto.randomUUID()` draws the host's entropy. It does not declare
`wasi:filesystem` or `wasi:sockets` — it is baked without them — so those are
unused by this guest rather than withheld from it.
