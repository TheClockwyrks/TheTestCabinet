//! **C#** — the arm whose compiler emits neither wasm nor source, and the only one that pairs a
//! real compiler on the turn path with a committed runtime that never changes.
//!
//! What exists here today is this arm's **execution substrate** and nothing else: the Roslyn compile
//! that turns a model's C# into an IL assembly, the committed guest that interprets it, and the
//! proof that a real C# program really does run through gg's own linker, membrane and store. The SDK
//! and the [registration](super::ProgramLanguage) land later — a language arm cannot be
//! half-registered, because the registry's `match` is exhaustive and every gate that iterates the
//! registered set would immediately demand a catalogue, two Handlebars templates and a healing
//! dialect. Nothing here is reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `csc`, what it costs, what it refuses, and the two
//!   failures it tells apart;
//! * `packages/gg-sandbox-csharp/` — the shell the guest is built around and the build that commits
//!   it;
//! * `guests/csharp.component.wasm` — the committed guest: Mono's IL interpreter, the .NET class
//!   libraries and ICU, as one self-contained component;
//! * `checkers/csharp.toolchain.json` — what built it.
//!
//! # The strategy, in one paragraph
//!
//! **Roslyn on the host, a Mono IL interpreter in the guest.** A model's reply is compiled to an IL
//! assembly by `csc` in ~0.3 s, base64-encoded into the world's existing `program` string, and
//! loaded by a committed component that carries the whole .NET runtime. It is the shape the
//! [Python](super::python) and [Ruby](super::ruby) arms have — one committed runtime, a payload per
//! turn — rather than the shape [Rust](super::rust), [Swift](super::swift) and [C++](super::cpp)
//! have, and that is the whole reason C# is affordable. A prior study priced this arm on the only
//! toolchain it looked at, `componentize-dotnet`, which compiles the *program* to native wasm: 25–43
//! seconds a turn, and the arm was cut as impractical. What it missed is that Microsoft publishes
//! the interpreter.
//!
//! # The one piece everybody said was unbuilt, and why it is not
//!
//! Binding gg's WIT world from .NET is what `dotnet/runtime#113868` says has no supported path.
//! That issue was opened in 2025 and **closed unresolved, with no owner and no PR**, and the
//! feasibility study that scheduled this arm last treated it as the residual risk — a Mono relink to
//! be attempted only as research, after two fallbacks.
//!
//! **No relink research was needed and neither fallback was taken.** The question contains its own
//! answer once it is asked of the right layer: the component gg instantiates is **C**, not managed
//! code. It is Mono's own runtime pack sources — which Microsoft ships as static archives *plus the
//! C that links them*, precisely so the runtime can be relinked with an embedder's own natives —
//! compiled together with `wit-bindgen`'s C bindings for gg's world and
//! `packages/gg-sandbox-csharp/Sources/shell.c`. The managed half never binds a WIT world at all: it
//! reaches gg through `mono_add_internal_call`, Mono's embedding API for exactly this, which is
//! older than wasm and needs no build-time code generation.
//!
//! So this arm's guest is built by the runtime pack's **own supported build**, with one extra
//! translation unit. The measured result is in `checkers/csharp.toolchain.json`: a 34.9 MB
//! component, produced by wasi-sdk's `clang` on `wasm32-wasip2`, holding the interpreter, 170
//! bundled assemblies and ICU.
//!
//! # What a C# program is, here
//!
//! **The model's reply, unaltered, as a compilation unit with an entry point.** No wrapper and no
//! prologue, so a diagnostic at line 7 is line 7 and there is no offset to subtract anywhere in this
//! arm. C# admits top-level statements, a `class`, a `record`, a `namespace` and a `using` in one
//! file, so nothing about the language forces the wrapper the statement-shaped arms need — and
//! `-target:exe` accepts either an explicit `Main` or top-level statements, so a model may write
//! whichever it reaches for.
//!
//! # What this arm has that the other compiled arms do not
//!
//! **A real exception mechanism *and* a managed stack trace.** [Rust](super::rust) aborts and
//! reaches for a panic hook; [Swift](super::swift) traps and has no hook at all; [C++](super::cpp)
//! has `throw` and `catch` but nothing to ask a caught exception where it came from. Here the
//! interpreter is a .NET runtime: `try`/`catch`/`finally` work because they are IL, and what an
//! unhandled exception reports is `Exception.ToString()` — the type, the message and the managed
//! frames, which is exactly what a C# developer sees. That is the best error surface of any compiled
//! arm in this study, and it is a property of interpreting IL rather than anything gg engineered.
//!
//! # Why the guest needs no filesystem, and why that matters
//!
//! The class libraries and ICU are **bundled into the component**, registered as in-memory
//! resources, so the runtime boots with zero preopens and reads nothing. The alternative — the
//! runtime pack's default, a `managed/` directory beside the program — would have put 17 MB of
//! Microsoft's assemblies into a run's own working tree where a model would find them, and would
//! have made the guest depend on a path the toolchain image happened to install. It costs 22 MB of
//! committed artifact and buys a component that behaves the same on every machine.
//!
//! # What is not built yet, and what it blocks
//!
//! **The SDK**, and therefore the registration. `bound-tools` answers an honest empty list, and the
//! two internal calls the guest registers (`Gg.Native::Log`, `Gg.Native::ReadFile`) exist to prove
//! both directions of the membrane from a real C# program rather than to be a surface. What the SDK
//! step adds is a managed assembly referenced at compile time whose methods land on one internal
//! call each — `PascalCase`, named and optional arguments, real `enum`s, nullable reference types,
//! and exceptions for the error arm.
//!
//! **Code modules.** A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>`, and on this arm that binding is a compile-time reference: a module is C#,
//! it compiles to its own assembly, and the program is compiled with `-r:` against it. The seam
//! already hands a program's preparation the modules in its scope, and nothing structural is
//! missing — what is missing is the SDK's decision about what namespace a module's declarations land
//! in, which is the same decision the [C++](super::cpp) arm deferred for the same reason. Until it
//! is made, [`compile_program`](self::compile::compile_program) takes no modules and this arm must
//! not be registered: a C# agent that read a code skill would otherwise get no `lib` binding at all,
//! which is a capability silently absent on one arm of a study about capability.

