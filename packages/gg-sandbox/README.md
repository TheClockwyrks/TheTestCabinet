# `@test-cabinet/gg-sandbox` — the guest for gg's responses-as-code sandbox

The TypeScript half of gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn with a **TypeScript
program** instead of a batch of tool calls; gg type-strips the program in-process
and evaluates it inside a wasm component. This package is that component's source:
the typed tool surface a program calls, the interpreter shim that evaluates it, and
the build that bakes both into the artifacts the Rust host embeds.

It is not published and has no runtime dependents. Its output is two **committed
binary/generated artifacts** in the Rust crate:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/gg-sandbox.component.wasm`](../../crates/gg/src/sandbox/) | The baked component, `include_bytes!`d by the host. **13,941,785 bytes** (13.3 MiB) as committed. |
| [`crates/gg/src/sandbox/signatures.json`](../../crates/gg/src/sandbox/) | The signature catalogue, `include_str!`d and rendered into the system prompt. |

## Layout

| Path | What it holds |
| --- | --- |
| `src/membrane.d.ts` | The hand-maintained TypeScript mirror of `crates/gg/wit/gg-sandbox.wit`. Emits no code; `componentize-js` injects the real bindings. |
| `src/types.ts` | The **model-facing** record and enum types — gg's vocabulary, not the WIT's. |
| `src/errors.ts` | `ToolError`, and the argument validators every wrapper runs first. |
| `src/catalogue.ts` | Pure data: gg tool name ↔ SDK function ↔ module, plus `SESSION_ENTRIES` and `VIEW_ENTRIES`. |
| `src/tools/*.ts` | The 37 typed wrappers — one per gg tool, grouped one module per capability family — plus the two on-demand documentation functions (`listFunctions`, `readDoc`) and the four `view` functions. |
| `src/helpers.ts` | The one helper, `readTextFile`. |
| `src/session.ts` | `finish(summary)` and the two verdict endings — model-facing functions that are not gg tools. |
| `src/shim.ts` | The component's entry point: `run(program, tools)` and `boundTools()`. |
| `tools/signatures.mjs` | Reflects the catalogue out of the emitted `.d.ts` files. |
| `build.sh` | Refreshes both committed artifacts. |

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
object — `openFile`, `openText`, `close`, `current` — is how a program puts
material into its own **context window**, which is the only channel material has
into the model: `console.*` reaches the run's operator, a view reaches the model
on its next turn. None of the four is a gg tool either, so they get their own
`interface views` in the WIT, their own `VIEW_ENTRIES` array, and their own
top-level `views` array in `signatures.json`. Three of them are bound whatever a
run enables, for the same reason `finish` is; `openFile` carries
`requires: "read_file"`, because it is a read and a run with reading withheld must
not get one through a side door.

That makes **four** of the WIT's interfaces non-tool ones — `feedback` (the shim's
private channel back to gg, never model-facing), `session`, `docs` and `views` —
against **eight** tool interfaces whose functions stand in exact one-to-one
correspondence with `ALL_TOOL_NAMES`. Adding a fifth `view` function means editing
four places (`crates/gg/wit/gg-sandbox.wit`, `src/membrane.d.ts`,
`src/tools/views.ts`, `VIEW_ENTRIES` in `src/catalogue.ts`) and then rebuilding both
artifacts; a gg test asserts the catalogue carries exactly the four, so the SDK and
the catalogue cannot disagree quietly.

## Refreshing the artifacts

```sh
packages/gg-sandbox/build.sh
```

Run it — and commit both outputs with the source change — after editing:

- `crates/gg/wit/gg-sandbox.wit` (the membrane),
- anything under `src/` (the SDK, the shim, or the catalogue).

The script type-checks the guest, bakes the component with the **pinned**
`componentize-js@0.21.0` through `npx`, and regenerates the signature catalogue.
It takes a few seconds. `componentize-js` is intentionally *not* a dependency of
this package: it is ~208 MB of `node_modules`, and `npm ci` runs in three CI jobs
that have no use for it.

A rebuild is **not** byte-reproducible even when nothing changed: the component
snapshots its own build instant (which is also why a program's `Date.now()` is
frozen at that instant, and why a code turn is reproducible for replay). Two
refreshes of identical source were measured a few dozen bytes apart, so a diff on
this artifact proves nothing on its own — do not re-run the script just to see
whether it would produce something different.

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
| `npm run -w @test-cabinet/gg-sandbox signatures` + `git diff --exit-code` in CI | an SDK signature or JSDoc edited without regenerating `signatures.json` |
| `tools/signatures.mjs` exiting non-zero | a catalogued export that does not exist, lives in the wrong module, or has no doc comment |

The JSDoc on each wrapper is not decoration: it is the sentence a model reads in
the system prompt beside that function's signature. Write it for that reader.

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
why both committed outputs live under `crates/gg/src/sandbox/` instead.
