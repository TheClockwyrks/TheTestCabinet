# Decision: the five ECMAScript arms (TypeScript, JavaScript, Java, Kotlin, PureScript)

**This document's verdict on the JVM arms is superseded and wrong.** It reports
TeaVM's WASI target as deleted upstream and concludes that Java and Kotlin cannot
leave JavaScript. The target survives in TeaVM 0.13.1, which gg pins, and a
complete Java and Kotlin arm was afterwards built on it end to end
([`gg-jvm-native-findings.md`](gg-jvm-native-findings.md)). The owner's ruling is
D14 of [`gg-whole-programs-decisions.md`](gg-whole-programs-decisions.md): the JVM
arms compile to wasm and reach gg through a guest of their own, and the
[languages overview](apps/docs/src/content/docs/gg/languages/overview.md) states
it. What remains authoritative below is everything measured about the ECMAScript
guest itself, which is what TypeScript, JavaScript and PureScript still need.

**Verdict up front.** Stop using StarlingMonkey — but not by taking Java and Kotlin off JavaScript. Replace the *engine* (StarlingMonkey → quickjs-ng in a component) for all five arms in one migration. That is the only measured configuration that satisfies both rulings, and it satisfies them for all five at once. The owner's suspicion that Java and Kotlin never belonged on a JS engine is correct in principle and **unfundable today**: every JVM-native destination that exists either fails ruling 2 outright (Kotlin/Wasm), requires a JavaScript object model gg would have to write (TeaVM WasmGC, GraalVM), or was deleted upstream three months ago (TeaVM WASI). Revisit the JVM arms when upstream moves; do not fork a compiler to get there.

Separately and immediately: **`--disable stdio` at `packages/gg-sandbox/build.sh:132` is why the incumbent produces zero stderr.** That is gg's flag, not StarlingMonkey's limitation. Removing it was measured to turn every uncaught error on the five arms into a message + stack on stderr that `with_guest_stderr` already folds in. It does not satisfy ruling 1 and does not fix floating rejections, but it is a one-line partial fix for ruling 2 available today.

---

## A. The honest account of today

**Plain terms.** On these five arms gg does not run the agent's program. On TypeScript and JavaScript there is no module system at all: `import` is refused by an AST scan with a written apology, the SDK arrives as 15–16 *formal parameters of a `new Function`*, and the text that executes is oxc's re-print of the AST rather than the bytes the model wrote — so run-time error lines are off by an amount that varies with the program's contents. On Java, Kotlin and PureScript the model does write real imports, but they are resolved on the host at compile time and erased: the compiled bundle is wrapped in a synthesized entry class holding *the catch chain*, flattened by esbuild/TeaVM into one closure, and evaluated by the same `new Function` against the same injected identifiers. Both rulings are violated on all five arms, and the violation is forced by the guest, not chosen: componentize-js bakes one module graph at wizen time and offers no way to add to it at run time, so injected free identifiers are the only remaining way to run model code at all.

**Evidence (verified against the tree unless noted).**