/// The Roslyn compile: the host-side step that turns a model's C# into the IL its guest interprets.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as [Ruby](super::ruby)'s,
/// [PureScript](super::purescript)'s, [Java](super::java)'s, [Rust](super::rust)'s,
/// [Swift](super::swift)'s and [C++](super::cpp)'s were between their own substrate and their
/// registration: nothing on the turn path can reach a language the registry has no arm for, so every
/// entry point here is reached only by this arm's own tests.
#[allow(dead_code)]
#[path = "csharp.compile.rs"]
pub(super) mod compile;

/// **The committed guest** — Mono's IL interpreter, the .NET class libraries and ICU, as one
/// self-contained wasm component exporting gg's `sandbox` world.
///
/// Built by `packages/gg-sandbox-csharp/build.sh` and committed, for the reason every other guest
/// here is: gg is copied as a single file into an ephemeral run container and must carry everything
/// the turn path needs with it. Nothing about a C# *program* is compiled to wasm, so no wasm
/// toolchain reaches a run container on this arm at all.
#[allow(dead_code)]
pub(super) const GUEST_COMPONENT: &[u8] = include_bytes!("../guests/csharp.component.wasm");

/// **The committed guest against what says it built it** — the gate `scripts/ci/contract-drift.sh`
/// names when it exempts this arm's artifacts from being re-cut on every CI run.
#[cfg(test)]
#[path = "csharp.manifest.test.rs"]
mod manifest;

/// **The C# arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// runs a real `csc` and instantiates a 34.9 MB component, which is hundreds of milliseconds rather
/// than microseconds.
#[cfg(test)]
#[path = "csharp.substrate.test.rs"]
mod substrate;
