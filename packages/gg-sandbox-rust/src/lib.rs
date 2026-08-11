//! `gg` — the crate a **Rust** [responses-as-code] program is compiled against.
//!
//! [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/
//!
//! Under that capability a model answers a turn by writing a whole *program* instead of a batch of
//! tool calls, and the language it writes in is a run variable. This is the Rust arm's half of that:
//! the crate `rustc --extern gg=…` puts in scope when gg compiles a model's program, once per turn,
//! into the wasm component that turn is evaluated by.
//!
//! ```ignore
//! let entries = files::list_dir(Some("src"))?;
//! let sources: Vec<_> = entries
//!     .iter()
//!     .filter(|entry| entry.kind == files::EntryKind::File)
//!     .collect();
//! let built = shell::run("cargo build", None)?;
//! views::open_text("build", &built.output)?;
//! session::finish(&format!("looked at {} sources", sources.len()))?;
//! ```
//!
//! # The surface is twelve capability modules
//!
//! [`files`], [`shell`], [`board`], [`tasks`], [`memories`], [`views`], [`docs`], [`context`],
//! [`delegation`], [`skills`], [`programs`] and [`session`] — plus [`core`], which declares no
//! function at all and holds the three types every other module's signatures name. A module is
//! Rust's own unit of
//! grouping, so `files::read_file` is an ordinary path, `gg::files::read_file` is the same function
//! written in full, and `use gg::files;` is how a program that wants only one of them shortens it.
//!
//! Each module owns the types it produces — `files::FileRead`, `board::IssueCreated`,
//! `tasks::TextEdit` — which is what makes a fully-qualified name a *real* Rust path rather than a
//! key gg invented, and what makes the surface collision-safe by construction: two modules may both
//! declare a `Usage` and neither has to be renamed.
//!
//! gg writes `use gg::prelude::*;` in front of every program, so every module name and the three
//! `core` types are already in scope. It is a **glob**, which Rust lets an explicit `use` shadow — so
//! a program's own `use std::fs;` wins over anything glob-imported, and nothing a program imports can
//! collide with what gg imported for it.
//!
//! The functions a run does **not** offer are still names this crate exports: a program that calls one
//! gets a [`ToolError`] carrying [`Unavailable`](ToolErrorCode::Unavailable) rather than a compile
//! error, because what a run enables is decided per run and this crate is compiled once.
//! [`docs::search`] is what reports the surface this run really bound: it returns only entries that
//! are callable here, so what it finds is what compiles *and* runs.
//!
//! # Three rules every program here obeys
//!
//! * **Every call is synchronous.** There is no executor, no `async` and no `.await`; a call is done
//!   when it returns.
//! * **A value a program computes is discarded unless it is shown.**
//!   [`views::open_text`] is how a program shows itself something. [`log`] goes to
//!   the run's operator, not to the model — and `println!` goes nowhere at all, because
//!   `wasm32-unknown-unknown` has no standard output.
//! * **A failure is an [`Err`], not a panic.** Every call returns `Result<_, ToolError>`; `?`
//!   composes them, and [`Failure`] is what the program's own body returns. A panic *is* reported —
//!   see [`program::begin`] — but it is a bug rather than an interface.
//!
//! # The shape of a program
//!
//! A program is a **sequence of statements**, as on every gg arm but PureScript. gg wraps the
//! model's text in a function body whose return type is `Result<(), `[`Failure`]`>` — which is what
//! makes `?` the operator a Rust author would reach for against a `Result`-returning SDK, rather
//! than the `E0277` a `()`-returning wrapper would have made of it.
//!
//! Everything Rust allows in a function body is therefore allowed in a program: `use`, `struct`,
//! `enum`, `impl`, `trait`, `fn`, `const`, `static`, `mod`, and `#[derive(…)]` on any of them. The
//! one thing that is not is a program that defines `fn main` and expects gg to call it — there is no
//! `main` on this arm, and gg refuses that program by name rather than running the half of it that
//! is not inside the function nobody called.
//!
//! # How a failure gets out
//!
//! Two ways, and they are different failures.
//!
//! * **The program returned `Err`.** Ordinary control flow: the shell reports it over
//!   `feedback.report-error` and the turn ends with a model-facing error carrying the failed call's
//!   own [`code`](ToolError::code).
//! * **The program panicked.** `wasm32-unknown-unknown` has no unwinder — `panic = "unwind"` is not
//!   available on it — so a panic aborts, and an abort traps the whole store. A trap carries no
//!   message and no location, so what a model would be told is "your program trapped" and nothing
//!   else. [`program::begin`] therefore installs a panic hook that completes a
//!   `feedback.report-error` host call **before** the abort, carrying the panic's message and the
//!   line and column of the model's own text. That call is not best-effort: it is a synchronous host
//!   call that finishes, and gg keeps what it recorded even though the store then traps.

