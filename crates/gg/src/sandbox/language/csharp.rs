//! **C#** — the arm whose compiler emits neither wasm nor source, and the only one that pairs a
//! real compiler on the turn path with a committed runtime that never changes.
//!
//! What exists here today is this arm's **execution substrate and its whole model-facing surface**: the
//! Roslyn compile that turns a model's C# into an IL assembly, the committed guest that interprets
//! it, the hand-written SDK a program calls, and the catalogue reflected out of that SDK's own
//! documentation. Only the [registration](super::ProgramLanguage) is left — a language arm cannot be
//! half-registered, because the registry's `match` is exhaustive and every gate that iterates the
//! registered set would immediately demand two Handlebars templates and a healing dialect. Nothing
//! here is reachable from a run: there is no `language` value that resolves to it yet.
//!
//! * [`compile`](self::compile) — the host-side `csc`, what it costs, what it refuses, and the two
//!   failures it tells apart;
//! * [`sdk`](self::sdk) — the SDK's sources, carried in gg's binary and compiled with the program;
//! * `packages/gg-sandbox-csharp/src/Gg/` — that SDK, and the XML documentation comments every word
//!   a model reads is reflected out of;
//! * `packages/gg-sandbox-csharp/Sources/` — the guest's C: the shell, the bridge, the trampolines;
//! * `guests/csharp.component.wasm` — the committed guest: Mono's IL interpreter, the .NET class
//!   libraries and ICU, as one self-contained component;
//! * `guests/csharp.signatures.json` — the catalogue, which is the whole of what a model is told
//!   about the surface;
//! * `checkers/csharp.toolchain.json` — what built the guest.
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
//! So this arm's guest is built by the runtime pack's **own supported build**, with three extra
//! translation units. The measured result is in `checkers/csharp.toolchain.json`: a 35.3 MB
//! component, produced by wasi-sdk's `clang` on `wasm32-wasip2`, holding the interpreter, 171
//! bundled assemblies and ICU.
//!
//! # What a C# program is, here
//!
//! **The model's reply, unaltered, as a compilation unit with an entry point.** No wrapper and no
//! prologue, so a diagnostic at line 7 is line 7 and there is no offset to subtract anywhere in this
//! arm. C# admits top-level statements, a `class`, a `record`, a `namespace` and a `using` in one
//! file, so nothing about the language forces the wrapper the statement-shaped arms need — and all
//! four ways a C# program can begin run here, **top-level statements first**, which is what a
//! program written to do one thing looks like in this decade.
//!
//! What puts gg's surface in front of it without touching a byte of it is a **`global using`**,
//! declared by the SDK rather than by gg: the SDK is compiled in the same compilation as the
//! program (see [`sdk`](self::sdk)), so `global using Gg;` in one of its own files applies to the
//! model's file too. It is the same mechanism .NET's implicit usings use, and it is why this arm
//! needs neither a prologue nor a `using` a model has to remember.
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
//! # What the SDK is
//!
//! Twelve `static class`es in `namespace Gg`, one per API object, each with `PascalCase` methods,
//! optional arguments a call names, real `enum`s, nullable reference types, `record`s for results
//! and a thrown `ToolException` for the error arm. It is compiled **with** the model's program
//! rather than referenced as a built assembly, which is what makes gg's surface reachable without
//! the committed guest having to carry it — see [`sdk`](self::sdk) for the argument and the cost
//! (~70 ms on a ~210 ms compile).
//!
//! The one place it departs from C#'s naming conventions is the **object names**, which are
//! lower-case: `fs`, `system`, `view`. That is not a choice — an object's name is
//! [identity](super::agreement), shared with every other arm, and it is what the console groups by
//! and what a documentation lookup routes on. Everything a language is free to spell is spelled the
//! way C# spells it.
//!
//! There is no logging function, and that is this arm's own answer rather than an omission:
//! `Console.WriteLine` reaches the run's operator, because the SDK redirects `Console.Out` onto gg's
//! feedback channel from a `[ModuleInitializer]`. A model writing the first line of C# it would
//! write anywhere else is understood.
//!
//! # What is not built yet, and what it blocks
//!
//! **The registration**: an enum variant, a registry arm, a healing dialect, two prompt templates
//! and the console's rows.
//!
//! **Code modules.** A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>`, and the shape this substrate wants is clear — a module is C# compiled into
//! the same compilation the program and the SDK are, which needs no reference and no second assembly
//! for the guest to find. What is left to decide is **what `lib.<key>` is**, and C# makes that a real
//! question rather than a formality: a namespace may hold only types, so a namespace called
//! `lib.<key>` is one nothing could be called on. The seam already hands a program's preparation the
//! modules in its scope. Until it is written,
//! [`compile_program`](self::compile::compile_program) takes no modules and this arm must not be
//! registered: a C# agent that read a code skill would otherwise get no `lib` binding at all, which
//! is a capability silently absent on one arm of a study about capability.

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

/// **The SDK a program is compiled against**, carried as source and written into the preparation's
/// own workspace beside `program.cs`.
#[path = "csharp.sdk.rs"]
pub(super) mod sdk;

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

/// **The C# arm's model-facing surface** — the SDK a model writes against, the catalogue reflected
/// out of it, and the libraries this arm says a program may reach, driven through the same real
/// toolchain and real membrane the substrate is.
#[cfg(test)]
#[path = "csharp.surface.test.rs"]
mod surface;
