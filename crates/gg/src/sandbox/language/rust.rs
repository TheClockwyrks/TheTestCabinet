//! **Rust** — the first arm whose component is compiled **per turn**, because the program and the
//! artifact are the same object.
//!
//! What exists here today is this arm's **execution substrate and its model-facing surface**: the
//! compile that turns a model's Rust into a wasm component, the hand-written SDK that program is
//! compiled against, the catalogue reflected out of that SDK's own rustdoc, and the proof that all
//! three run through gg's own linker, membrane and store. The [registration](super::ProgramLanguage)
//! lands later — a language arm cannot be half-registered, because the registry's `match` is
//! exhaustive and every gate that iterates the registered set would immediately demand two
//! Handlebars templates and a healing dialect. Nothing here is reachable from a run: there is no
//! `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `rustc` and the in-process component encode, what
//!   they cost, what they share, and the two failures they tell apart;
//! * [`source`](self::source) — what gg writes around a model's Rust, on one line, and the one shape
//!   it refuses;
//! * `packages/gg-sandbox-rust/` — the crate a program is compiled against: the SDK, the shell, the
//!   curated library set, and the builds that commit them;
//! * `checkers/rust.libraries.tar.gz` and `checkers/rust.toolchain.json` — the compiled library set
//!   and what built it;
//! * `guests/rust.signatures.json` — the catalogue, which is the whole of what a model is told about
//!   this surface.
//!
//! # Why this arm has no component to commit
//!
//! Every arm before it evaluates a **string**. Python's committed component holds a whole CPython,
//! Ruby's holds Opal, the ECMAScript one holds a JavaScript engine, and a program crosses the
//! membrane as source those runtimes read. Rust has no runtime of that kind: `rustc` does not
//! produce a Rust interpreter that later runs a program, it produces the program. There is no
//! artifact of this language that is not one particular program, so there is nothing to commit and
//! nothing a per-process cache could hold.
//!
//! That is the shape the seam grew for. [`PreparedProgram::component`](super::PreparedProgram)
//! carries the bytes a preparation compiled, [`guest_component`](super::ProgramLanguage) answers
//! `None`, and [`program_component`](super::super::engine) is where the two shapes of arm meet. The
//! C++ and Swift arms are the same shape and inherit it.
//!
//! # What a Rust program is, here
//!
//! A **sequence of statements**, as on every arm but PureScript, put inside the body of a function
//! gg declares — because Rust has nowhere else for a statement to live, and because a function body
//! admits everything a Rust author writes: `use`, `struct`, `enum`, `trait`, `impl`, `fn`, `const`,
//! `static`, `mod`, `#[derive(…)]` and even an inner `#![allow(…)]`. See [`source`](self::source)
//! for the wrapper, its one line of cost, and the one program gg refuses: one that defines `fn
//! main` and expects gg to call it.
//!
//! The body returns `Result<(), gg::Failure>`, which is what makes `?` the operator a Rust author
//! reaches for against a `Result`-returning SDK. A wrapper returning `()` would make it a hard
//! `E0277` on the first line of the first program of the arm.
//!
//! The surface a program calls is `packages/gg-sandbox-rust`'s SDK, brought into scope by the one
//! `use ::gg::prelude::*;` the wrapper writes — a **glob**, because Rust lets an explicit `use`
//! shadow one and a program's own `use std::fs;` must win over gg's `fs`. Every API object is a
//! module, every call hands back `Result<_, ToolError>`, and optional arguments are a struct with a
//! `Default`. What that looks like in full is in `apps/docs/src/content/docs/gg/program-languages.md`.
//!
//! The library set is `std` plus the five crates `packages/gg-sandbox-rust/Cargo.toml` declares
//! under a `# --- heading ---`: `regex`, `serde_json`, `base64`, `itertools` and `indexmap`. Only
//! those and the SDK are named on `--extern`; the transitive closure under them is present, found
//! by `-L dependency=`, and not a name a program may write. The manifest carries the flag, the
//! catalogue's library list is reflected from the same headings, and a test compares the two before
//! compiling a program that uses all five — because a model told it may reach for something the
//! compile does not offer is a turn spent on gg's build.
//!
//! # What this arm has that no other does
//!
//! A guest with **no exception mechanism at all**. `wasm32-unknown-unknown` has no unwinder, so
//! `panic = "unwind"` is not available on it and a panic aborts, which traps the store — and a trap
//! carries no message, no class and no location. What saves the arm's error surface is that a panic
//! *hook* runs before the abort, on a live guest, and can make an ordinary synchronous host call:
//! `gg::program::begin` installs one that completes `feedback.report-error` carrying the panic's
//! message and the model's own line and column. The host half is
//! [`keep_reported_error`](crate::sandbox), which prefers what the program said about itself over
//! the trap that followed it.
//!
//! # What is not built yet, and what it blocks
//!
//! **Code modules**, and nothing else. A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>` by handing the guest its prepared source, and every arm so far can evaluate
//! that source at run time. Rust cannot: a module is Rust, and Rust is compiled — so a module has to
//! be linked into the same artifact as the program that uses it, which means the **program's**
//! preparation has to see it. It does not:
//! [`prepare_program`](super::ProgramLanguage::prepare_program) takes a source and a context, and
//! the modules reach the sandbox separately, on [`ProgramScope`](crate::sandbox::ProgramScope).
//!
//! That is a seam change — `prepare_program` taking the modules in scope, and `knowledge`'s pending
//! on-use script carrying a whole [`PreparedProgram`](super::PreparedProgram) rather than a
//! `String` — and it is deliberately not made here, because it touches every arm and belongs with
//! the work that needs it. **The registration step must make it first**: without it a Rust agent
//! that reads a code skill gets no `lib` binding at all, which is a capability silently absent on
//! one arm of a study about capability.

/// The `rustc` build and the in-process component encode: the host-side step that turns a model's
/// Rust into the component that evaluates it.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as
/// [Ruby](super::ruby)'s, [PureScript](super::purescript)'s and [Java](super::java)'s were between
/// their own substrate and their registration: nothing on the turn path can reach a language the
/// registry has no arm for, so every entry point here is reached only by this arm's own tests.
#[allow(dead_code)]
#[path = "rust.compile.rs"]
pub(super) mod compile;

/// The entry file gg writes around a model's Rust — one line of prologue, and the one shape it
/// refuses.
#[allow(dead_code)]
#[path = "rust.source.rs"]
pub(super) mod source;

/// **The Rust arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// runs a real `rustc` and compiles a wasm component, which is tens of milliseconds rather than
/// microseconds, and the isolation gate in it runs sixteen of them at once.
#[cfg(test)]
#[path = "rust.substrate.test.rs"]
mod substrate;

/// **The Rust arm's model-facing surface** — the hand-written SDK, the catalogue reflected out of
/// its own rustdoc, and the libraries this arm says a program may reach.
///
/// A separate file from [`substrate`] because it is a different claim: that one asks whether Rust
/// runs here, this one asks whether what a model is *told* it may write is what the sandbox really
/// has.
#[cfg(test)]
#[path = "rust.surface.test.rs"]
mod surface;
