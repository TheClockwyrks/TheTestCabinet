# gg whole-programs ruling — owner decisions

These are the owner's answers to the seven decisions a fifteen-agent survey found
blocking. The ruling itself is now stated on
[invariants](apps/docs/src/content/docs/gg/responses-as-code/invariants.md),
which wins over this document; what survives here is the reasoning and the
per-arm inventory behind it.

The ruling being implemented, in the owner's words:

> Agents must write complete files. There must not be **ANY** code that processes
> agent-generated code to create the source file to compile/run. There may not be
> any imports added, generation of a main function, etc. The entire agent
> response is what gets compiled, and if it needs some symbol, it must import it.
>
> Documentation must name the modules that symbols are defined in. The doc views
> need to provide enough information that agents understand whether a function is
> relevant, how to use said function, and how to access (import) the function.

---

## D3 — What counts as scope injection: **no unqualified name**

The rule is **no gg name is available *unqualified* without a line the model
wrote**. An import may shorten a name; nothing may make one reachable that was
not.

This is the strongest state a compiler can enforce on the four arms where the SDK
arrives by search path rather than by a load step. Measured: with C#'s
`GlobalUsings.cs` deleted, `Gg.Views.OpenText(…)` still compiles with zero
directives, because the SDK is compiled into the program's own compilation. The
same is true of a jar on the classpath and of Rust's `--extern` extern prelude.

**Consequences.** Delete, on every arm: C#'s `global using`, Rust's
`use gg::prelude::*` glob, Java's and Kotlin's star imports, C++'s
`using namespace gg;`, Swift's `@_exported import`, Python's bare-name scope
binding, Ruby's pre-carried `GG::*` constants. What survives is package
availability — classpath, extern prelude, include path, a linked archive — which
is packaging, not injection.

After this, a model writes either the qualifying line or the full path:

```
C#     using Gg;        → Files.WriteFile(…)      bare → Gg.Files.WriteFile(…)
Rust   use gg::files;   → files::read_file(…)     bare → gg::files::read_file(…)
```

## D2 — Entry points: **every compiled language requires the agent to define `main()`**

The owner's ruling, which supersedes all three options offered (a `macro_rules!`
entry macro, raw component ceremony, or exempting Rust):

> Rust, and all other compiled languages, must require the agent to define
> `main()`.

One uniform rule across the compiled arms. C++ and PureScript already satisfy it.
C#, Swift and Kotlin move from top-level statements to an explicit entry point;
Java declares `public static void main(String[])` in its own class; Rust writes
`fn main()`.

### Measured, 2026-08-14 — Rust is far cheaper than the survey sized it, and the WIT world does not move

Everything below was built and executed against gg's real SDK. The model file
throughout was exactly `use gg::prelude::*; fn main() { … }`, with no gg text
above or below it.

> **SUPERSEDED by D8.** Route C is **non-compliant with the failure-message
> requirement and cannot be made compliant on its target.** See
> *"Re-measured under D8"* at the end of this section for the route actually
> taken. What follows is retained because its central discovery — that `export!`
> can live in the SDK — is what makes the compliant route possible too.

**Route C: `wasm32-unknown-unknown`, `--crate-type bin`, and the `Guest`
impl and `bindings::export!` move out of the wrapper and into the SDK, which
calls the model's `main` through rustc's unmangled C `main` shim.**

The pivotal result: `export!` **can live in the SDK rather than in the model's
file**. With the `Guest` impl appended to `packages/gg-sandbox-rust/src/lib.rs`,
the `#[export_name]` symbols and the `component-type` custom section flow out of
the rlib into a program whose own file is nothing but `fn main()`. Driven through
a real component `Linker` exactly as `sandbox.rs` drives one, today's artifact
and Route C's are **indistinguishable** — same instantiate, same 35 `bound-tools`
names, same `run` → `Ok`.

The crate type is the whole trick. With `cdylib` it is impossible: the model's
`fn main` is dead code, rustc emits no C shim, and the Rust-mangled symbol
carries a `-C metadata` hash no `extern` declaration can name
(`rust-lld: undefined symbol: main`). With `bin`, rustc emits the unmangled shim
and passes `--export main` to `rust-lld` itself.

Cost in gg-side changes, complete:

- `rust.compile.rs:321` — `cdylib` → `bin`. One word.
- `rust.source.rs` — delete `prologue()`, `EPILOGUE` and `refuse_main`;
  `LINE_OFFSET` 1 → 0; `wrap()` becomes the model's text plus the module
  declarations.
- `packages/gg-sandbox-rust/src/` — ~25 lines: the `Guest` impl, `export!`, and
  `extern "C" { fn main(…) }`.
- **Zero changes** to the WIT world, `bindgen!`, `engine.rs`, `membrane.rs`, the
  linker, the encode, the target, the toolchain image, the adapter pins or the
  rlib set.

**So `main()` does not move gg to `wasi:cli/run`, and `bound-tools` needs no new
home.** The earlier concern in this document was wrong, and Route A (wasip1 +
command adapter) is rejected: it is a strictly larger change for a strictly worse
artifact — a new pinned command adapter (the repo pins only the **reactor**, and
the reactor encodes without error while **silently dropping `wasi:cli/run`**, so
`main` would never run), a wasip1 std in the run image, the whole rlib set
rebuilt, 2.3× the artifact, and it hands every Rust program the entire WASI
surface, which `packages/gg-sandbox-rust/rust-version.sh` argues at length
against.

