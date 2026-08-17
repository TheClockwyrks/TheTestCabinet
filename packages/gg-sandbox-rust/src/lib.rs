//! `gg` — the crate a **Rust** [responses-as-code] program is compiled against.
//!
//! [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/overview/
//!
//! Under that capability a model answers a turn by writing a whole *program* instead of a batch of
//! tool calls, and the language it writes in is a run variable. This is the Rust arm's half of that:
//! the crate `rustc --extern gg=…` puts in scope when gg compiles a model's program, once per turn,
//! into the wasm component that turn is evaluated by.
//!
//! ```ignore
//! use gg::{files, session, shell, views};
//!
//! fn main() -> Result<(), gg::Failure> {
//!     let entries = files::list_dir(Some("src"))?;
//!     let sources: Vec<_> = entries
//!         .iter()
//!         .filter(|entry| entry.kind == files::EntryKind::File)
//!         .collect();
//!     let built = shell::run("cargo build", None)?;
//!     views::open_text("build", &built.output)?;
//!     session::finish(&format!("looked at {} sources", sources.len()))?;
//!     Ok(())
//! }
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
//! **gg writes nothing in front of a program.** `rustc --extern gg=…` puts the crate name `gg` in
//! the extern prelude — which is packaging, the same fact as a jar on a classpath — and everything
//! under it is reached either in full (`gg::files::read_file(…)`) or under a line the program wrote
//! (`use gg::files;`, then `files::read_file(…)`). There is no glob, no prelude module and no name
//! a program did not ask for.
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
//!   the run's operator, not to the model. A `println!` succeeds and its bytes are kept by nothing;
//!   what `eprintln!` writes is kept and is shown with a failure.
//! * **A failure is an [`Err`], not a panic.** Every call returns `Result<_, ToolError>`; `?`
//!   composes them, and [`Failure`] is what a `main` returning a `Result` carries. A panic is
//!   reported too — see below — but it is a bug rather than an interface.
//!
//! # The shape of a program
//!
//! A **whole Rust program**: the `use` lines it wants and a `fn main`, which is the entry point
//! `rustc` compiles a binary crate around and the one gg's shell calls. Nothing is written above it
//! or below it, so the file `rustc` reads and the file the model sent are the same bytes.
//!
//! `fn main() -> Result<(), gg::Failure>` is the shape to write against a `Result`-returning SDK,
//! because it is what makes `?` compose. A plain `fn main()` is a Rust program too, and there `?` is
//! an `E0277` — which is Rust's own answer rather than gg's.
//!
//! # How a failure gets out
//!
//! By the runtime killing the program, and gg reading what the runtime said. Nothing is intercepted:
//! there is no panic hook, no catch chain and no reporting call in this crate.
//!
//! The target is `wasm32-wasip1`, so the guest has a real standard error and gg wires it
//! (`crates/gg/src/sandbox/membrane.rs`). A panic writes `thread 'main' … panicked at program.rs:6:5:`
//! and the message — the model's own file and its own uncorrected coordinates, because there is no
//! wrapper to offset — and then aborts. A `main` returning `Err` has `std`'s own `Termination` write
//! `Error: …` before the shell propagates the status. [`std::process::exit`] is `proc_exit` here, so
//! a program that stops itself is reported as the exit it made, carrying the status it chose.

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

/// Write one line to the run's **operator** log.
///
/// It is this arm's `console.log`: the channel a program uses to say something to whoever is
/// watching the run, capped by the host and never shown back to the model. Showing something to the
/// model is [`views::open_text`], which is a view — attributable, closable, and in the next prompt.
///
/// It exists because standard output reaches nobody: gg attaches a standard **error** to the guest
/// and deliberately no standard output (`crates/gg/src/sandbox/membrane.rs`), so a `println!`
/// succeeds and its bytes are kept by nothing. What `eprintln!` writes is kept, and is shown to the
/// model with a failure; this is the channel that reaches the operator whether or not the program
/// fails.
///
/// It is deliberately **not** in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the capability modules, and this belongs to none of
/// them.
pub fn log(line: impl std::fmt::Display) {
    bindings::test_cabinet::gg::feedback::log(&line.to_string());
}
