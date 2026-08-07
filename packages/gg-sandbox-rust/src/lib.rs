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
//! let entries = fs::list_dir(Some("src"))?;
//! let sources: Vec<_> = entries.iter().filter(|e| e.kind == EntryKind::File).collect();
//! let built = system::shell("cargo build", None)?;
//! view::open_text("build", &built.output)?;
//! harness::finish(&format!("looked at {} sources", sources.len()))?;
//! ```
//!
//! # The surface
//!
//! Everything a program may call hangs off one of a handful of **API objects** — [`fs`], [`system`],
//! [`project`], [`tasks`], [`memory`], [`view`], [`context`], [`agents`], [`skills`], [`programs`],
//! [`harness`], [`review`] — and in Rust an object is a **module**, so `fs::read_file` is an
//! ordinary path and `use gg::fs;` is how you shorten it. Each object also carries a `list`, which
//! is the directory of what that object really bound for this run.
//!
//! gg puts `use gg::prelude::*;` in front of every program, so all twelve objects and every type
//! below are already in scope. It is a **glob**, which Rust lets an explicit `use` shadow — so
//! `use std::fs;` in your own program wins over this crate's `fs`, and nothing you import can
//! collide with what gg imported for you.
//!
//! The objects a run does **not** offer are still names this crate exports: a program that calls one
//! gets a [`ToolError`] carrying [`Unavailable`](ToolErrorCode::Unavailable) rather than a compile
//! error, because what a run enables is decided per run and this crate is compiled once. What every
//! object's `list` reports, and what the system prompt describes, is what this run actually has.
//!
//! # Three rules every program here obeys
//!
//! * **Every call is synchronous.** There is no executor, no `async` and no `.await`; a call is done
//!   when it returns.
//! * **A value you compute is discarded unless you show it.**
//!   [`view::open_text`] is how a program shows itself something. [`log`] goes to
//!   the run's operator, not to you — and `println!` goes nowhere at all, because
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

mod error;
mod meta;
mod options;
mod types;
mod wire;

// The API objects. Alphabetical, because `rustfmt` sorts module declarations and this repository
// does not fight it — which is why the order a model is PRESENTED with them in lives in
// `tools/catalogue.py` instead, beside the rest of this surface's identity. That order is
// model-facing (it is the sequence the system prompt's API list renders in), the reflector emits the
// catalogue in it, and it fails if this list and that one name different modules.
pub mod agents;
pub mod context;
pub mod fs;
pub mod harness;
pub mod memory;
pub mod programs;
pub mod project;
pub mod review;
pub mod skills;
pub mod system;
pub mod tasks;
pub mod view;

pub use error::{ToolError, ToolErrorCode};
pub use options::{IssueOptions, IssuePatch, MemoryOptions, ReadOptions, TaskOptions, TaskPatch};
pub use program::Failure;
pub use types::{
    AgentStatus, ArchiveHit, ArchiveSearch, BoardUsage, Brief, DirEntry, EntryKind, EpicAssignment,
    EpicCreated, FileRead, FunctionSummary, ImageFile, IssueCreated, IssueStatus, MemoryHit,
    MemoryUsage, MessageRole, OpenView, ProgramSummary, ReclaimReport, ShellOutput, SubagentHandle,
    SubagentResult, TaskStatus, TaskUsage, TextEdit, TextFile, ViewKind, ViewRegion,
};

/// **gg's surface, in one glob** — every API object and every type this SDK hands back or takes.
///
/// gg writes `use gg::prelude::*;` into the entry file it compiles a program in, so a program starts
/// with all of it already in scope and needs no import line of its own. A glob is what makes that
/// safe rather than presumptuous: Rust lets an explicit `use` shadow a glob-imported name, so a
/// program that writes `use std::fs;` gets the standard library's and not this crate's.
pub mod prelude {
    pub use crate::{
        agents, context, fs, harness, log, memory, programs, project, review, skills, system,
        tasks, view,
    };

    pub use crate::error::{ToolError, ToolErrorCode};
    pub use crate::options::{
        IssueOptions, IssuePatch, MemoryOptions, ReadOptions, TaskOptions, TaskPatch,
    };
    pub use crate::program::Failure;
    pub use crate::types::{
        AgentStatus, ArchiveHit, ArchiveSearch, BoardUsage, Brief, DirEntry, EntryKind,
        EpicAssignment, EpicCreated, FileRead, FunctionSummary, ImageFile, IssueCreated,
        IssueStatus, MemoryHit, MemoryUsage, MessageRole, OpenView, ProgramSummary, ReclaimReport,
        ShellOutput, SubagentHandle, SubagentResult, TaskStatus, TaskUsage, TextEdit, TextFile,
        ViewKind, ViewRegion,
    };
}

/// Write one line to the run's **operator** log.
///
/// It is this arm's `console.log`: the channel a program uses to say something to whoever is
/// watching the run, capped by the host and never shown back to the model. Showing something to
/// **yourself** is [`view::open_text`], which is a view — attributable, closable, and in your next
/// prompt.
///
/// It exists because `println!` does not work here and cannot be made to: this arm's target is
/// `wasm32-unknown-unknown`, whose standard output is a sink that accepts every byte and keeps none.
/// A program that logged with `println!` would look like it was logging and be doing nothing, which
/// is the one failure shape this whole codebase spends the most effort not producing.
///
/// It is deliberately **not** in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the API objects, and this belongs to none of them.
pub fn log(line: impl std::fmt::Display) {
    bindings::test_cabinet::gg::feedback::log(&line.to_string());
}