Two things get **better**: `LINE_OFFSET` becomes 0, so a panic reports the
model's own coordinates exactly (measured: `line 6, column 24` for a `v[3]` at
line 6 column 24), and a missing `main` becomes a first-class located diagnostic,
`error[E0601]: main function not found in crate program` — which replaces
`refuse_main` and satisfies D4 for free.

**Two residual defects, both real:**

1. The panic hook is no longer installed by a prologue. `_start` runs
   `.init_array`, so a `#[used] #[link_section = ".init_array"]` constructor in
   the SDK rlib fires before `main` — measured working. Without it, a panic goes
   unstructured to fd 2.
2. On `wasm32-unknown-unknown` there is no stderr, so
   `fn main() -> Result<(), Box<dyn Error>>` returning `Err` produces **no output
   at all** — the shell sees only exit code 1. `fn main() -> Result<(),
   gg::Failure>` can report fully, via a side-effecting `Debug` impl that fires
   while the guest is still live. That is ugly and should be weighed rather than
   adopted silently.

**The single biggest risk:** the SDK reaches `main` through rustc's unmangled C
shim, which is an implementation detail of wasm binary crates rather than a
stable ABI, and is target-dependent (`main` on `wasm32-unknown-unknown`,
`__main_void` on `wasm32-wasip1`). A future rustc that renames it fails every
Rust program at once — loudly, with `undefined symbol: main`, and pinned by
`rust-toolchain.toml` today. **Guard it with a test that compiles a `fn main()`
program and asserts the `run` export reaches it**, so a toolchain bump fails in
CI rather than in a run container.

**Worth reusing:** "the SDK carries the entry-point wiring, the model writes only
`main`" is the pattern to try first on every other compiled arm.

### Re-measured under D8 — the target changes, and this is the route

**Take `wasm32-wasip1`, binary crate, the reactor adapter the repo already pins,
and gg's existing `run` / `bound-tools` world.** The SDK shell calls the model's
`__main_void()` and propagates its exit code.

**Why Route C is dead.** Today's Rust guest imports **no WASI at all** — measured
on the real artifact, `wasm-tools component wit` shows three `test-cabinet:gg/*`
imports and a `wasi:` count of **zero**. `membrane.rs:487`'s `.stderr(stderr)` is
wired and correct; this arm simply never speaks to it. The cause is in std's own
source rather than in gg: `wasm32-unknown-unknown` matches no arm of the
`cfg_select!` in `library/std/src/sys/stdio/mod.rs` and falls through to
`unsupported.rs`, where `write` **discards the bytes and reports success** and
`panic_output()` is a hard-coded `None`. There is no hook, allocator trick or
link flag that redirects them, so on that target every message must come from SDK
*interception* — and interception reaches only one of the failure shapes:

| what fails | can the SDK see it on `wasm32-unknown-unknown`? |
| --- | --- |
| panic / index out of bounds | **yes** — `std::panic::set_hook` |
| `main` returns `Err(Box<dyn Error>)` | **no** — only the `i32`. `Termination` formats through the discarding stderr |
| `std::process::exit(1)` | **no** — `abort()`, a bare trap, no code and no message |

Two of the four shapes carry no message at all. Measured, with gg's hook
installed: an `Err` from `main` produced `run -> Ok` and the message simply gone;
an `exit(1)` produced a wasm backtrace and nothing else.

**On wasip1 the requirement is satisfied with nothing intercepted** — no hook, no
catch chain, the stock SDK unmodified. Captured through a pipe wired exactly as
`membrane.rs:487` wires `GuestStderr`, this is what a model receives:

```
thread 'main' (1) panicked at program.rs:6:5:
the plan named 0 entries and I expected 3

thread 'main' (1) panicked at program.rs:6:21:
index out of bounds: the len is 2 but the index is 2

Error: "the manifest had no `version` key"
```

`program.rs:6:5` and `6:21` are **the model's own file and its own coordinates,
uncorrected**, because there is no wrapper left to offset. `std::process::exit(1)`
writes no text, but is not silent: it arrives as `I32Exit(1)`, so gg can name it
exactly rather than showing a backtrace.

**Why this variant rather than the plain `wasi:cli/run` command component.** It
leaves gg's WIT, `bindgen!({world:"sandbox"})`, `Sandbox::instantiate`,
`call_run`, `component_bound_tools` and the agreement tests **untouched**, so all
eleven arms stay on one host invocation path — and it reuses the **already-pinned
reactor adapter** instead of adding a command-adapter pin whose failure mode is
silent (encoding a command module with the reactor adapter exits 0 and quietly
yields a component with no entry point at all). `.init_array` constructors were
confirmed still running under reactor adaptation, so the structured panic hook
remains available on top.

Cost: `GG_RUST_TARGET` → `wasm32-wasip1` (the rlib set rebuilds itself);
`cdylib` → `bin`; the two adapter lines from `cpp.compile.rs:1029`; delete
`prologue()`, `EPILOGUE`, `refuse_main`, `LINE_OFFSET` 1 → 0; ~20 lines of SDK
shell; an `I32Exit` case in `engine.rs:326 classify`; wasip1 std in the toolchain
image (98 MB vs 93 MB, a swap not an addition). Artifact 27 KB → 65 KB; compile
time unchanged.