/// The generated WIT bindings — every host function the sandbox offers, as `wit-bindgen` binds it.
///
/// **Not the model-facing surface.** These are the raw wire: `kebab-case` interfaces reached by
/// their full package path, results typed as WIT's `result<_, error>` rather than as anything a Rust
/// author would recognise, and — deliberately — the `feedback` interface, which
/// `crates/gg/wit/gg-sandbox.wit` calls "deliberately NOT part of the model-facing surface" and
/// which this arm's shell needs. The SDK is the curated facade over this; a model is never shown
/// this module.
///
/// Generated by `build.sh` with the pinned `wit-bindgen` CLI and **not committed**: it is a pure
/// function of `crates/gg/wit/gg-sandbox.wit` and that pin, and a copy in the tree would be a second
/// thing to keep in step with the wire.
#[allow(warnings)]
pub mod bindings;

pub mod program;

mod wire;

// The model-facing modules, each carrying the gg module id it binds. Alphabetical, because
// `rustfmt` sorts module declarations and this repository does not fight it — which is why the order
// a model is PRESENTED with them in lives in `tools/catalogue.py` instead, beside the rest of this
// surface's identity. That order is model-facing (it is the sequence the system prompt's module list
// renders in), the reflector emits the catalogue in it, and it fails if this list and that one name
// different modules.
//
// The `#[doc(alias = "ggmodule:…")]` on each is how a module says which of gg's cross-arm module ids
// it is. It is written on the declaration rather than in a side table for the reason every operation
// id is: a side table naming each module twice is the second copy that drifts.

#[doc(alias = "ggmodule:board")]
pub mod board;

#[doc(alias = "ggmodule:context")]
pub mod context;

#[doc(alias = "ggmodule:core")]
pub mod core;

#[doc(alias = "ggmodule:delegation")]
pub mod delegation;

#[doc(alias = "ggmodule:docs")]
pub mod docs;

#[doc(alias = "ggmodule:files")]
pub mod files;

#[doc(alias = "ggmodule:memories")]
pub mod memories;

#[doc(alias = "ggmodule:programs")]
pub mod programs;

#[doc(alias = "ggmodule:session")]
pub mod session;

#[doc(alias = "ggmodule:shell")]
pub mod shell;

#[doc(alias = "ggmodule:skills")]
pub mod skills;

#[doc(alias = "ggmodule:tasks")]
pub mod tasks;

#[doc(alias = "ggmodule:views")]
pub mod views;

pub use crate::core::{ToolError, ToolErrorCode};
pub use crate::program::Failure;

/// **gg's surface, in one glob** — every capability module, and the types that belong to no module.
///
/// gg writes `use gg::prelude::*;` into the entry file it compiles a program in, so a program starts
/// with all of it already in scope and needs no import line of its own. A glob is what makes that
/// safe rather than presumptuous: Rust lets an explicit `use` shadow a glob-imported name, so a
/// program that writes `use std::fs;` gets the standard library's and not this crate's.
///
/// It re-exports the **modules**, never the types inside them, and that is deliberate: a call written
/// `files::read_file` says which module documents it where a bare `read_file` would say nothing, and
/// a type written `tasks::TextEdit` leaves `board` free to declare a `TextEdit` of its own. The two
/// [`core`] types are the exception — they belong to every module, and a `match` on an error code
/// that had to name one would be a `match` nobody writes.
pub mod prelude {
    pub use crate::{
        board, context, delegation, docs, files, log, memories, programs, session, shell, skills,
        tasks, views,
    };

    pub use crate::core::{ToolError, ToolErrorCode};
    pub use crate::program::Failure;
}

/// Write one line to the run's **operator** log.
///
/// It is this arm's `console.log`: the channel a program uses to say something to whoever is
/// watching the run, capped by the host and never shown back to the model. Showing something to the
/// model is [`views::open_text`], which is a view — attributable, closable, and in the next prompt.
///
/// It exists because `println!` does not work here and cannot be made to: this arm's target is
/// `wasm32-unknown-unknown`, whose standard output is a sink that accepts every byte and keeps none.
/// A program that logged with `println!` would look like it was logging and be doing nothing, which
/// is the one failure shape this whole codebase spends the most effort not producing.
///
/// It is deliberately **not** in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the capability modules, and this belongs to none of
/// them.
pub fn log(line: impl std::fmt::Display) {
    bindings::test_cabinet::gg::feedback::log(&line.to_string());
}
