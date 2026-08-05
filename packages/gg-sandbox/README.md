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
registers a *set* of program languages and each one has a guest of its own.
TypeScript is the first, the default, and today the only registered one; a second
is a **sibling directory**, not a change here. What every guest shares, and what a
new one has to satisfy, is in [Another language](#another-language) below and in
[Program languages](../../apps/docs/src/content/docs/gg/program-languages.md).

It is not published and has no runtime dependents. Its output is a set of **committed
binary/generated artifacts** in the Rust crate, named for the language rather than
for this package:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/guests/typescript.component.wasm`](../../crates/gg/src/sandbox/guests/) | The baked component, `include_bytes!`d by the host. **14,004,036 bytes** (13.4 MiB) as committed. |
| [`crates/gg/src/sandbox/guests/typescript.signatures.json`](../../crates/gg/src/sandbox/guests/) | The signature catalogue, `include_str!`d and rendered into the system prompt. |
| [`crates/gg/src/sandbox/checkers/typescript.tsc.js`](../../crates/gg/src/sandbox/checkers/) | The compiler gg type-checks a model's program with, cut from the pinned `typescript`. **6.2 MB**, `include_str!`d and written out once per process. |
| [`crates/gg/src/sandbox/checkers/typescript.lib.d.ts`](../../crates/gg/src/sandbox/checkers/) | The ES2022 standard library, 57 files concatenated so a check opens one. |
| [`crates/gg/src/sandbox/checkers/typescript.globals.d.ts`](../../crates/gg/src/sandbox/checkers/) | `tools/program-globals.d.ts`, verbatim: the names a program reaches that no SDK declaration covers. |
| [`crates/gg/src/sandbox/checkers/typescript.checker.json`](../../crates/gg/src/sandbox/checkers/) | Which compiler, at which language level. |

## Layout

| Path | What it holds |
| --- | --- |
| `src/membrane.d.ts` | The hand-maintained TypeScript mirror of `crates/gg/wit/gg-sandbox.wit`. Emits no code; `componentize-js` injects the real bindings. |
| `src/types.ts` | The **model-facing** record and enum types — gg's vocabulary, not the WIT's. |
| `src/errors.ts` | `ToolError`, and the argument validators every wrapper runs first. |
| `src/catalogue.ts` | Pure data: gg tool name ↔ SDK function ↔ module, plus `SESSION_ENTRIES`, `VIEW_ENTRIES`, `PROGRAM_ENTRIES` and `META_ENTRIES` — each carrying the `key` that identifies it across languages — and the `OBJECT_*` constants whose doc comments are the API objects' own model-facing descriptions. |
| `src/tools/*.ts` | The 37 typed wrappers — one per gg tool, grouped one module per capability family — plus the on-demand directory call (`listFunctions`, which is every object's `list()`) and the five `view` functions. |
| `src/helpers.ts` | The one helper, `readTextFile`. |
| `src/session.ts` | `finish(summary)` and the two verdict endings — model-facing functions that are not gg tools. |
| `src/shim.ts` | The component's entry point: `run(program, tools)` and `boundTools()`. |
| `tools/signatures.mjs` | Reflects the catalogue out of the emitted `.d.ts` files. |
| `tools/checker.mjs` | Cuts the committed `tsc` and its standard library out of the pinned `typescript`. |
| `tools/program-globals.d.ts` | `console`, `lib`, `performance`, `crypto` — declared for the checker, beside the shim that installs them. |
| `build.sh` | Refreshes every committed artifact. |

There is deliberately **one** copy of the WIT, and it lives in the Rust crate that
embeds the component (`crates/gg/wit/`); `build.sh` points `componentize-js` at it.

`src/session.ts` sits **beside** `src/tools/` rather than inside it for the mirror
reason. `finish(summary)` is model-facing — it is the only thing that ends a
responses-as-code session, and the system prompt teaches it — but it is not a gg
tool: no capability offers it, nothing dispatches it, and the shim binds it into
**every** program's scope, including one in a run that enables no tools at all. It
therefore gets its own `interface session` in the WIT, its own `SESSION_ENTRIES`
array in the catalogue, and its own top-level `session` object in
`signatures.json`, so that the bijection gg's `bound-tools` gate checks —
`boundTools() == ALL_TOOL_NAMES` — is not perturbed by it.

`src/tools/views.ts` is the same carve-out, one level further out. The `view`
object — `openFile`, `openText`, `openDocsView`, `close`, `current` — is how a program puts
material into its own **context window**, which is the only channel material has
into the model: `console.*` reaches the run's operator, a view reaches the model
on its next turn. None of the five is a gg tool either, so they get their own
`interface views` in the WIT, their own `VIEW_ENTRIES` array, and their own
top-level `views` array in `signatures.json`. Four of them are bound whatever a
run enables, for the same reason `finish` is; `openFile` carries
`requires: "read_file"`, because it is a read and a run with reading withheld must
not get one through a side door.

`src/tools/docs.ts` carries the third carve-out, and the odd one: `list`, the directory
every API object holds. It is bound onto *every* object rather than declared on one — the
shim seeds it from `listFunctions` with that object's name closed over — so its bound arity
is zero and it belongs to no object at all. It is catalogued anyway, in a `meta` section
whose entries carry no `object` field, because its signature and its description are read by
a model and **nothing a model reads about this SDK is written anywhere but on the declaration
it describes**. `export declare function list()` in `src/tools/docs.ts` is that declaration:
it has no implementation because it is never imported, and it exists so the bound shape is
reflected rather than described in a constant on gg's side that no gate could check.

That makes **five** of the WIT's interfaces non-tool ones — `feedback` (the shim's
private channel back to gg, never model-facing), `session`, `docs`, `views` and
`programs` (the [program library](../../apps/docs/src/content/docs/gg/program-library.md),
which a capability rather than a tool decides) —
against **eight** tool interfaces whose functions stand in exact one-to-one
correspondence with `ALL_TOOL_NAMES`. Adding a sixth `view` function means editing
four places (`crates/gg/wit/gg-sandbox.wit`, `src/membrane.d.ts`,
`src/tools/views.ts`, `VIEW_ENTRIES` in `src/catalogue.ts`) and then rebuilding both
artifacts; a gg test asserts the catalogue carries exactly the five, so the SDK and
the catalogue cannot disagree quietly.

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
| `npm run -w @test-cabinet/gg-sandbox signatures` + `git diff --exit-code` in CI | an SDK signature or JSDoc edited without regenerating `typescript.signatures.json` |
| `tools/signatures.mjs` exiting non-zero | a catalogued export that does not exist, lives in the wrong module, or has no doc comment |
| `tools/signatures.mjs` exiting non-zero | an **argument**, an inline argument **field**, a **type**, a type **member** or an **API object** with no doc comment — or an `@param` naming something the signature does not declare |
| gg's agreement gate | the same completeness rules, read off the emitted catalogue rather than off TypeScript's AST, so every language is held to them |

Every one of those is the same rule under a different subject: **nothing a model reads
about this SDK may be written anywhere but on the declaration it describes.** The JSDoc on
a wrapper is the sentence a model reads beside that function's signature; the `@param` on
an argument is the line it reads under it; the comment above an interface member is what
tells it what the field means; and the doc comment on an `OBJECT_*` constant in
`src/catalogue.ts` is how the system prompt introduces that object. Write all of them for
that reader.

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

A second program language is a **sibling directory** — say `packages/gg-sandbox-python/`,
with a `pyproject.toml` and its own build script driving `componentize-py` — that
is *not* an npm workspace and shares no code with this package. It is additive:
nothing here changes when it lands. What it does share is three things, and only
three.

**1. The WIT.** `crates/gg/wit/gg-sandbox.wit` is the wire, and there is exactly one
copy of it: ~14 interfaces of typed functions with real records, enums and variants,
one per gg tool. WIT is a language-neutral IDL, and other guest toolchains bind this
world directly — `componentize-py` generates clean Python bindings for it. A guest
binds the WIT itself; it does not go through this package.

**2. The catalogue schema.** It emits
`crates/gg/src/sandbox/guests/<language-id>.signatures.json` in the same shape, with
`language: "<language-id>"` and the same `key`s — the `objects` section in presentation
order, one entry per function carrying a `signatures` array (one entry per shape that
language offers the function in, each with its own documented arguments), and every type
with its own description and its members'. It need not use
`tools/signatures.mjs` — only the emitted JSON is contractual, and a Python guest
would reflect its own docstrings and type hints with its own script. The `key` is
what makes two catalogues comparable: gg asserts that every registered language
offers the same functions, on the same objects, under the same gates, and that the
only thing free to differ between them is **spelling**. If one language were missing
`edit_file`, or gated a view function on nothing, an A/B between the two would be
measuring the surfaces rather than the languages.

**3. The artifact convention.**
`crates/gg/src/sandbox/guests/<language-id>.{component.wasm,signatures.json}`, both
committed, both embedded by that language's module in `crates/gg/src/sandbox/language/`.
A language that type-checks the model's program commits its checker beside them, under
`crates/gg/src/sandbox/checkers/<language-id>.*` — gg is copied as a single file into a run
container, so a compiler it needs is a compiler it carries.

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