**`rust-version.sh`'s long argument against a WASI target must be rewritten** —
the WASI surface is now the point rather than a side effect.

**Biggest risk, and it is an owner call.** The shell hand-rolls two lines of
`_start`: it calls `__main_void` — a wasi-libc convention symbol — and propagates
the code, **skipping `__wasm_call_dtors`**. A toolchain that renames the symbol
fails loudly at link; one that makes `_start` do more fails quietly. The fallback
is the plain command component (`wasi:cli/run` + a command adapter pin), which
gets the platform's own `_start` and identical model-facing text on all four
shapes, at the price of the Rust arm diverging from every other arm's host path.
Either way it wants a test that compiles a `fn main()` program, drives `run`, and
asserts both that `main` ran and that a panicking program's stderr tail arrives
non-empty.

## D1 — TypeScript and JavaScript: **fund an engine change**

Not exempted. Both arms convert.

The wall, found independently by two surveyors: `import` is a `SyntaxError`
inside a `new Function` body, and StarlingMonkey (componentize-js 0.21.0, pinned)
exposes no JS-callable way to evaluate module source at run time. Dynamic
`import()` traps the whole store — the component imports no `wasi:filesystem`, so
the loader reaches an absent import.

### Measured, 2026-08-14 — the cheap routes are closed, and the wall is named

Run against gg's real prebuilt 14 MB guest under wasmtime 45 with gg's own
config, a fresh store per probe.

- `await import("data:text/javascript,…")` **traps the store** — not a catchable
  error — at `path_filestat_get`. Identical for `blob:`, `node:`, base64 data
  URLs, every path-shaped specifier, and the same specifier smuggled through a
  nested `new Function`. componentize-js stubs the preview-1 filesystem to
  `unreachable` after wizening, and **no bake flag restores it**: there is no
  filesystem feature in `DEFAULT_FEATURES`, and `stub_wasi_imports` removes it
  unconditionally.
- No `ShadowRealm`, no `WebAssembly` global, no `import.meta`, no runtime
  `defineBuiltinModule`, no StarlingMonkey flag, no componentize-js option.
- **The survey was wrong about the registry**, and the correction is real:
  `await import("test-cabinet:gg/files")` **resolves today, with zero change**,
  to a live host namespace that reaches the host for real.

That raised an obvious route — have gg register its *own* SDK modules as builtin
modules at bake time — which was then measured and **also closes**:

- `defineBuiltinModule` exists **only** for the duration of
  `run_initialization_script`. Measured in one run: the generated initializer
  registers `probe:demo/host`, and by the time the source graph evaluates,
  `typeof defineBuiltinModule === "undefined"`.
- That initializer runs **before any SDK module has been evaluated**, so at the
  only moment registration is possible the SDK namespace does not yet exist.
- `runtimeArgs: '--initializer-script-path …'` is **silently ignored** —
  componentize-js appends its own after it (`src/componentize.js:273-274`) and
  the parser takes the last. There is one initializer script and componentize-js
  owns it.
- The namespaces handed to `import()` are **sealed, null-prototype Proxies**.
  `defineProperty` throws; sloppy-mode assignment is accepted and silently
  discarded (`m.log = x` then `m.log === x` is `false`). Nothing can be repaired
  from the shim at run time.
- There is no pre/post hook between `spliceBindings` and the initializer write.

**So the remaining routes are exactly three**, and the choice among them is an
open owner decision:

1. **Fork the embedding** to supply a host module resolver.
2. **Reimplement the bake driver** — drive `spliceBindings` → wizer →
   `stubWasi` → `componentNew` directly, against unstable package internals.
3. **Bake a component per program** (~660 ms+/turn, plus componentize-js and
   wizer in the run container image).

And one cheap non-route worth pricing before any of them is funded: a program
**can** `await import("test-cabinet:gg/<interface>")` today, in an
`AsyncFunction` body, with no bake change at all — but it receives the **raw
lowered WIT bindings, not the SDK**. Measured against
`packages/gg-sandbox/src/gg/files.ts`, that loses the options-object form
(`readFile(path, {offset, limit})` becomes positional), the argument validation,
the `ToolError` normalisation and class, the result shaping, and every
guest-only helper such as `readTextFile`. It satisfies the letter of the ruling
and materially degrades the arm.

Two side-findings that constrain any design here: top-level `await` works on
line one in an `AsyncFunction` body and settles inside the host's `run` call
(StarlingMonkey drains the job queue before returning), a throw is observable as
a rejection, and the stack still carries the `Function:<line>:<col>` marker the
shim's line remapping keys on (`shim.ts:186`).

**Hard constraint on any work here.** Java, Kotlin and PureScript all return
`typescript::COMPONENT` from `guest_component`, and their SDKs resolve `fs`,
`view` and `harness` as **free identifiers** against the shim's injected scope.
Those bindings are not model-facing on those arms, so the ruling does not reach
them — but a naive "delete `buildScope`" takes **five arms down at once**, at run
time, with a bare `ReferenceError`, in a suite that does not exercise those three
arms' free-identifier resolution end to end.