- `packages/gg-sandbox/src/shim.ts:570` — `new Function(...names, program)`; `:500` the same for `lib.<key>` code modules. `buildScope()` is static and binds `gg`, `ToolError`, `lib`, plus **13 `LEGACY_GROUPINGS` names** (`catalogue.ts:98`) — `fs`, `system`, `project`, `tasks`, `memory`, `docs`, `view`, `context`, `agents`, `skills`, `programs`, `harness`, `review` — which exist only so the PureScript/Java/Kotlin bundles have free identifiers to resolve against (`Gg/Internal/Wire.js`'s `typeof` switch).
- Consequence, measured in Node against the same spec text SpiderMonkey implements: `const context = 1`, `let docs = 2`, `class tasks {}` are **SyntaxErrors in gg and legal everywhere else**, and they throw at `new Function` *construction*, which `typescript.prepare.rs:24-32` documents as arriving **with no location at all**. The current unified prompt (`system-code.hbs:180-192`) names only `gg`, `ToolError`, `lib` — the other 13 are undisclosed. (`shim.ts:434-438`'s claim that each prompt names the reserved set is stale on this checkout.)
- `typescript.prepare.rs:316` — `source: Codegen::new().build(&program).code`. A standalone repro against the pinned oxc 0.141 found **no input round-trips identically, including pure JS with no types**: tabs replace indentation, blank lines deleted, quotes rewritten, object literals exploded, trailing comments dropped. Measured line shift: 7 on a minimal case, 5 on a realistic 28-line one. `shim.ts:614` subtracts only `lineOffset()` — the constant `Function` prepends — and no source map exists for TS/JS (`jvm.rs:286-315` is the only source-map code in the tree).
- `typescript.prepare.rs:425-440` — the four refusal messages for `import`, `export`, dynamic `import()`, top-level `await`.
- `java.rs:213`, `kotlin.rs:207`, `javascript.rs:159`, `purescript.rs:268` all return `typescript::COMPONENT`. Exactly five arms; **Ruby is not among them** — it has its own component (`ruby.rs:126`). *(Correcting survey 1, which listed "Opal (Ruby)" as riding the JS guest.)*
- `java.source.rs:62-63` / `kotlin.source.rs:86-87` synthesize a `GgEntry` holding "the entry point and the catch chain" and hoist the model's imports. `jvm.rs` is 418 lines — TeaVM driver, a 50-line JS prelude calibrating `new Function`'s line offset at run time, and a base-64 VLQ source-map decoder — **all of which exists only because the failure surfaces in JavaScript.**
- StarlingMonkey has no run-time module resolution at any supported setting (measured, componentize-js 0.21.0): `data:`, `./x.js`, bare and WIT-shaped specifiers all trap at `path_filestat_get`. The one registration API, `ScriptLoader::define_builtin_module`, is C++ and build-time only.

---

## B. Options matrix

**M** = measured in this investigation. **R** = read (docs, source, release notes). **T** = verified in this repo by me.

| Runtime | Ruling 1 — real imports, no injected scope | Ruling 2 — uncaught error → message + model's own line | Component / WIT | Maturity | Size & startup | What gg rewrites |
|---|---|---|---|---|---|---|
| **StarlingMonkey today** (incumbent) | **No** — impossible; every dynamic specifier traps **(M)** | **No** — opaque trap, zero stderr **(M)**, caused by `--disable stdio` **(T, build.sh:132)** | native, in use **(T)** | active, Apache-2.0; cjs 0.22.0 changelog irrelevant **(R)** | **14,121,104 B**; compile 576–619 ms → 48.1 MB cwasm; ~96 ms process wall **(M)** | — |
| **StarlingMonkey minus `--disable stdio`** | **No** — unchanged | **Partial** — full SpiderMonkey message + stack on stderr from a `new Function` body with no `try` **(M)**; coordinates are `Function:` +2 on top of the oxc shift; **floating rejections still silent (M)** | unchanged | unchanged | unchanged | **one line** |
| **StarlingMonkey + custom builtin engine** (`add_builtin` + `engine?:` path) | Yes in principle — a `compileModule` builtin over `JS::CompileModule` **(R)** | as above | preserved | supported but unexercised; requires owning a SpiderMonkey-in-wasm build (`spidermonkey-wasi-embedding`, 10★, last push 2025-07-30) **(R)** | still 13.5 MiB | shim + a C++ builtin + a permanent engine-build burden |
| **`starling.wasm` dynamic mode** | Yes (FS-preopened modules) **(R)** | as above | **No gg WIT imports at all** — whole membrane lost **(R)** | supported | — | disqualified |
| **quickjs-ng in a component** ← *recommended* | **Yes** — model program compiled as an ES module byte-for-byte; SDK a real host-supplied module; native `test-cabinet:gg/files` module **(M, working component)** | **Yes** — message + stack at **offset zero** across the SDK boundary; syntax errors; `ToolError` with `code`/`tool`; **floating rejections reported** via the rejection tracker; OOM; interrupt; stack overflow catchable with a 2-line engine patch + `-W max-wasm-stack` **(all M)** | **Yes** — real component, wit-bindgen 0.60 C bindings, WIT `import test-cabinet:gg/files`, driven by a Rust wasmtime 45 host reproducing `GuestStderr` **(M)** | MIT, 3.6k★, release 2026-08-04, active; Javy ships it in production **(R)** | **1,450,551 B**; compile 79–108 ms → 3.87 MB cwasm; instantiate 0.13 ms; ~15 ms wall **(M)**. Compute: parity on arithmetic, **~2× slower** on JSON/string **(M)** | guest shim (`shim.ts` → Rust/C around quickjs); SDK becomes real ES modules; `buildScope`/`new Function`/injected names deleted; JVM catch chains + `GgEntry` + the 418-line `jvm.rs` deletable |
| **rquickjs 0.12.2** (Rust bindings, same engine) | as quickjs-ng **(R)** | as quickjs-ng **(R)** | wit-bindgen Rust guest — natural fit **(R)** | MIT, 3.5M downloads, pushed 2026-08-10; Javy proves the wasm build **(R)** | expect quickjs-ng ± | same, in Rust instead of C — **unmeasured** |
| **Boa 0.21.1** | **Yes** — spec-shaped `ModuleLoader::load_imported_module` + `Module::synthetic` **(M)** | **No** — runtime errors have **no stack, no fileName, no lineNumber**; `Context::stack_trace()` empty at the host **(M)**. Syntax errors do carry position | pure Rust, wasip1 built **(M)** | MIT, 7.5k★, ~90% test262 **(R)** | 6.78 MB, ~52 ms warm **(M)** | disqualified on ruling 2 |
| **Javy 9.1.0** | No — single JS input, no module resolution **(R, issue #596)** | inherits quickjs | **"not a Wasm component"** per its own docs **(R)** | active | — | disqualified as a runtime; valuable as proof rquickjs builds for wasm |
| **Porffor** | n/a — **no `eval`/`Function`** **(R)** | — | — | version number *is* its test262 % **(R)** | — | structurally disqualified |
| **Host-side engine in gg's Rust process** | Yes, trivially | Yes, trivially | — | — | — | **throws away the wasm boundary, epoch deadline, `MemoryLimiter`, and the single membrane shared by 11 arms.** Not recommended |
| **TeaVM `WEBASSEMBLY_WASI`** (Java/Kotlin) | Yes — no wrapper, no catch chain needed | **Yes** — `at Prog.inner(Prog.java:4) … Prog.main(Prog.java:9)` **on stderr (M)**; exception **header line missing** (a ~10-line TeaVM defect, fixability unverified) | **Yes** — encoded to a 328,058-byte component with gg's own pinned preview-1 adapter, accepted by wasmtime 45 **(M)** | **REMOVED in TeaVM 0.14.0** (2026-05-02, "failed to gain any adoption"); `TeaVMTargetType` on master is `{JAVASCRIPT, WEBASSEMBLY_GC, C}` **(R)**. gg pins 0.12.3 | 299 KB–1.04 MB; compile 1.1–2.6 s; `Module::from_file` 60–257 ms **(M)** | freeze or fork TeaVM; **hand-write the entire canonical ABI** — no wit-bindgen Java/Kotlin generator exists **(R)** — for a 1,220-line WIT **(T)** under 3,415 lines of Java SDK **(T)** |
| **TeaVM `WEBASSEMBLY_GC`** | — | tag `teavm.javaException` exists but is unreachable **(M)** | **`main` is exported as a `(ref null extern)` global**, constructed by `teavmJso.defineStaticMethod`; 11 `teavmJso.*` + 6 JS-string-builtin imports **(M)** | maintained | 20.7 KB **(M)** | **replaces StarlingMonkey with a JS object model gg writes itself.** Strictly worse than today |
| **TeaVM `C` → wasi-sdk** | Yes | as WASI target | yes | C backend targets native POSIX **(R)** | untested | `fiber.c` needs POSIX signals (`sigaction`, `SIGRTMIN`, `timer_t`) — real porting **(M)** |
| **Kotlin/Wasm `wasmWasi`** | Yes | **No** — `thrown Wasm exception`, **zero stderr, no backtrace, no message (M)**. Message is reachable only by reverse-engineering an undocumented `Throwable`/String layout **(M, incomplete)**; and `-Xwasm-enable-array-range-checks` (correctness) *destroys* the otherwise-legible raw traps **(M)** | encodes to a 692,616-byte component, accepted **(M)**; needs `Config::wasm_gc(true)` + `wasm_function_references(true)` **(M)** | Kotlin/Wasm is **Beta**; WASI **0.1 only**, "0.2 planned" **(R)** | 613–674 KB; runs in 764 µs; JIT 265–290 ms **(M)** | same hand-written ABI burden; 2,928 lines of Kotlin SDK **(T)** |
| **GraalVM Web Image** | — | — | **"You cannot run `.wasm` directly in Wasm runtimes"** — vendor's own words; requires a JS wrapper; Oracle GraalVM 25.1+ **(R)** | experimental **(R)** | — | disqualified |
| **JWebAssembly / Bytecoder** | — | — | browser-targeted | last releases 2022-03 / 2024-05 **(R)** | — | disqualified |
| **`purescript-backend-wasm`** | Yes | untested | **No** — emits **GC-only** modules; the Canonical ABI has no GC story (component-model **issue #525**, open since 2025-06-03) so there is no linear memory for `realloc` and nothing for wit-bindgen to lower through **(R)** | repo created 2026-05-30, one author, last push 2026-07-01, WASI on the roadmap as *not implemented* **(R)** | — | disqualified |
| **Every other PureScript backend** | — | — | targets BEAM / Erlang / Nix / Lua / Chez, or last pushed 2021–2023 **(R)** | — | — | disqualified |

---

## C. Recommendation per arm

**All five: migrate to a quickjs-ng component.** The arms differ in what the change buys them, not in the destination.

**TypeScript and JavaScript — move, and this is where ruling 1 is actually cashed.** The model's program is compiled as a real ES module, byte for byte, importing an SDK module that genuinely exists. `buildScope`, the `new Function`, the 15–16 reserved identifiers, `lineOffset()`, the `--disable stdio`/console-shadowing tangle, and the four `import` refusal messages all disappear. **One thing the engine change does *not* fix: the oxc `Codegen` re-print.** Ruling 1 is not satisfied by an importing guest if gg still hands it a re-rendered AST — the agent's program must reach the engine as written. Fix that in the same change: line-preserving type erasure (the `blank()` trick `typescript.modules.rs:294-302` already uses, which the tree's own comment says is required for exactly this reason before handing the result to `strip_types`, which then rebuilds the tree anyway) or a source map folded down like `jvm.rs:286-315`.

**Java and Kotlin — the owner is right that they never belonged on a JS engine, and the right move today is still to keep them on one.** Ruling 1 on these arms is not about JavaScript; it is about `GgEntry`, the synthesized entry point, the hoisted imports, and the catch chain. On quickjs all four go away, because the guest provides the entry point (module evaluation) and the capture (uncaught handler + rejection tracker) natively — which is precisely what the wrapper was there to fake. That is the whole of ruling 1 and ruling 2 for these arms, obtained as a side effect of a migration TS/JS needs anyway, with **zero** new toolchain risk. Against that: the only JVM-native route that satisfies both rulings was deleted upstream, the only maintained JS-free route returns the string `thrown Wasm exception`, no `wit-bindgen` generator exists for either language, and 6,343 lines of SDK sit on a 1,220-line WIT that would become hand-written canonical-ABI marshalling. **Do not fund a TeaVM fork.** Note also that leaving JS does nothing for these arms' real semantic defects (TeaVM's `a/b` → `0`) — that is a TeaVM question either way, and it remains a live confound.

**PureScript — move with the others; it has no independent choice.** No maintained non-JS backend targets anything gg can host; the one wasm backend pinned to gg's exact `purs` 0.15.16 is ten weeks old, single-author, WASI-less, and emits GC-only modules the Component Model cannot wrap. PureScript's compile-time module resolution is genuine and worth keeping (the self-alias finding — `import Gg.Files as Gg.Files` compiles, the open import does not — was reproduced against the real toolchain). Its `typeof`-switch `Wire.js` shim dies with the injected identifiers. **But its error-location problem is not an engine problem**: `esbuild --format=iife` flattens 327 modules into a 437-line closure and the innermost frame lands inside the SDK. That needs source maps folded down on gg's side, exactly the `jvm.rs` treatment, and it is cheaper than and orthogonal to the migration.

**Do this week, independently of the decision:** delete `--disable stdio` from `build.sh:132`. Measured to convert every uncaught error on all five arms from an opaque trap to a message + stack. The `console.log`-to-stdout risk it was guarding is already handled host-side — `wasmtime-wasi` eats an unconfigured stream, and `wasi_context()` (`membrane.rs:487`) routes stderr to `GuestStderr` and leaves stdout unset. Guest stdout is a WASI stream, not gg's fd 1.

---

## D. Decisive uncertainties

1. **Do the TeaVM, Kotlin-JS and esbuild bundles run on quickjs-ng?** quickjs-ng lacks `TextEncoder`/`TextDecoder`, `structuredClone` and `Intl` (StarlingMonkey has the first two; neither has `Intl`). **This is the gate on the entire recommendation** — if the TeaVM runtime needs `TextEncoder`, the Java and Kotlin arms cannot follow TS/JS across without shims. *Cheapest experiment:* feed the already-built bundles to the already-built quickjs shim at `…/scratchpad/runtimes/js-engines/demo/`. **Hours, no new tooling.** Do this before anything else.
2. **rquickjs-in-a-component vs the hand-written C shim.** The C demo is proof; production should probably be Rust. *Cheapest:* a wit-bindgen Rust guest wrapping rquickjs with the same three test programs. One day. Javy already does the wasm build in CI, so the risk is bindgen/libclang plumbing, not feasibility.
3. **Memory floor and per-run RSS under `MemoryLimiter`.** Unmeasured for both engines. *Cheapest:* run the existing Rust host with gg's limiter attached. Hours.
4. **Does JetBrains have (or would take) an uncaught-exception-to-stderr change for `wasmWasi`?** The single cheapest datum that could revive a JVM-native path. *Cheapest:* a YouTrack search — ten minutes. Not checked.
5. **Is TeaVM's missing exception-header line fixable without a fork?** Only matters if the deleted WASI backend is being reconsidered. Recommend not; a half-day if pursued.

**On WasmGC specifically — the state, and how it was established.** wasmtime **45.0.3** (the workspace's exact lock pin) supports WasmGC and runs `struct.new`/`array.new` correctly with gg's *existing* Cargo feature list, measured on a probe (20M elements, 73 ms). **But gg's engine rejects every WasmGC module today**: `crates/gg/src/sandbox/engine.rs` sets exactly five things — `wasm_component_model`, `epoch_interruption`, `cranelift_opt_level(None)`, `wasm_backtrace_details(Enable)`, `wasm_exceptions(true)` — and **neither `wasm_gc(true)` nor `wasm_function_references(true)`** (I read the function directly; survey 3's phrasing that "gg's engine already enables gc/gc-null" refers to the *Cargo features* at `Cargo.toml:284-302`, not the `Config`, and would mislead the decision). A real Kotlin/Wasm binary was measured rejected until both flags were added. So the fix is two lines — **and WasmGC is not the gate.** Two things behind it are: (a) gg has only `gc-null`, which never frees — 400M structs produced an **opaque trap with no message**, precisely the ruling-2 failure mode — so any WasmGC arm requires adding `gc-drc`, measured at ~9.5× on an allocation loop, and that feature reaches `foray-host` and `lattice-host` through unification exactly as `gc`/`gc-null` did; (b) for a *GC-only* module (`purescript-backend-wasm`) the Canonical ABI has no lowering at all — component-model issue #525 is an open pre-proposal — so the WIT membrane cannot be attached. Kotlin/Wasm escapes (b) because it retains linear memory and was measured to componentize at 692,616 bytes; it dies on its error surface instead.

---

## E. What it costs to do nothing

The five arms stay non-compliant, and the study gg exists to run carries a term that is a property of gg rather than of the language. Concretely, on TS, JS, Java, Kotlin and PureScript but on none of the other six:

- **`import` is a refused keyword.** A model writing the most ordinary line in its language burns a turn on a message explaining that this sandbox has no module system. That failure enters the data as a language result.
- **15–16 top-level identifiers are reserved, and the prompt discloses three.** `const context = …`, `const docs = …`, `const tasks = …` are SyntaxErrors here and legal everywhere else — and they throw at `Function` construction, so they arrive **with no location at all**. This is a gg-shaped failure that will be scored against TypeScript.
- **Run-time error locations are wrong.** TS/JS: off by a program-dependent amount (5 and 7 measured) because gg reports lines in oxc's re-print. PureScript: the frame lands inside a 437-line bundle that is 90% inlined `Data.Foldable`, then has 2 subtracted from it. Java/Kotlin: correct only because 418 lines of VLQ source-map decoding exist to make them so. The other six arms report the model's own line. **The quality of the repair signal therefore differs by arm for gg reasons**, and self-repair rate is one of the things a language comparison measures.
- **A whole failure class is invisible.** A floating async rejection produces a clean exit 0 on these five arms — even with stdio enabled. The program silently did not do what it said.
- **Stack overflow kills the store with no message**; a runaway loop is an opaque epoch trap. Both are catchable, reportable errors on quickjs (measured).
- **Per-turn overhead differs by arm**: a 13.5 MiB artifact, 576–619 ms of Cranelift, ~96 ms of process wall time, against ~15 ms and 79–108 ms for the alternative. Any wall-clock or cost comparison across languages inherits that.

None of these are facts about TypeScript, Java, Kotlin or PureScript. They are facts about a guest that can only run model code as a function body against injected names — the one confound a language-comparison harness cannot have, because it is invisible in the output and systematically disfavours five of eleven arms.

---

## F. The gating experiment — measured, and the five-arm migration holds

Run against **real gg output**, not approximations: bundles produced by gg's own
driver (`GgCompiler.java`, `InProcessBuildStrategy`, `setStrict(true)`, TeaVM
0.12.3, Temurin 21) and gg's own `purs 0.15.16` + `esbuild 0.28.1` with the
pinned 50-package set. Every bundle was run on **V8 as a control**, so a failure
could be attributed to the toolchain rather than to the engine. The harness
reproduces gg's actual evaluation shape — a classic `Function` body with the
legacy grouping names bound — rather than the ES-module shape of the earlier
demo, because that is how these three arms really run (`JSModuleType.NONE`,
`esbuild --format=iife`).

| Arm | Verdict |
| --- | --- |
| **Java** | **RUNS.** No polyfill. |
| **Kotlin** | **RUNS.** No polyfill. |
| **PureScript** | **RUNS.** No polyfill; output byte-identical to V8. |

**The three feared gaps are absent, statically and dynamically.** A sweep of the
entire `teavm-classlib-0.12.3.jar` (all entries, including constant-pool
`@JSBody` strings), the whole pinned PureScript tree (327 compiled modules plus
all foreign JS), and gg's shared guest shim found **zero** references to
`TextEncoder`, `TextDecoder`, `structuredClone` or `Intl`. Heavy programs then
exercised UTF-8/UTF-16 `getBytes` round-trips, `String.format`, `NumberFormat`,
`DecimalFormat`, `SimpleDateFormat`, `java.time`, regex, streams, `BigDecimal`,
Kotlin data/sealed classes and sequences, and PureScript `Data.Map`/`Regex`/
`Exception` — all ran. Across ~78 lines of output on three arms, quickjs-ng and
V8 diverged on exactly **one** call: TeaVM lowers `String.toUpperCase(Locale)`
to `toLocaleUpperCase(tag)`, whose tag quickjs ignores, so Turkish dotted-İ
casing differs. Not a crash, and confined to tr/az/lt.

**`Intl` is a non-issue for a reason worth recording:** not because quickjs is
adequate, but because **TeaVM already is not**. Measured on V8, French and German
date formatting both print `Fri 14 M08 2026`, French and German number formatting
both print `1,234,567.891`, and US currency prints `£12.50` — TeaVM ships no CLDR
data. `java.text.Collator` does not exist in TeaVM at all. The locale-sensitive
behaviour `Intl` would buy is already unavailable on these arms.

**What the migration must replace, and it is code already slated for deletion.**
`shim.ts:182-192`'s `firstProgramFrame` keys on `/Function:(\d+):(\d+)/`, which
matches **nothing** on quickjs — a frame reads `at inner (<input>:5:13)`. It fails
*silently*, falling back to `DEFAULT_BODY_LINE_OFFSET` and mis-attributing every
location. The replacement keys on `<input>` at a measured **+2**.

**gg's TeaVM prelude, by contrast, works unchanged**, because it keys on
`/:(\d+):(\d+)/`, which `<input>:5:13` satisfies. Verified end to end: a Java
program throwing on its own line 3 reports

```
java.lang.IllegalStateException: the spec file was not where I expected
    at program.java:3
```

**byte-identical on quickjs and V8**; Kotlin gives `at program.kts:3`. quickjs is
in fact better behaved here than V8 — one `:line:col` per frame, so the
first-versus-last-match ambiguity disappears.

Performance is a non-issue: a 2 MB `javaheavy` bundle parses and runs in 444 ms
cold, including wasmtime startup.

Two failures encountered were **TeaVM limitations reproduced identically on V8**
— named regex groups `(?<y>…)` throw, and `Integer::sum` / `Matcher.group(String)`
/ `java.text.Collator` do not exist. They are not engine matters, and they are a
live confound in the study regardless of this decision.
