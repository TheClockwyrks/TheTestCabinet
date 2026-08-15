# gg runtime-failure reporting — eleven-arm synthesis

**Scope.** Eleven per-arm audits, all self-reported as *measured*. I re-verified the four pieces of shared host machinery every arm depends on (`engine::classify` at `crates/gg/src/sandbox/engine.rs:326-346`, `with_guest_stderr` at `:357`, `program_error_feedback` at `crates/gg/src/agent.code.rs:996-1001`, `capture::report_error`/`classify` at `crates/gg/src/sandbox/membrane/capture.rs:305-345`, and `SandboxError`'s Display at `crates/gg/src/sandbox/outcome.rs:405-425`); every cross-arm claim below that rests on them is confirmed against the tree, not just the reports. No file was edited.

**The one-line finding.** Reporting is safe exactly where it lives in code the model cannot omit and the ruling cannot delete — the baked guest (C#, C++, Ruby, Python, and Swift by absence). It is at risk exactly where it lives in per-turn generated source (Java `GgEntry.java`, Kotlin `GgEntry.java`, Rust's prologue, PureScript's `entry.js`) or in an evaluation wrapper (TypeScript/JavaScript's `new Function`). Those five-and-a-half arms are the blocked set in section F, and it is not a coincidence: it is the same property, restated.

---

## A. Compliance matrix — eleven arms × five shapes, today

**Verdicts.** `PASS` = the model gets a message that names the fault and, where the language can produce one, a location in the model's own coordinates. `DEG` = a message arrives but the class, the reason or the location is missing or wrong. `ABSENT` = nothing model-facing, or an opaque trap that names nothing. `SPLIT` cells are broken out underneath.

**Confidence.** `M` = measured against the real artifact under the real engine (wasmtime + the shipped component/toolchain). `M*` = measured against a faithful replica (real compiler/real SDK/real shim, different JS engine or a ported host). `R` = read from source, not executed. Where a cell mixes them, the weakest mark is shown and the split is named below.

| arm | (a) uncaught gg ToolError | (b) uncaught native fault | (c) failure *value* / exit status / rejected async | (d) resource fault | (e) explicit abort/exit |
|---|---|---|---|---|---|
| **rust** | DEG `M` | **PASS** `M` | DEG / ABSENT `M` | ABSENT / DEG `M` | PASS / ABSENT `M` |
| **java** | DEG `M*` | DEG `M*` | PASS (compile band) `M*` | DEG `M*` | PASS `M*` |
| **kotlin** | DEG `M*` | DEG `M*` | PASS (compile band) `M*` | DEG `M*` | PASS `M*` |
| **typescript** | DEG `M` | DEG `M` | **ABSENT** `M` | DEG `M` / `R` | DEG `M` |
| **javascript** | DEG `M` | DEG `M` | **ABSENT** `M` | DEG `M` / `R` | DEG `M` |
| **csharp** | DEG `M` | DEG `M` | **ABSENT** `M` | DEG / ABSENT `M` | **ABSENT** `M` |
| **cpp** | DEG `M` | PASS / DEG / ABSENT `M` | **ABSENT** `M` | DEG `M` | DEG `M` |
| **swift** | DEG `M` | **PASS** `M` | DEG / ABSENT `M` | DEG `M` | DEG `M` |
| **python** | **PASS** `M*` | **PASS** `M*` | **PASS** `M*` | PASS `M*` / DEG `R` | PASS / ABSENT `M*` |
| **ruby** | **PASS** `M*` | PASS / ABSENT `M*` | **ABSENT** `M*` | *unverified* `M*` | **ABSENT** `M*` |
| **purescript** | DEG `M*` | DEG `M*` | **ABSENT** `M*` | DEG `M*` / *unverified* | DEG `M*` |

### Cell notes (split cells and the reasons for each DEG)

**(a) — DEG on eight arms for one reason: no location, or a location pointing at a file the model did not write.** Rust (`program::report` hardcodes `location: None`), Java and Kotlin (the bundle tail throws a bare `$ggFailure` record with no `.stack`, so `$ggLocate` is never reached), C# (`shell.c:140` sets `location.is_some = false` unconditionally, and additionally flattens `kind`/`code` so the turn is never recorded as `ToolFailure`), C++ (`shell.cpp:154`; C++ cannot interrogate a caught exception). Swift and PureScript are worse than absent: Swift reports `Swift/ErrorType.swift:254` (the standard library) and PureScript reports a bundle line inside gg's own `Gg/Internal/Wire.js`. TS/JS carry a location that is right against the *stripped* text and wrong against the model's. Python and Ruby are the only two PASSes: model's own line, offset zero.

**(b) — the three PASSes are Rust, Swift and Python** (message + the model's own line, offset 0), with Ruby a near-PASS. C++ is genuinely split: a `std::vector` out-of-bounds is the best single result in the audit (libc++ hardening sentence *and* `/gg/main.cpp:4:22`), a divide-by-zero or wild pointer is located but mute, and a **null dereference is not a fault at all** — measured reading *and writing* through a null pointer succeeded and execution continued. Java/Kotlin carry the correct model line inside the message and then append a spurious second one (see B13). Divide-by-zero: silently `0` on Java and Kotlin, `Infinity` on JS/TS/Ruby (a language property, not a defect), unreported on C++.

**(c) — the worst column in the table, and the subject of section D.** ABSENT on six arms. Java and Kotlin are the only genuine PASSes and they get there by refusing the shape at *compile* time (`return 42` → `program.java:1: incompatible types`; `System.exit` / `exitProcess` → an unresolved method), located in the model's coordinates. Python passes because `SystemExit` is an exception. Rust splits (returned `Err` reports without a location; `process::exit` is an opaque trap). Swift splits (`exit(3)` is located but the reason and the status are destroyed; `Task { throw }` is silent).

**(d)** — stack overflow is the failure mode nobody handles well. ABSENT on Rust and C# (a wall of anonymous or Mono-internal frames; on C# the words "StackOverflowException" are written to stderr and then evicted by the 8 KiB tail policy). DEG on C++ and Swift (the model's own line, repeated ~20 times, with no statement of what happened — the phrase `wasm trap: call stack exhausted` exists in the error's source chain and is dropped). DEG on Java/Kotlin (the engine's `RangeError`, no class, no line; the `catch (StackOverflowError)` clause both arms wrote for it is **dead code**, measured on both). PASS on Python only, and only because `_clamp_recursion` holds the interpreter's limit below the wasm stack. Ruby and PureScript are *unverified*: measured catchable on V8, unmeasured on the shipped SpiderMonkey-in-wasm, with the Python arm's history (recursion killing the store outright) as the discouraging precedent. Allocation is a host ceiling everywhere and carries no location on any arm.

**(e)** — ABSENT on C# (`Environment.Exit`, including `Exit(0)`, and `FailFast` with its message dropped) and on Ruby (`exit` is a **silent no-op and the program keeps running**). Rust splits: `panic!`/`assert!` are fully reported with the model's line; `process::abort`/`exit` are anonymous traps. Python splits: `raise`/`assert` are exemplary; `os._exit`/`os.abort` produce literally nothing.

### Reconciliations where two auditors described shared machinery

**The JVM road (`jvm.rs`, shared by Java and Kotlin).** The two audits agree in every measured particular — the prelude/`$ggLines`/`$ggLocate` fold, the correct model line, the spurious second location, divide-by-zero as `0`, the dead `StackOverflowError` clause, and `Error: Error: null` reproduced byte-for-byte when `GgEntry` is reduced. The one disagreement is with the *tree*, not between auditors: `kotlin.compile.rs:542-557` claims the `setTimeout` refusal is "the ONE failure a Kotlin program can produce that carries no line of the model's own". Both auditors measured that an ordinary uncaught `ToolError` also has none, and the Java audit shows why structurally (the tail's `$ggFailure` branch precedes the branch that calls `$ggLocate`). **The comment is wrong, and it is a shared-road property, not a Kotlin quirk.**

**The oxc strip (TypeScript and JavaScript).** The TypeScript audit says the JS arm "shares the shift (blank lines only)". The JavaScript audit measured a `.js` program whose multi-line function signature and multi-line object literal were re-flowed, giving off-by-six. `Codegen::new().build(&program).code` (`typescript.prepare.rs:316`) re-prints the AST regardless of `SourceType`. **The evidence supports the JavaScript auditor's stronger reading: both arms are equally exposed to line collapse; TypeScript is worse only by the additional erased type declarations.** The two audits used different oxc builds (npm `oxc-transform` 0.144 vs the pinned crate 0.141) and the effect reproduced on both, so the version is not load-bearing.

**The shared TypeScript component (TS, JS, Java, Kotlin, PureScript).** Five audits describe the same `shim.ts:569-589` catch and `describe()`/`firstProgramFrame()` formatter, and appear to disagree about location quality: "offset 0" (TS/JS), "line 1383 for a 3-line program" (Java/Kotlin), "+235, inside gg's own SDK" (PureScript). These are one mechanism with five different inputs. `firstProgramFrame` reports the innermost frame of *whatever text was handed to `new Function`*, and that text is the model's text on none of the five arms — it is a re-printed strip (TS/JS), a ~1,400-line TeaVM bundle (Java/Kotlin), or an esbuild bundle (PureScript). **The `location` field is trustworthy on zero of the five arms today.** Java and Kotlin survive only because the *message body* carries the correct `at program.java:N` separately — which is the line at risk in the conversion, while the bogus one is the line that survives.

**The injected scope.** Java, Kotlin, PureScript and JS/TS all resolve `fs`/`view`/`harness`/`gg` as free identifiers against `shim.ts:442-468` `buildScope`. Three auditors measured its removal independently and got the same class of result: `Wire.java`/`Wire.js`'s "did not reach the guest: gg's SDK declares it and this run's guest does not export it, which is a mismatch between the two rather than anything this program did", or a bare `ReferenceError`. That sentence is the worst possible instruction to a model, because the correct response to it is to do nothing. **Deleting `buildScope` is a five-arm event and cannot be sequenced per arm.**

**"Where is the wrapper?"** The Kotlin audit's correction generalises and the C++ and Rust audits corroborate it. On Java and Kotlin the wrapper is not *around* the model's source — it is *beside* it (`GgEntry.java`), so a naive audit of "does gg prepend text" marks both arms clean (Kotlin's `wrap_program` is byte-identical with no imports) and deletes the catch chain by accident. The C++ audit makes the mirror-image point: `shell.cpp` looks like a wrapper, is not one, and is the single load-bearing file on its arm. **The test is not "is text prepended"; it is "is any code that catches or formats a failure generated per turn, or reachable only from generated text".**

---

## B. Live defects — failing the requirement today, before any conversion

Ranked by how badly a model is left stuck.

### Tier 1 — the run records a success when the program failed (the model is told the opposite of the truth)

1. **Ruby `exit` / `exit 1` is a silent no-op and execution continues.** Measured: `at_exit { puts "at_exit" }; puts "a"; exit 1; puts "b"` → logs `["a","at_exit","b (still running)"]`, no `report-error`, clean turn. Cause is in the baked runtime: `.build/opal.js:115` defines `Opal.exit` as a no-op that only logs under `$DEBUG`; `Kernel#exit` drains `at_exit`, discards the status, returns `nil`. The model's stated intent is inverted and the following statements run against it. Worst single defect in the audit.
2. **C# termination by value is invisible.** `public static int Main() { … return 3; }`, `Environment.ExitCode = 4`, and an unobserved faulted `Task` all produce a clean turn. `shell.c:232` discards `mono_runtime_run_main`'s return value. Fix is two lines in `shell.c`.
3. **TS/JS rejected promise or deferred throw is reported nowhere.** Three spellings measured (`Promise.reject`, `.then(() => { throw })`, `(async () => { throw })()`), all `errors: []`, all clean turns. `async`/`await` is the first reflex a model brings to a new runtime. The engine defines `unhandledrejection` and never fires it (`shim.ts:311-329`).
4. **Swift `Task { throw Boom() }` runs to completion silently** — no trap, no stderr byte, no report, exit 0. The Swift SDK binds only `feedback.log`; there is no `report-deferred` on the arm at all.
5. **Python `os._exit(n)` / `os.abort()` produce nothing** — measured, the harness printed nothing at all, and even the already-buffered log line was never summarised. `os` is in the baked library set, so both are reachable from any program.
6. **C++ `return 1` from `main` is discarded by design** (`shell.cpp:205` `(void)__main_void()`), with not even a `note-return` notice.
7. **Ruby's last-expression error value and PureScript's entire (c) column have no channel at all** — Ruby deliberately never calls `note-return`; PureScript's IIFE always evaluates to `undefined`, making `shim.ts:576-585` dead code on that arm.

### Tier 2 — silently wrong *answers* (the program looks like it worked)

8. **Java and Kotlin: integer divide-by-zero yields `0`.** TeaVM lowers `a/b` to `(a/b)|0`; `setStrict(true)` does not restore the check; the `ArithmeticException` clause in `CAUGHT` is unreachable for `/`. Asserted as intended in both arms' tests. The requirement names divide-by-zero explicitly, so this fails it outright with no wrapper involved.
9. **Rust integer overflow wraps silently.** `-Copt-level=s` (`rust.compile.rs:326`) leaves debug-assertions off; measured `4_000_000_000u32 + 1_000_000_000u32` logged `705032704` and returned `Ok`.
10. **C++ null dereference is not a fault.** Reading *and writing* through a null `point*` both succeeded and execution continued; the turn was a success.

### Tier 3 — a location that looks right and is wrong (the model edits the wrong line)

11. **TS/JS: every runtime location is in the stripped file's coordinates, off by a program-dependent N.** Measured off-by-six on a 13-line JS program (model line 10 reported as line 4, column off by one as well because oxc indents with a tab). The offset equals blank lines plus collapsed continuations above the fault, so it grows with the program. `outcome.rs:283` and `gg-sandbox.wit:1095` both *claim* the location is in the program's own coordinates. Every location assertion in the suite uses a one-line or blank-line-free program, which is exactly why it is green.
12. **PureScript: the location is always a bundle line inside a file the model did not write** — measured +235 (gg's own `Wire.js`), +168 (`Partial/foreign.js`), +102 (prelude's `Data.Show`), +181 (the model's own compiled module, in bundle coordinates). Acknowledged in-tree by a test literally named `a_located_failure_names_the_bundle_rather_than_the_model_s_purescript`. Its stated fix ("`purs` and `esbuild` both emit source maps and the host holds them") is **false today**: neither `--codegen sourcemaps` nor `--sourcemap` is passed. A cheaper partial fix exists and was measured: the model's own frame *is* in the stack, just not innermost — selecting the outermost in-bundle frame already names the model's compiled module.
13. **Java/Kotlin ship a correct location and then a wrong one.** `program_error_feedback` unconditionally appends the `location` field, so the model reads `Error: java.lang.NullPointerException` / `at program.java:3` / `at line 1383, column 9`. The second is a different file in a coordinate space the model cannot open. After conversion the *good* line is the one at risk and the bogus one is the one that survives.
14. **Swift: an uncaught throw is located at `Swift/ErrorType.swift:254`** — the standard library. This is the shape an uncaught gg `ToolError` takes, i.e. the single most likely runtime failure a gg program has.
15. **Python: `location` is not qualified by file.** Measured: a 3-line program calling into a code module that fails on its line 6 reports `at line 6, column 12`. Documented behaviour, which makes it intended and still wrong.

### Tier 4 — opaque: something failed, nothing says what

16. **`engine.rs:342` uses `err.to_string()` and throws the trap's reason away.** Confirmed in the tree. wasmtime attaches the backtrace as the *outermost* context and the reason as its source, so `wasm trap: integer divide by zero`, `wasm trap: call stack exhausted`, `out of bounds memory access` and `Exited with i32 exit status N` never reach the model. Measured independently on C++, Swift and Rust. **`{err:#}` is a one-character-class fix that improves every trapping arm at once — the highest value-per-line item in this audit.**
17. **Stack overflow is opaque or near-opaque on six arms** (Rust: ~20 anonymous frames; C#: 17 Mono-internal frames; C++/Swift: the model's own line repeated with no words; Java/Kotlin: `RangeError`/`Maximum call stack size exceeded` with no class and no line).
18. **Explicit exit and abort are traps with the status destroyed** — Rust `process::exit`/`abort`, C# `Environment.Exit`/`FailFast` (message dropped), C++ `std::exit`/`abort`/`terminate`, Swift `exit(n)` (and the committed preview1 adapter imports only `wasi:cli/exit.exit`, collapsing every non-zero status to 1).
19. **The 8 KiB stderr tail evicts the one useful line.** Measured on C#: 72,142 bytes written, the `StackOverflowException` header written *first* and dropped, the surviving tail being ~117 copies of a single frame. The policy should preserve the head as well as the tail.

### Tier 5 — right message, no location, on the commonest failure there is

20. **An uncaught gg `ToolError` carries no usable location on seven arms** (Rust, Java, Kotlin, C#, C++ absent; Swift, PureScript misleading). A sixty-line program with twenty `read_file` calls is told which call name failed and given no way to find which call site. On Rust the `#[track_caller]` machinery that locates every panic is available on this path and simply is not used.

### Tier 6 — misdirection and plumbing

21. **The OOM sentence tells every arm about a JavaScript engine.** Confirmed in `outcome.rs:412-418`. On Rust, Swift, C# and C++ the parenthetical is false and misdirecting.
22. **`engine::classify` returns on `memory_denied()`/`timed_out()` *before* `with_guest_stderr`.** Confirmed in the tree. Measured cost on Swift: the guest had already written `Fatal error: failed to allocate 33554440 bytes of memory with alignment 4` and DWARF located it at `/gg/work/main.swift:3:32` — both discarded, and replaced by a location-free sentence about a JavaScript engine.
23. **`report_error` unconditionally revokes a declared `session.finish`.** Confirmed at `capture.rs:305-306`. Combined with Python reporting `sys.exit(0)` as a throw, a program that finishes cleanly and then exits cleanly loses its ending.
24. **`exit(0)` is charged as a failure** on Python (`SystemExit: 0` → `ProgramThrow`), Swift, C++ and C# — four arms where the idiomatic clean ending is billed against the model's error budget.
25. **`module_errors` has no model-facing consumer.** Produced by four guests, merged and deduplicated in `agent.code.rs`, rendered into no `CodeFeedback`. A model whose `lib.helper` is empty is told nothing, against the promise in `outcome.rs:87-92`.
26. **Two arms have no deferred channel at all** — the C# guest calls only `log` and `report_error`; the Swift SDK binds only `log`.
27. **The fatal band swallows model-fixable mistakes.** PureScript's `classify_bundle` routes everything but `"No matching export"` to `PrepareFailure::Toolchain` → `FatalFault::Toolchain` → run ends, nobody told. Java's `verdict` does the same for a compile error located in gg's own generated file. **These are precisely what a mis-shaped model-authored entry point will hit after conversion.**
28. **C# flattens every `ToolError` to `kind: other, code: none`** (`shell.c:136-143`), so C# is already absent from any cross-arm `ToolFailure` metric — the exact confound `capture::classify` exists to prevent.
29. **gg's own frames reach the model** — C++ ships `exports_sandbox_run` and `wasisdk://…` paths; C# ships `Gg.Internal.Wire.Check` as the top frame despite the `[MethodImpl(NoInlining)]` comment written to prevent it — against the stated rule at `agent.code.rs:160-162`.
30. **TypeScript has no `typescript.substrate.test.rs`.** Verified: the arm with the measured off-by-N has no substrate file of its own; its coverage rides on `javascript.substrate.test.rs`.

**Cross-arm fixes worth landing before any conversion work** (four of them are a few lines in shared host code): `{err:#}` at `engine.rs:342` (16); handle `wasmtime_wasi::I32Exit` in `engine::classify` (18, 24 — see D); stop early-returning past `with_guest_stderr` (22); arm-appropriate OOM text (21); head-and-tail stderr (19); a file-qualified `location` or a frame list on the wire (11-15 at once); a consumer for `module_errors` (25).

---

## C. Conversion risk, per arm

The pattern to test, established on Rust: **the SDK carries the wiring; the model writes only the entry point** — the `Guest` impl and `export!` move into the SDK, the model's file becomes `fn main()`, and the panic hook is re-installed by an SDK-side `#[used] #[link_section = ".init_array"]` constructor.

### Rust — pattern works for (b) and half of (e); does not reach (a) or (c)

**Deleted:** `rust.source.rs:59-77` in its entirety — `begin("program.rs", 1)` (installs the panic hook), `report(&failure)` (the only caller), the `-> Result<(), gg::Failure>` return type (the only channel `?` can propagate into), `LINE_OFFSET`, and the `impl Guest` + `export!`.

**Measured degradation with no replacement:** an index-out-of-bounds goes from `panicked: index out of bounds: the len is 3 but the index is 7` + `at line 3, column 21` to `the sandbox trapped:` + ~20 stripped anonymous frames — strictly worse than Java's `Error: Error: null`, which at least names a class. There is no stderr fallback: no WASI imports, `println!` is a sink, `panic_output()` is `None`, so `with_guest_stderr` has nothing to prepend.

**What the ctor rescues:** shape (b) and the `panic!`/`assert!` half of (e) — the hook needs nothing from the model, and wit-bindgen already emits `run_ctors_once()` on the export path. It also *partially* rescues (a): a model's `.unwrap()` on a failed gg call becomes a panic the hook catches, at the model's own line, but the message degrades from the composed `` `read_file` failed (not-found): … `` sentence to a `Debug` dump.

**What it does not rescue:** shape (c). With no gg-owned `Result` return type there is no `Err` to report, and `refuse_main` — which exists precisely to stop a returned `Err` being silently discarded — is deleted by the same ruling. See section D for the concrete fix.

**Must land in the same commit:** `LINE_OFFSET` → 0. `located()` does `line.checked_sub(line_offset)`; leaving it at 1 sends the model to the line *above* every fault and loses the location entirely for a fault on line 1.

### Java — pattern does **not** transfer as written; blocked

**Deleted:** `GgEntry.java` (`java.compile.rs:587`) — the twelve-clause `catch` chain, `refused()` (the only producer of `$ggFailure`) and `seen()` (the only producer of `$ggMessage`). The bundle tail survives but degenerates to `throw $ggThrown`; `$ggLocate` becomes unreachable because the tail calls it only on the branch `$ggMessage` gates; the source-map fold survives as dead code.

**Measured degradation:** three distinct native faults collapse to the identical `Error: Error: null` with no location; an uncaught `ToolError` loses the tool name and the code and drops from `kind: tool-failure` to `other`; an explicit throw keeps its message but loses its class and its line.

**Why "SDK carries the wiring" is harder here:** the class-name enumeration exists because TeaVM answers `null` for `getClass().getName()` on a `NullPointerException` — the chain is not decoration, it is the only way to name the fault. A replacement must live in `packages/gg-sandbox-java` and install itself (an SDK static initializer registering `Thread.setDefaultUncaughtExceptionHandler`, or an SDK entry the compiled program's own `main` reaches through). **Whether TeaVM honours a default uncaught-exception handler for an exception escaping `main` is unverified and is the gating experiment for this arm.** If the answer is "the model must call it", that is the wrapper moved into the prompt, and a model that forgets gets `Error: Error: null`.

**Second blocker:** `java.compile.rs`'s `verdict` turns any compile error located in gg's own generated file into a *fatal* toolchain fault. A mis-shaped model-authored entry point is exactly the shape that hits it.

### Kotlin — same as Java, plus a binary structural choice

Everything above applies verbatim (the auditor reproduced `Error: Error: null` on Kotlin too). Additionally: **the arm cannot keep its `.kts` script shape without a synthesized entry point.** Measured — pointing TeaVM at the compiled script class directly fails with `Class kotlin.script.experimental.jvm.RunnerKt was not found`, because the script's synthetic `main` routes through the scripting runner, which is not on the program classpath. So the choice is: keep a synthesized entry, or stop compiling programs as scripts and require `fun main()`. The latter forfeits the measured reason the script shape exists and changes what the model must write.

### TypeScript and JavaScript — the pattern is the wrong shape; the problem is the evaluation mechanism

**Deleted:** `shim.ts:570` `new Function(...names, program)` and with it the single `try`/`catch` at `:569-589` (the only caller of `report-error`), `buildScope()` (and therefore `guard()`/`attribute()`), `installDenials` (which converts an unshadowed `fetch` from an uncatchable store trap into a located error), `isThenable`/`noteReturn`, and the `allow_return_outside_function` / import / top-level-`await` refusals in `typescript.prepare.rs`.

**Measured degradation:** two independently built variant components (one with the `try` removed, one exporting an entry that throws) produced, for *every* failure, the byte-identical result — `RuntimeError: unreachable` and an anonymous wasm backtrace, with **zero bytes of stderr** (the component is baked `--disable stdio`). Three different failures, one identical trap.

**Location dies independently and would die even if a new catch were installed.** `firstProgramFrame` recognises exactly one thing: the `Function:<line>:<col>` marker the `Function` constructor puts on frames. Measured: the identical throw at module scope carries no such marker. A near-miss was also measured — for `eval("\nnull.x;")` the regex fell through to the outer frame and reported the *call site* as if it were the fault. That is the off-by-N failure mode arriving silently.

**Replacement needed before deletion:** (1) a catch that still wraps module evaluation synchronously, plus an explicit rejection drain, since dynamic `import()` is asynchronous (and in this component is itself a measured opaque trap at `path_filestat_get`); (2) a location recovery from a source map emitted by the strip — which also fixes live defect 11; (3) per-call attribution moved into the SDK modules, where the seven library arms already do it. **If the conversion goes the per-turn-bake route instead, note the measured constraint: a module that calls a gg host import at top level traps Wizer at bake time,** so the program cannot do its work at module scope at all — though bake-time throws *are* reported with the model's own coordinates on the builder's stderr, which is a real diagnostic gg does not currently capture.

### C# — safest arm; the danger is over-reading the ruling

**Deleted:** `GlobalUsings.cs` only. Consequence is compile-time and located at the model's own line and column. **Zero reporting hops pass through it** — every hop lives in `shell.c`, compiled once into the prebuilt component.

**Two things the ruling must *not* be read to require.** (i) Moving the SDK to a separately referenced assembly: `shell.c` fixes one assembly name and registers one bundled resource, so a referenced SDK DLL is a `FileNotFoundException` on every program that touches gg's surface — an arm-wide outage. (ii) The same move would take `OperatorConsole`'s `[ModuleInitializer]` with it, and `flush_operator_console` looks the class up *in the program's image* and silently returns if absent — so `Console.WriteLine` would stop reaching `feedback.log` and the model would lose the "how far did I get" line that was the only context in every measurement. **Read the ruling for C# as: delete the `global using` lines, keep the SDK in the same compilation.** `using Gg;` *is* the import in C#'s own terms.

**Do not touch `shell.cpp`'s C# analogue** — there isn't one, but see C++.

### C++ — safe, with one file that must be labelled untouchable

**Deleted:** `-include-pch prelude.pch` (which supplies `#include "sdk/gg.hpp"`, `using namespace gg;` and the 60-header stdlib set). **Measured: a whole program compiled with no PCH at all, the model writing its own `#include` and `gg::` qualifications, produced a byte-identical error report.** The trap road is untouched too.

**The single load-bearing file is `shell.cpp:201-226`** — the `try`/`catch` around the call into the model's TU. It is not a wrapper of the model's bytes, but it is the file most likely to be mistaken for one. Measured with it removed: the *entire* model-facing text becomes `the sandbox trapped: thrown Wasm exception` — no class, no `what()`, no code, no location, not even a backtrace, and the turn reclassifies from `ProgramToolError` to `SandboxTrap`.

**Three non-source dependencies to guard:** the wasmtime `addr2line` + `demangle` cargo features (measured: without them the same fault reports bare addresses and no libc++ sentence), `-g1`, and `-ffile-prefix-map`. Losing any one silently turns shapes (b), (d) and (e) into addresses.

### Swift — safest structurally; the arm the pattern cannot be copied *to*

**Deleted:** `@_exported import gg` (`shell.swift:35`), which carries zero reporting. Cost: one `import gg` line the model writes itself, and forgetting it is a compile error — the best-reported band this arm has.

**Under a maximalist reading that deletes `shell.swift` entirely**, the reporting is *unchanged*: every string in the Swift audit was measured on exactly that shape (a wasip1 command invoked at `_start`) and it reproduces the arm's own component-path test assertions. That is the strongest statement available anywhere in this audit.

**Guard `-g`, `wasm_backtrace_details(Enable)` and `-file-prefix-map`.** Measured with `-g` removed: an index-out-of-range degrades to three anonymous frames with no message, no file and no line, for a failure the guest cannot catch. `-g` costs ~5.6 KB of a ~7.1 MB artifact and *is* this arm's error surface.

**And the general warning:** any cross-arm design that says "move the reporting into a guest-side reporter" cannot be applied here. Swift's failures are unrecoverable by design; there is no point where a hook could run before the trap; the SDK binds only `feedback.log` and never `report-error`. Swift's host-side floor (trap + DWARF + stderr tail) is what the other arms would be *degrading to*, not a place to aim.

### Python — nearly free; one measured regression with a known fix

**Deleted:** exactly two lines — `scope.update(gg_scope.build_scope())` and `scope["lib"] = lib`. Everything that catches, classifies, renders and locates lives in `shim.py`'s own function body inside the interpreter, prepends nothing to the model's source, and shifts no lines. The model's bytes already go across verbatim with offset 0.

**The one regression, measured both ways:** `_unknown_gg_name` tests `isinstance(exc.obj, gg_scope.Bound)`, and `Bound` exists only in the injected scope. Post-conversion a typo goes from `kind: UNKNOWN_NAME` + "`gg.files.read_fil` is not one of the functions gg declares there; it declares edit_file, list_dir, read_file, read_text_file, write_file" to `kind: OTHER` + "module 'gg.files' has no attribute 'read_fil'". Two losses: the enumeration, and the turn metric moving from `ProgramUnknownName` to `ProgramThrow` — the cross-arm confound `capture::classify` exists to prevent. **Fix in the same commit:** a `__getattr__` on each `gg.*` module raising the same sentence, or teach `_unknown_gg_name` to recognise a module inside the `gg` package.

**Do not sweep `_clamp_recursion` up as "prologue".** Measured history: without it, recursion past the wasm stack does not fail — the store dies and the turn *disappears* with no `report_error` at all. It is the single most dangerous line to touch on this arm.

### Ruby — nothing on the reporting path is deleted; the hazard is the build

`compile_program` passes the model's bytes to Opal verbatim; the only `format!`-wrapping in the arm applies to code skills and memories. The catch, `report()`, `locate()`, the source-map decoder and the `describe()` fallback all live in the baked component's `run` export. **All five shapes are unchanged by the conversion — including the two that are already broken.**

**The real hazard is the other half of the ruling.** If the model must write its own import, the natural spelling is `require "gg"` — measured today: `LoadError: cannot load such file -- gg`, because `tools/guest.mjs` emits the SDK as a bare `Opal.queue(...)` and never registers `Opal.modules["gg"]` (the curated libraries *are* requirable; `require "json"` resolves). **That `guest.mjs` change must land before conversion or every converted program fails on line 1.**

**Second hazard:** `lineOffset()` calibrates against `new Function`. Anyone "de-wrapping" by changing *how* the program is evaluated shifts every reported line silently. That is the one edit on this arm that turns an absence into an off-by-N, and it is not what the ruling asks for.

### PureScript — the most dangerous arm; the pattern does not transfer at all

**Deleted:** `entry.js` (`import { main } from "./output/Main/index.js"; main();`), `retarget()`, and the `--format=iife` + injected-scope arrangement.

**Measured degradation of deleting `entry.js`: total silence.** Bundled with no synthesized call, esbuild tree-shook the entire program away — 204 lines became 28 — and the result was `{ logs: [], noteReturn: false, programError: undefined }`. gg reports a **clean turn**. All five shapes degrade to this identically. This is strictly worse than Java's `Error: Error: null`, which at least says something failed.

**"SDK carries the wiring" cannot work here.** A PureScript module has no top-level effects; nothing self-executes; there is no `.init_array` equivalent and no constructor the SDK can install. The only honest options are (i) keep a host-side call to a named export — a synthesized entry point by another name — or (ii) require the agent to write an FFI shim beside its module, which is a second file and a second compile unit.

**Two additional landmines.** Deleting `retarget()` while keeping the fixed entry path means a model that writes `module Solve where` produces an esbuild `Could not resolve "./output/Main/index.js"`, which `classify_bundle`'s catch-all routes to `PrepareFailure::Toolchain` → **fatal, run over, model never told why**. And deleting the scope turns every gg call into `Error: \`Gg.Files.readFile\` did not reach the guest: … a mismatch between the two rather than anything this program did` with no `code`, so `capture::classify` can no longer class it and `Gg.Core.attempt` can no longer narrow it — the model's own error handling stops working and the message tells it to do nothing.

---

## D. Shape (c) — the arms where failing by *returning* is invisible

**The Rust hole, restated.** On `wasm32-unknown-unknown` there is no stderr, so `fn main() -> Result<(), Box<dyn Error>>` returning `Err` produces nothing: std's `Termination` report goes to a stream that does not exist, and the shell sees only exit code 1. Today the prologue's `-> Result<(), gg::Failure>` + `report(&failure)` is what makes this shape reportable at all; the conversion deletes both, and the SDK ctor does not rescue it because a returned `Err` is not a panic.

**Who else has the same hole today.** This is not a conversion-created problem on most arms — it is already the state of the tree.

| arm | the language's "I failed by returning" | reported? |
|---|---|---|
| **rust** | `main` → `Err`; `process::exit(n)` | `Err` reported *only* by the prologue (deleted); `exit` is an anonymous trap |
| **csharp** | `int Main()`, `Environment.ExitCode`, faulted `Task` | **No** — `shell.c:232` discards the value; measured clean turn |
| **cpp** | `return 1` from `main`; `std::exit(n)` | **No** — `shell.cpp:205` `(void)__main_void()`; `exit` is a trap with the status flattened then dropped |
| **swift** | `exit(n)`; a failed `Task` | Status destroyed twice (adapter imports only `wasi:cli/exit.exit`; then `to_string()` drops "Exited with i32 exit status"); `Task` silent |
| **ruby** | `exit n`; last-expression value | **No** — `exit` is a no-op; no `note-return` by design |
| **purescript** | any returned value | **No** — the IIFE always evaluates to `undefined`; `noteReturn` is dead code |
| **typescript / javascript** | returned value; rejected promise | Half — `note-return` fires but is **operator-only**, and the value's message is discarded; a rejected promise is silent |
| **python** | `sys.exit(n)` | **Yes** — the only clean pass in the tree, and only because `SystemExit` is an exception. `os._exit`/`os.abort` are still silent |
| **java / kotlin** | `return 42`, `System.exit` | **N/A, correctly** — refused at compile time with the model's own line |

**The structural reading.** On five arms (Rust, C++, C#, Swift, Python) the process exit status *is* a first-class failure channel in the language, and gg reads it on exactly one — and there only by accident of Python's design. The WIT has no "the program ended with status N" message; `report-error` is the only door. That is fine: it just has to be walked through.

**Two fixes, one host-side and one per-arm:**

- **Host-side, covers four arms at once:** `engine::classify` has no `wasmtime_wasi::I32Exit` handling anywhere in `crates/gg/src` (confirmed: zero hits). `std::exit`, `Environment.Exit`, Swift's `exit` and Python's `os._exit` all arrive as `proc_exit` → an unclassified trap. Matching `I32Exit` and turning it into a `ProgramError` — "the program exited with status N" — converts C++'s, C#'s, Swift's and Python's shape (e) and half of their shape (c) from an opaque backtrace into a sentence, in one place.
- **Per-arm, in the SDK, not in the model's file:** each arm's guest-side entry glue must *read* what `main` returned. C++ and C# are two lines each (`shell.cpp`/`shell.c` already have the value in hand and throw it away). For Rust the shape that satisfies both rulings is std's own trick: the SDK's `export!` glue calls `crate::main()` through a generic `fn finish<T: GgTermination>(t: T)` with blanket impls for `()` and `Result<T, E: Debug + Display>`, so a returned `Err` is reported with its message and the model still writes nothing but `fn main()`. That keeps the wiring in the SDK, keeps the model's file whole, and closes the hole the conversion would otherwise open. It is a design, not a measurement — it should be prototyped as part of the Rust gate.

**Why this column is the one most likely to be missed:** it is not an exception anywhere. Every arm's reporting machinery is built around catching a throw, so a program that fails by returning walks straight past all of it, and the run is recorded as a success. Six of eleven arms fail it today; the conversion adds a seventh (PureScript goes from silent-on-(c) to silent-on-everything, and Rust goes from reported to silent).

---

## E. Gate G8 — a concrete, writable test design

**Where it lives.** One test module per arm, in the arm's existing substrate file: `crates/gg/src/sandbox/language/<arm>.substrate.test.rs`. Verified present for cpp, csharp, java, javascript, kotlin, purescript, python, ruby, rust, swift. **TypeScript has no substrate test file at all** — G8 requires creating `typescript.substrate.test.rs`, and it is the arm with the measured off-by-N, so this is a gap worth closing on its own merits.

**What it drives.** A real run through the real component and the real toolchain — the same path the substrate tests already use, not a harness. Five programs per arm, in the arm's own spelling:

| shape | program | per-arm spelling notes |
|---|---|---|
| (a) | one gg call the host answers `not-found`, uncaught | identical everywhere |
| (b) | an uncaught native fault | index out of bounds / force-unwrapped nil / failed cast. **Never divide-by-zero** — it is not a fault on Java, Kotlin, JS, TS or Ruby |
| (c) | termination by a failure *value* | `return Err` / `return 1` from `main` / non-zero exit status / an unobserved rejected promise or faulted `Task` |
| (d) | unbounded recursion; plus a second case for the memory cap where reachable | |
| (e) | explicit abort — **both** spellings: the raising one (`panic!`, `throw`, `error(…)`, `fatalError`) and the process one (`exit(1)`, `abort()`), **plus `exit(0)`** | |

**What it asserts.** Five assertions, identical on every arm — the uniformity is what makes it a gate rather than eleven ad-hoc tests. Crucially, **it asserts on the rendered model-facing body, not on the `ProgramError` struct**, because C#'s kind-collapse and Java's spurious second location only exist in the rendered form. That needs a small test helper that mirrors the two production renderers: `program_error_feedback(error)` for a reported error and the `sandbox_failure_decision` fallback body for a trap.

1. **Non-empty.** `assert!(!body.trim().is_empty())`. This is the requirement's literal floor.
2. **Names the fault, in the program's own words.** `body.contains(<a token the program itself chose>)` — the message the model wrote (`"the invariant does not hold"`), the tool name and code (`read_file`, `not-found`), or the class the language names (`IndexOutOfBounds`, `NullPointerException`, `index out of bounds`). **Never assert on a gg-authored string alone** — that is how `Error: Error: null` passed review.
3. **Not only machinery.** `assert!(!body.starts_with("the sandbox trapped:"))`, except on the arms where a trap is the accepted road (C++, Swift), where it instead asserts the body contains the arm's program-file marker (`main.cpp:`, `main.swift:`) **and** the trap's reason word — which is the assertion that would have caught defect 16.
4. **Location.** Where the arm can produce one, assert the reported line equals the model's own line in a program **deliberately written with a comment header, blank lines and a multi-line call**, so an off-by-N cannot hide. (Today's suite is green only because every location assertion uses a one-line program.) Where the arm cannot produce one, assert `location.is_none()` **explicitly** — a negative assertion that documents the hole and fails loudly the day someone ships a *wrong* one.
5. **Turn class.** Assert `TurnErrorType` is not a success, and for (a) that it is `ProgramToolError`. This is what catches the measured Java/Kotlin collapse from `ToolFailure` to `Other` and would have caught C#'s standing flattening.

**How it should fail.** With the model-facing text quoted in the assertion message, so the failure output *is* the regression report:

```
assert!(body.contains("not-found"), "the model would have read:\n{body}");
```

**Two tiers, and this is the part that makes it usable now.** Tier 1 holds the cells that pass today and must stay green through the deletion. Tier 2 is a `known_hole_*` test per ABSENT/DEGRADED cell that asserts the **current bad output verbatim** — e.g. that C# `Environment.Exit(1)` renders a body beginning `the sandbox trapped:` with no exit code. That is not endorsement: it pins the hole so that closing it is a deliberate, visible edit, and so that nobody can make it *worse* silently. Every Tier 2 test carries the section-B item number in its name.

**Which arms could adopt G8 today with no other change: all eleven.** No arm needs new machinery — every substrate suite already stands up a real run, and every auditor drove all five shapes through a faithful path. What differs is only how many cells start in Tier 2:

- **Python** — 4 of 5 in Tier 1; only `os._exit`/`os.abort` in Tier 2. Cleanest adoption.
- **Rust, Swift, C++, C#** — measured under the real host this session; (a)/(b) and part of (e) in Tier 1, the rest Tier 2.
- **Java, Kotlin** — (a)/(b)/(e) in Tier 1; (c) becomes a *compile-band* assertion (assert the located compile diagnostic, which is the correct behaviour); (d) Tier 2.
- **Ruby** — (a)/(b) Tier 1; (c)/(e) Tier 2; **(d) should be written even though its outcome is unknown**, because the real component under wasmtime is the only thing that can settle whether stack exhaustion is catchable or kills the store, and no test on any ECMAScript-guest arm settles it today.
- **TypeScript, JavaScript, PureScript** — adoptable, but assertion 4 goes red immediately, which is the point: it is live defect 11/12. Write it as Tier 2 pinning the wrong number, with the Tier 1 promotion blocked on the source-map work.

**One extra assertion worth adding to every arm's Tier 1 while writing this:** that the body contains no gg-internal frame (`exports_sandbox_run`, `wasisdk://`, `Gg.Internal.Wire`), which enforces the rule already stated at `agent.code.rs:160-162` and currently unenforced on two arms.

---

## F. Ordering — which arms are unsafe to convert until a reporting gap closes

This is the practical output. **Four-and-a-half arms are hard-blocked; five are safe now; two are blocked on a decision rather than a fix.**

### Hard-blocked — do not delete anything until the named replacement exists and G8 Tier 1 is green

1. **PureScript.** Two independent blockers. (i) Deleting the synthesized entry produces **total silence and a clean turn** — measured, not projected. Nothing may be deleted until an execution mechanism is chosen, and neither option is the Rust pattern. (ii) `classify_bundle`'s catch-all routes a model-fixable mistake (a module not named `Main`) to a *fatal* toolchain fault that ends the run and tells nobody — and a model-authored entry point makes that the likeliest failure of the conversion itself. Both must be fixed first. This is the most dangerous arm in the set.
2. **Java** and **3. Kotlin.** `GgEntry`'s catch chain is the only producer of `$ggMessage`/`$ggFailure`, and its deletion was measured on both arms to collapse three distinct native faults into the identical `Error: Error: null`. Blocked until the chain, `refused()` and the class-name enumeration move into the SDK **and are demonstrated to fire** — the TeaVM uncaught-handler question is unverified and is the gating experiment. Kotlin is additionally blocked on the `.kts`-versus-`fun main()` decision (measured: a script class cannot be TeaVM's entry point). Both are also blocked on Java's `verdict` → fatal-toolchain path, for the same reason as PureScript.
4. **TypeScript** and **5. JavaScript.** The single `try` around `new Function` is the entire reporting mechanism; its removal was measured on two independently built variant components to produce an identical opaque wasm trap for every failure, with zero stderr. Blocked until a catch wraps module evaluation, a source map supplies the location (which also closes live defect 11), and per-call attribution moves into the SDK. **These two cannot be sequenced independently of Java, Kotlin and PureScript**, because `buildScope` deletion takes all five arms down at once — plan it as a single change across the shared component, not five per-arm changes.
6. **Rust — conditionally blocked.** The `.init_array` ctor rescues (b) and the panic half of (e), which is real progress. But (a) degrades in message quality and **(c) is converted from *reported* to *silent*** — the exact hole in section D. Rust is safe to convert the moment the SDK glue reads `main`'s return value (the `GgTermination` shape above), and not before. `LINE_OFFSET` → 0 must land in the same commit or every reported line is off by one.

### Safe to convert now, with the named guardrail

7. **C#** — delete `GlobalUsings.cs` only. Do **not** touch `shell.c`; do **not** move the SDK out of the program's compilation (it would break assembly loading *and* the `console.log` channel).
8. **C++** — delete the PCH; measured to cost nothing. Do **not** touch `shell.cpp:201-226`; keep `-g1`, `-ffile-prefix-map`, and wasmtime's `addr2line`+`demangle` features.
9. **Swift** — delete `@_exported import gg`; even deleting `shell.swift` entirely was measured not to change the error surface. Keep `-g`, `wasm_backtrace_details(Enable)`, `-file-prefix-map`.
10. **Python** — delete `build_scope()` + `lib`; land the `gg.*` module `__getattr__` in the same commit to preserve `UNKNOWN_NAME`. Do **not** touch `_clamp_recursion`.
11. **Ruby** — nothing on the reporting path is deleted, but land the `Opal.modules["gg"]` registration in `guest.mjs` *first* or every converted program fails on line 1, and do not change the evaluation mechanism.

### Land before touching any arm

The cross-arm host fixes from section B are cheap and raise the floor everywhere, including on the blocked arms while their replacements are being built: `{err:#}` at `engine.rs:342`; `I32Exit` handling in `engine::classify`; not early-returning past `with_guest_stderr` on the memory/timeout paths; and an arm-appropriate OOM sentence. Four small changes in shared code recover the trap reason on five arms, turn `exit(n)` into a sentence on four, and recover an already-written allocation site with a line number on at least one.

### The rule the evidence supports, for whatever gets written next

Put the catching and formatting where **the model cannot omit it and the ruling cannot delete it** — in the baked guest or the SDK's own initialisation, never in per-turn generated source, never in an evaluation wrapper, and never in a function the model has to remember to call. The five arms that already do this (C#, C++, Ruby, Python, and Swift by having nothing to catch with) are exactly the five that are safe to convert today. The four that do not are exactly the four that are blocked. That correspondence is the audit's finding.