## D6 — C++: **precompile the SDK to an archive; compile only the agent's code**

The owner's ruling:

> The SDK should be provided as a `.lib`/`.a` where the agent's code imports the
> headers. It shouldn't be necessary to recompile the SDK itself each time, only
> the agent's code (+ linking).

So: ship the SDK as a prebuilt static archive plus headers, point `-I` at the SDK
tree so the documented line is the conventional `#include <gg/files.hpp>`, and
link the archive.

### Measured, 2026-08-14 — the archive changes nothing, because it already exists; a std-only PCH is the answer

Measured on an idle machine (the first pass was discarded: it ran while the test
suite was going and load hit 126, inflating everything 10–30×), two independent
11-rep passes, medians, against a **realistic turn** — four gg calls across three
modules, `std::string`, `std::map`, `std::vector`, `std::format`, two algorithms.

**The instruction describes an arrangement that already exists.**
`packages/gg-sandbox-cpp/build.sh:123-141` compiles the SDK's translation units
once into `sdk.o`, and `cpp.compile.rs` links it on the turn path. There is no
per-turn SDK recompilation to remove. Building `libgg.a` from the identical
objects and linking that instead moves the isolated link step from **54 ms to
55 ms**, and the end-to-end figure by less than the noise floor. Archive versus
object is a stylistic choice, not a performance one.

**The regression is 100% header parsing**, confirmed by `-ftime-trace` and
exactly the hypothesis this measurement was commissioned to separate:

| | total | `Source` (header parse) | InstantiateFunction |
| --- | --- | --- | --- |
| PCH today | 752 | *absent* | 498 |
| no PCH | 1114 | **492** | 467 |
| std-only PCH | 792 | **44** | 509 |

Of that 492 ms, gg's own 13 SDK headers cost **44 ms** and the five standard
library headers cost **~450 ms**. `InstantiateFunction` at ~470–510 ms is
constant in every row — that is the model's own templates, and nothing removes
it.

**The answer is a standard-library-only PCH**: carry the 56 std headers, carry
**no** gg surface and **no** using-directive. Then `gg` is entirely undeclared
until the model writes `#include`, which satisfies the ruling in letter and in
spirit, and costs **15–50 ms per turn (2–7%)** rather than 335 ms.

Rejected, with evidence:

- **Headers-only PCH** (gg surface, no using-directive) makes unqualified
  `files::` a hard error, so it passes the ruling's literal wording — but every
  `gg::` name stays reachable with **zero model-written lines**; a realistic
  program with no `#include` at all compiled clean against it. The model's
  `#include` would be decorative. It fails the intent.
- **Module cache** — now proven unusable rather than unproven. `-fmodules`
  against libc++'s own modulemap fails to build the `std` module on
  `wasm32-wasip1` (17 errors inside libc++'s own headers,
  `redefinition of '__libcpp_wcschr'`), and the pinned SDK ships no `std.cppm`,
  so C++20 named modules are unavailable too.

**Every documented C++ timing figure is wrong independently of this change, and
must be corrected.** All of them — `cpp.compile.rs:37-62`'s "34 ms",
`prelude.hpp`'s "82–95 ms" and its "~850 ms saving" — are **hello-world**
measurements, faithfully reproduced (28–35 ms, 66 ms, 938 ms). A realistic turn
under the same PCH is **750 ms**, and the PCH's real saving is **~335 ms, not
~850 ms**. The figure the docs should state is **~750–800 ms**, with ~85 ms
labelled explicitly as an empty-`main` floor.

---

## D8 — A runtime failure MUST reach the model, on every arm

The owner's ruling, and it is a hard requirement rather than a quality goal:

> Agent code that fails at runtime must produce an error message that gg can
> obtain and return to it. That's a hard requirement. Without that, an agent
> can't get information about how its code failed and fix it. This applies to all
> languages, not just Rust.

**This is an acceptance criterion for every arm's conversion, and it outranks
every cost consideration in this document.** An arm that compiles the model's
bytes verbatim and then swallows a runtime failure is worse than an arm that
still wraps: a model that cannot see why its program failed cannot fix it, and
the run is spent producing turns that repeat the same mistake.

It also **reverses a conclusion reached above**. Route C's second residual defect
— `fn main() -> Result<(), Box<dyn Error>>` returning `Err` produces *no output
at all* on `wasm32-unknown-unknown`, only exit code 1 — is not a wart to be
weighed. It is a violation. Route C cannot land in that form.

The danger is structural rather than incidental, and it is why this lands here
rather than in a per-arm note: **on several arms the wrapper being deleted is
precisely the thing that catches and reports the failure.** Java's `GgEntry`
carries a twelve-clause catch chain, and the survey measured that without it a
`NullPointerException` degrades to `Error: Error: null`. Rust's prologue installs
the panic hook and calls `gg::program::report`. Removing a wrapper without moving
its reporting into the SDK first converts a legible failure into an opaque one.

### What must be true, per arm, before that arm is called done

For each of these shapes, a model must receive a message naming what failed —
and, where the language can give one, a location in **the model's own
coordinates**:

1. an uncaught gg `ToolError`;
2. an uncaught language-native fault: index out of bounds, null dereference,
   a failed cast, division by zero;
