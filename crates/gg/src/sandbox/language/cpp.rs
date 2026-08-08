//! **C++** — the third arm whose component is compiled **per turn**, and the second whose program
//! is compiled *verbatim*.
//!
//! What exists here today is this arm's **execution substrate** and nothing else: the compile that
//! turns a model's C++ into a wasm component, and the proof that a real C++ program really does run
//! through gg's own linker, membrane and store. The SDK and the
//! [registration](super::ProgramLanguage) land later — a language arm cannot be half-registered,
//! because the registry's `match` is exhaustive and every gate that iterates the registered set
//! would immediately demand a catalogue, two Handlebars templates and a healing dialect. Nothing
//! here is reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `clang++`, the precompiled prelude that makes it
//!   affordable, the in-process component encode with the preview1 adapter, what they cost, what
//!   they share, and the two failures they tell apart;
//! * [`source`](self::source) — the one thing gg reads out of a reply, which is whether it defines
//!   `main`, and the lexer that reads it;
//! * `packages/gg-sandbox-cpp/` — the prelude every program is compiled against, the shell it is
//!   linked with, and the build that commits them;
//! * `checkers/cpp.guest.tar.gz`, `checkers/cpp.adapter.wasm` and `checkers/cpp.toolchain.json` —
//!   the compile inputs, the adapter, and what built them.
//!
//! # Why this arm has no component to commit
//!
//! For the reason [Rust](super::rust) and [Swift](super::swift) have none. Every arm before those
//! three evaluates a **string**: Python's committed component holds a whole CPython, Ruby's holds
//! Opal, the ECMAScript one holds a JavaScript engine, and a program crosses the membrane as source
//! those runtimes read. `clang++` does not produce a C++ interpreter that later runs a program; it
//! produces the program, and that module *is* the component. There is no artifact of this language
//! that is not one particular program, so there is nothing to commit and nothing a per-process cache
//! could hold.
//!
//! # What a C++ program is, here
//!
//! **The model's reply, unaltered, as a translation unit that defines `main`.** Not a function body
//! and not anything gg wrapped: the bytes the model wrote are the bytes `clang++` reads, so a
//! diagnostic at line 7 is line 7 and there is no offset to subtract anywhere in this arm.
//!
//! That is forced rather than chosen, and C++ forces it harder than Swift did. A function-body
//! wrapper would refuse a `template`, which may not be declared at block scope at all and is most of
//! what generic C++ is; a `namespace`, for the same reason; and a `#include`, which would still
//! *expand* and would expand the whole of `<vector>` inside a function body. A translation unit is
//! the only C++ context that admits all three.
//!
//! The price is the one refusal this arm has, and it is the exact inverse of the
//! [Rust](super::rust) arm's. Rust has no `main` and refuses a program that defines one. C++ has
//! nowhere for a bare statement to live, so a reply that defines **no** `main` is a program with
//! nothing to run — and gg refuses it by name, at prepare time, rather than letting it link. That
//! `wasm-ld` links one at all is the surprising half and is measured rather than assumed: wasi-libc
//! references `main` **weakly**, so the missing entry point resolves to a stub that traps and the
//! compiler exits zero. See [`source`](self::source) for why no linker flag asks the question and
//! why gg's lexical answer can only be wrong in the safe direction.
//!
//! # What this arm has that no other does
//!
//! **A real exception mechanism.** [Rust](super::rust) aborts and reaches for a panic hook;
//! [Swift](super::swift) traps and has no hook at all. C++ here has `throw`, `try` and `catch`, and
//! they work — `-fwasm-exceptions` with the standardised encoding, against a wasmtime configured to
//! accept it. What that cost the workspace is written down in [`compile`](self::compile) rather than
//! quietly absorbed: wasmtime's exception support is behind a build feature that the two other wasm
//! hosts in this repository now also build with, and both pin their own validation surface back
//! explicitly rather than inheriting a wider one.
//!
//! # What this arm has that is worse than any other, and cannot be engineered away
//!
//! **A failure that says nothing.** Two of the three ways a C++ program fails here carry their own
//! words, and both take a decision to get there. An uncaught `throw` is caught by gg's shell and
//! reported as an ordinary model-facing error carrying the exception's own class and `what()` —
//! without which it would be a bare `thrown Wasm exception`, since an exception escaping `main`
//! under `-fwasm-exceptions` never reaches `std::terminate`. A libc++ **hardening** check —
//! `v[10]`, `.front()` on an empty container — carries libc++'s own sentence *and* the model's own
//! line, out of the artifact's debug information, and only because gg turns hardening on: wasi-sdk
//! ships libc++ configured to check nothing.
//!
//! The third is undefined behaviour, and it arrives as a bare trap: an integer division by zero, a
//! dereferenced null, a pointer past the end of an array. `-g1` locates it at the model's own line
//! and that is all anything can do.
//!
//! It is worth stating plainly because it is a **comparability** risk rather than only a usability
//! one: on this arm, and on no other here, a failure caused by the language can be hard to tell in
//! the run record from a model that reasoned badly. A study reading this arm beside the others has
//! to know that — and hardening is what keeps the most common shape of it, an out-of-bounds
//! container access, out of that band and in the one above.
//!
//! # What is not built yet, and what it blocks
//!
//! **Code modules.** A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>` for every program the agent writes afterwards, and on a compiled arm that
//! binding is a **link**: the module has to be built into the same artifact as the program that uses
//! it. The seam already hands a program's preparation the modules in its scope — the Rust arm's
//! registration made that change — so nothing structural is missing.
//!
//! What is missing is a decision that looks easier here than it was on Swift and is not. C++ has a
//! real nested namespace, so `namespace lib::csv_tools { … }` wrapped around a module's declarations
//! *where they stand* would preserve every line number and every default argument — the shape the
//! Swift arm had to reach for an `extension` of a caseless `enum` to get. The problem is the same
//! one that decided the program shape: a module author will write `#include <vector>` at the top of
//! their file, and a `#include` inside a namespace puts the whole of `std` inside `lib::csv_tools`.
//! Hoisting the includes out is a rewrite of the author's file, which is the one thing this arm has
//! so far never done — and the alternative, relying on the prelude so a module needs no include at
//! all, is a rule a model has to be *told*, which makes it the SDK's decision rather than the
//! compile's.
//!
//! Until it is made, [`compile_program`](self::compile::compile_program) takes no modules and this
//! arm must not be registered: a C++ agent that read a code skill would otherwise get no `lib`
//! binding at all, which is a capability silently absent on one arm of a study about capability.

/// The `clang++` build and the in-process component encode: the host-side step that turns a model's
/// C++ into the component that evaluates it.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as [Ruby](super::ruby)'s,
/// [PureScript](super::purescript)'s, [Java](super::java)'s, [Rust](super::rust)'s and
/// [Swift](super::swift)'s were between their own substrate and their registration: nothing on the
/// turn path can reach a language the registry has no arm for, so every entry point here is reached
/// only by this arm's own tests.
#[allow(dead_code)]
#[path = "cpp.compile.rs"]
pub(super) mod compile;

/// What gg reads out of a model's C++ — whether it defines `main` — and the lexer that reads it.
#[allow(dead_code)]
#[path = "cpp.source.rs"]
pub(super) mod source;

/// **The C++ arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// runs a real `clang++` and compiles a wasm component, which is tens or hundreds of milliseconds
/// rather than microseconds, and the isolation gate in it runs sixteen of them at once.
#[cfg(test)]
#[path = "cpp.substrate.test.rs"]
mod substrate;