3. a program that terminates with a failure *value* rather than by throwing
   (Rust's `Err` from `main`, an exit code, a rejected promise);
4. a resource fault: stack overflow, allocation failure, unbounded recursion;
5. an explicit abort or exit called by the model.

None of these may arrive as an unattributed `PrepareFailure::Toolchain`, a bare
trap, or an empty string. This is the same principle D4 states for *compile*-time
shape errors, applied to run time — and the two together are what keep a model's
own mistake from being recorded as gg's infrastructure breaking.

**Gate G8**: a per-arm test driving all five shapes through a real run and
asserting the model-facing feedback is non-empty and names the fault. It belongs
beside each arm's substrate tests, and it should be written *before* that arm's
wrapper is deleted, so the deletion has to keep it green.

### D8a — let it fail; take the error from the failure. No catch chains.

The owner, on Java's twelve-clause catch chain:

> I'm strongly opposed to the Java 12 clause catch chain. Whenever possible, the
> agent's code should simply be allowed to fail and the error should be obtained
> from the failure. That of course assumes stderr or a similar mechanism can be
> used.

So the mechanism is **capture, not interception**. A program that fails should be
allowed to die the way its runtime kills it, and gg should read the runtime's own
error output — which is richer, better localised and better maintained than
anything a catch chain reconstructs, and which cannot fall out of date with the
language. A catch chain is a per-arm reimplementation of what the runtime already
prints, and every clause of it is a shape somebody had to predict in advance.

This makes the two rulings *agree* rather than conflict: deleting the wrapper is
no longer a threat to failure reporting, provided the capture channel exists.

**gg's host side is already built for exactly this.** `GuestStderr`
(`crates/gg/src/sandbox/membrane.rs:331`) is a full `OutputStream`,
`wasi_context` binds it with `.stderr(stderr)` (`:487`), `stderr_tail()` reads it
back (`:622`), and `with_guest_stderr` (`crates/gg/src/sandbox/engine.rs:342`)
folds it into the reported error precisely so that "what the runtime wrote to
stderr on its way down" is not buried under a wasm backtrace.

So the question per arm is not whether gg can receive a runtime's dying words —
it can — but **whether that arm's guest has a channel to write them on**.

### Audited, 2026-08-14 — eleven arms, five shapes, all measured

Full results: [`gg-runtime-failure-audit.md`](gg-runtime-failure-audit.md).

**The finding, which is also the design rule:** reporting is safe exactly where it
lives in code **the model cannot omit and the ruling cannot delete** — the baked
guest or the SDK's own initialisation. It is at risk exactly where it lives in
per-turn generated source (Java's and Kotlin's `GgEntry.java`, Rust's prologue,
PureScript's `entry.js`) or in an evaluation wrapper (TS/JS's `new Function`).
**The five arms that already do the former are exactly the five safe to convert
today; the four that do not are exactly the four that are blocked.** That
correspondence is not a coincidence — it is the same property restated.

So the test is not *"does gg prepend text"*. On Java and Kotlin the wrapper is
not around the model's source but **beside** it, which makes both arms look clean
to a naive audit and would delete their catch chain by accident. The test is:
**is any code that catches or formats a failure generated per turn, or reachable
only from generated text?**

**Ordering.** Safe now, with named guardrails: **C#, C++, Swift, Python, Ruby**.
Hard-blocked: **PureScript** (deleting the synthesized entry was measured to
produce *total silence and a clean turn*), **Java** and **Kotlin** (deleting
`GgEntry` collapses three distinct native faults into `Error: Error: null`),
**TypeScript** and **JavaScript** (the single `try` around `new Function` is the
entire mechanism). Rust is conditionally blocked until the SDK glue reads
`main`'s return value.

**TS/JS, Java, Kotlin and PureScript are one change, not four.** All four resolve
`fs`/`view`/`harness`/`gg` as free identifiers against `shim.ts`'s `buildScope`,
and deleting it takes five arms down at once with a `ReferenceError` whose text
tells a model to do nothing.

### Live defects — failing this requirement **today**, before any conversion

These are bugs in the tree now and should be fixed regardless of the whole-programs
work. Ranked as the audit ranked them:

1. **Ruby `exit` is a silent no-op and execution continues.** Measured:
   `puts "a"; exit 1; puts "b"` logs all three and reports a **clean turn**. The
   model's stated intent is inverted and the statements after it run anyway.
2. **C# termination by value is invisible** — `return 3` from `Main`,
   `Environment.ExitCode`, and an unobserved faulted `Task` all produce a clean
   turn. `shell.c:232` discards the return value.
3. **TS/JS rejected promises are reported nowhere** — three spellings measured,
   all clean turns. `unhandledrejection` is defined and never fired.
4. **Swift `Task { throw }` runs to completion silently**; **Python `os._exit`**
   produces nothing; **C++ `return 1` from `main`** is discarded by design.
5. **Silently wrong answers**: Java and Kotlin lower integer divide-by-zero to
   **`0`** (TeaVM `(a/b)|0`), Rust integer overflow wraps silently, and a C++
   **null dereference is not a fault at all** — reading *and writing* through a
   null pointer succeeded and the turn was recorded a success.
6. **Locations that look right and are wrong**: TS/JS report the *stripped*
   file's coordinates (measured off-by-six, growing with the program);
   PureScript reports a bundle line inside gg's own `Wire.js`; Java and Kotlin
   ship a correct location and then append a bogus one; Swift locates an uncaught
   throw at `Swift/ErrorType.swift:254`.

**The cheapest fix in the whole audit**, and it should land before anything else:
`crates/gg/src/sandbox/engine.rs:342` formats the trap with `err.to_string()`,
which throws away wasmtime's reason — the backtrace is the outermost context and
the reason is its *source*. So `wasm trap: integer divide by zero`,
`call stack exhausted`, `out of bounds memory access` and
`Exited with i32 exit status N` never reach the model. **`{err:#}` recovers all
of them on every trapping arm at once.**

Three more shared-code fixes of the same shape: handle `wasmtime_wasi::I32Exit`
in `classify` (turns `exit(n)` into a sentence on four arms); stop early-returning
past `with_guest_stderr` on the memory and timeout paths (measured discarding a
Swift allocation failure that had *already* been written with a DWARF line); and
give the OOM sentence arm-appropriate text instead of telling every arm about a
JavaScript engine.

---

## D9 — No freestanding or "magic" objects. The `new Function()` design goes.

The owner, on the TS/JS/PureScript path:

> Pretty much everything you stated about the TS/JS/Purs path is improper
> implementation. I explicitly stated that freestanding/"magic" objects is not
> allowed. TS/JS should have been fixed by throwing away the `new Function()`
> design entirely because it does not allow for what I explicitly required.

This was **already required and was not done**. The first ruling — the SDK is a
library the agent imports from — has no exception for the arms where it is hard.
`packages/gg-sandbox/src/shim.ts`'s `buildScope`, and every free identifier it
binds (`gg`, `ToolError`, `lib`, `fs`, `view`, `harness`), is the thing being
deleted, and `new Function(...names, program)` is deleted with it because the
injected scope is the only reason it exists.

The consequence for the runtime question is that **fixing the JS module path is
not optional and cannot be traded away.** An option that leaves programs as
function bodies with injected names does not satisfy the ruling however cheap it
is, and "exempt TS/JS" — which this document previously offered as an option —
is off the table.

## D10 — TypeScript goes through `tsc`. Nothing goes through oxc.

> TS code in particular was supposed to not go through oxc anymore either. It
> needs to go through `tsc`.

`crates/gg/src/sandbox/language/typescript.prepare.rs` parses the model's source
with oxc and **re-prints the AST** with `Codegen`, so the bytes that run are
never the bytes the model wrote. That is source processing, forbidden by the
first ruling on its own terms and independently of the module question. It is
also the direct cause of the measured off-by-six line shift.

The type check must be `tsc`'s, and the text that runs must be the model's own.

## D11 — Line numbers come from source maps or from the compiler. Never from arithmetic.

> Line numbers reported in errors should be exactly the same as what the model's
> code contains (either by way of `tsc` or using source maps to remap back to the
> actual line number). There should be **NO** code in gg that recalculates line
> numbers *except* through the use of source maps or other similarly standard
> maps. There should be no hand-rolled line number remapping.

**A ban, not a preference.** Every hand-rolled offset in the tree goes: the
constants, the subtractions, the "shift" parameters threaded through compile
paths, and the frame-picking heuristics that guess which stack frame belongs to
the model. What replaces them is either a compiler reporting against the model's
own file, or a standard source map consumed by a standard mapping library.

This is what makes the ban enforceable rather than aspirational: **an arm that
needs a source map must emit one.** PureScript's in-tree note already admits
`purs` and `esbuild` both *can* emit source maps and that gg passes neither
`--codegen sourcemaps` nor `--sourcemap` today. That is the shape of the fix
everywhere it is needed.

### Inventoried, 2026-08-14 — 119 sites, 71 must change, and the ban is cheaper than it looks

**Four arms are already compliant or nearly so, and two of them are the model to
copy.**

- **C++ — zero violations.** `main.cpp` is written verbatim, and code modules
  carry a real **`#line 1 "module_x.hpp"`** preprocessor directive. That is
  precisely why this arm needs no arithmetic anywhere. It is the worked example.
- **C# — zero arithmetic violations.** Real `#line` directives, read back with
  Roslyn's `GetMappedLineSpan()`, and the `using` hoist leaves a **blank line
  where each directive stood** so the body's line count is unchanged. One gap:
  `csharp.compile.rs:418-443` passes **no `-debug` flag at all**, so a runtime
  exception names methods with no line — on the arm best placed to give them,
  since `program.cs` is verbatim and needs zero mapping.
- **Python — no line arithmetic at all.** CPython reports true lines because the
  guest compiles the model's own text under its own filename.
- **Ruby and the JVM arms already emit and consume real V3 source maps.** On the
  JVM the map is genuine (TeaVM `setSourceMapsFileGenerated(true)`) and the
  `shift` is **a second, hand-rolled hop layered on top of it** — so the fix is
  deleting the hop, not building a map.

**Where the map has to be turned on:**

- **TypeScript/JavaScript** — moot under D10, since oxc goes entirely; `tsc`
  supplies both the check and the map.
- **PureScript** — needs a *two-stage* map, `purs --codegen sourcemaps` composed
  with `esbuild --sourcemap`. **Neither is passed today**; the only `--codegen`
  in the arm is `--codegen docs`.

**Rust is the hard case: no map exists in the language.** rustc emits no source
map and Rust has no `#line` directive, so class (ii) does not exist on this arm —
every site must fall to deletion or to compiling the model's own file. The one
shape that satisfies the ruling: make the *shell* the crate root and pull the
model's byte-identical `program.rs` in with `include!`. Two things need
verifying first — that `include!` accepts a statement sequence in a block
position, and that `Location::file()`/`line()` report the *included* file.

**Two live bugs found on the way:**

1. `packages/gg-sandbox-rust/src/program.rs:97` computes
   `location.line().checked_sub(line_offset)?`, so a panic attributed to file
   line 1 yields `1 - 1 = 0` and **the model is told `line 0`**. The `?` looks
   like a guard and guards nothing.
2. `packages/gg-sandbox-ruby/src/shim.js:402-403` always maps through the
   *program's* source map, but code modules are `new Function`'d too — so a raise
   inside `lib.<name>` is mapped through the **wrong map** and produces a
   plausible, wrong Ruby line. Pinned by no test.

### D13 — the healed text IS the model's program, and the model is shown it

The owner:

> Showing post-healing line numbers is the expected design. Models should see the
> post-healing response as though it were their original response.

So the definition is settled: **the healed text is the program of record.** A
reported line is a line of it, no mapping is owed, and `healing.rs` is not a
violation of D11 — it is upstream of where "the model's source" begins.

The condition that makes this coherent is the second sentence, and it is a real
requirement rather than a restatement: the transcript must carry the healed
program, so that what the model reads and what a line number counts are the same
text.

**gg implements this, but not by default.** `healing.rs:489` `AssistantMessageMode`
has two settings, and `:527` records that absent / `null` / `"none"` is **the
default**, recording the raw reply; only `"response-healing"` records the healed
program, and then only when healing changed something (`healed.rewritten()`,
`agent.rs:7114`). Under the default, a model reads the reply it sent — fences,
prose and all — while every line number it is given counts lines of a text it has
never seen.

**Open, and a one-line change with study-wide consequences:** whether
`response-healing` becomes the default. Keeping `none` as an experimental lever is
defensible — it is a study harness — but under D13 it is a **knowingly
inconsistent** setting rather than a neutral one, and it should be documented as
such wherever it is configured.

### The healing question, now closed

`crates/gg/src/healing.rs` rewrites the reply **before any arm sees it**:
`trim_reply` removes leading blank lines, `strip_fences` takes a fenced block's
body and discards everything above the opening fence, `strip_prose` deletes
prose lines, and `dedent` strips common indentation. That is a line shift **and**
a column shift, with **no bookkeeping anywhere**.

So however the rest of this lands, "the model's own line N" will mean line N of
the **healed** text, not of the reply as sent. That needs to be a **stated
definition** rather than an accident, because it is the last remaining way a
reported line can fail to be a line of what the model actually wrote. Three
options, and the owner should pick: heal and record the mapping; heal and define
the healed text as the program of record; or stop healing the shapes that move
lines.

### A related smell worth naming

Two arms decode source maps with **hand-written base-64 VLQ decoders**
(`jvm.rs:360-383`, `shim.js:316-362`). Decoding a standard format is not the
hand-rolled arithmetic the ruling bans — but both bail to "no location at all"
on any malformed field, `jvm.rs` throws away **every column in the map**
(`fields[0]` and `fields[3]` are never read), and `shim.js`'s column lookup is a
nearest-preceding *guess*. A real source-map library would be less code and more
correct.

**Test blast radius:** ~163 named tests across 34 files touch these paths, ~71 of
them hard pins asserting an exact coordinate the arithmetic produces. Densest:
JVM 22, Rust 13, TypeScript/JS 10. Three sites are pinned by **nothing** and are
therefore unprotected: Python's `_column_of`, Ruby's wrong-map bug above, and
Rust's `module_prologue()` one-line-ness, which the module diagnostic path merely
*assumes* by reusing the program's `LINE_OFFSET`.

## D12 — PureScript stays on JavaScript

> PureScript should always be compiled to JS. Fixing imports on the JS path
> should unblock PureScript.

So the PureScript backend question is closed — no `purescript-native`, no
alternative backend. PureScript's compliance is a **consequence** of the JS
path's, which makes the JS module fix carry three arms rather than two, and makes
it the highest-leverage single piece of work in the programme.

---

## D14 — The guest runtime, per arm. All eleven are now decided.

| arms | runtime | why |
| --- | --- | --- |
| **Java, Kotlin** | **TeaVM 0.13.1 `WEBASSEMBLY_WASI`** — a complete non-JS implementation | built end to end; see [`gg-jvm-native-findings.md`](gg-jvm-native-findings.md) |
| **TypeScript, JavaScript, PureScript** | **quickjs-ng** in a component | the only measured configuration with real module resolution; see [`gg-js-runtime-decision.md`](gg-js-runtime-decision.md) |
| **Rust** | `wasm32-wasip1`, binary crate, the already-pinned reactor adapter | the only route where a failure of any shape reaches the model |
| **C++, C#, Swift, Python, Ruby** | unchanged | already compile the model's bytes; only injection is deleted |

**The JVM arms are a whole non-JS implementation, and it is smaller than the
survey feared.** The canonical-ABI burden is **one host function** —
`wire: call: func(op: string, request: list<u8>) -> list<u8>` — which is the
shape `packages/gg-sandbox-java/src/gg/internal/Wire.java` already has; only the
far side changes from the ECMAScript guest to gg's Rust host. **No `wit-bindgen`
for Java is needed and none exists**, because no part of the 1,220-line WIT is
marshalled in Java. gg writes ~24 lines of WIT, ~90 lines of `Abi.java`, a few
lines of Rust to stamp the `component-type` section through the `wit-component`
dependency it already has, and one `match` arm per operation in the host.

**Kotlin unifies onto the identical mechanism** — same `Abi.java`, WIT, adapter
and host, differing by one line in the generated entry class — and the change
retires Kotlin's script compilation, so `kotlin.source.rs`'s whole
local-declaration problem disappears with it.

Two things gg's driver must encode, both measured footguns:

1. `@Export` emits a core export **only if the class is reachable**. Without
   `setClassesToPreserve`, the module exported only `memory` and the encode
   produced a component with **no exports at all** — silently.
2. **Do not symbolicate this arm from DWARF.** wasmtime's own backtrace carries
   correct function names but **wrong files and lines** (`TString.java:91`) —
   TeaVM's DWARF is misattributed. The correct locations are on stderr, which is
   where the ruling says to read them anyway.

**The accepted risk, stated plainly.** TeaVM removed this backend in 0.14.0 —
12,740 deletions, of which **10,685 are the wasm backend proper**, so restoring
only the WASI glue is impossible — and the author wrote that the backends
*"failed to gain any adoption"* and that it is *"pointless to invest time into"*
them. gg is pinning an orphaned compiler backend with no upstream. If a model
writes Java that it miscompiles, gg cannot get that fixed. The mitigation on
record is that quickjs-ng is **measured** to run the Java, Kotlin and PureScript
bundles today with no polyfill, so the fallback is a known quantity rather than a
rescue project.

**Kotlin/Wasm `wasmWasi` is refuted, not merely unpromising:** sixteen flag
combinations built and run, **guest stderr = 0 bytes on all sixteen**.

## D15 — TeaVM pins to 0.13.1

Independent of D14 and a live defect today. Measured on identical sources with
`--release 21` for both the program and the driver:

- JDK 25 + TeaVM **0.12.3** → `IllegalArgumentException: Unsupported class file major version 69`
- JDK 25 + TeaVM **0.13.1** → builds clean, `teavm errors: 0`

0.13.1 is also the **last release carrying the WASI target**, so it is the version
D14 needs. Both the 0.12.x and 0.13.x lines are closed upstream.

---

## Decisions still mine to make, and how I have made them

These were not asked because they follow from the four above or are reversible.
Flagged here so they are visible rather than silent.

**D4 — refusals of shape are permitted, and required.** A program that omits the
entry point, names the wrong class or writes a `package` line must earn a
`PrepareError` **shown to the model**, never a `PrepareFailure::Toolchain`. Three
arms have this hole today in three shapes (Rust's missing `export!` →
`componentize`; Java's `GgEntry` failing to resolve `Program`; PureScript's
esbuild "could not resolve", unmatched by `classify_bundle`), and on those arms
the single most likely model mistake currently becomes an unattributable
infrastructure failure that burns the run. Kotlin's and Java's `package` refusals
stay; Rust's `refuse_main` inverts into a refusal of a program with *no* `main`.

**D5 — code modules (skills and memories) are out of scope.** They are gg's own
source, not the agent's: the agent never writes them. The `lib.<key>` contract is
unimplementable without a wrapper on Ruby, Swift and C#, so folding them in would
be a second design question wearing the first one's clothes. Deferred
**explicitly**, with a note that a broken generated family-skill on-use script
degrades quietly (a skill whose code fails to compile still reads, with the
failure appended as a `NOTE:`).

**D7 — the docview's access line keeps `Option<String>`.** Two states today: a
real import line, or truthfully in scope already. The third state D3 creates —
"reachable already; a line would shorten it" — is a wording change, not a type
change, and widening the type now would prejudge nothing useful.

---

## What lands first, and why

**Part 2 — documentation naming its module — lands on its own, before part 1
touches an arm.** It is correct under both regimes, strictly improves the docs
today, fixes three already-stale strings in the tree, and is on the critical path
for every arm. It is the highest ratio of value to risk in the whole programme,
and it is already in flight.

**Part 1 is a programme, not a change.** Sized by the survey, after decisions:
Kotlin under a day; Swift, PureScript and C# one to two days each; Python two to
three; Java, C++ and Ruby around five each; Rust six to eight and gated on the
`wasi:cli/run` measurement; TypeScript and JavaScript unsized until the
`data:` URL measurement comes back.

The hazard to steer around is not "some arms wrap and others do not" — that is
already the tree, five arms compile bytes verbatim today. It is sharper than
that: **an arm where the prompt, the documentation and the compiler disagree.** A
segment that says "already in scope" beside a catalogue publishing an import
line; a docview naming a line the guest cannot resolve; a `require` the model
must write that changes nothing.
