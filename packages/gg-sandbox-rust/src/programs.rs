//! Fetch a program that already ran, and hand a patched copy back to be run.
//!
//! Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
//! program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
//! what ran, patch it with ordinary string work, hand it back.
//!
//! ```ignore
//! let source = programs::get(None)?;
//! programs::rerun(&source.replace("files::read_fil(", "files::read_file("))?;
//! ```

use crate::bindings::test_cabinet::gg::programs;
use crate::core::ToolError;
use crate::wire;


/// List the programs this session has already run, oldest first.
///
/// Each carries the turn it ran on, how big it was, and whether it ran to its end. It lists shapes,
/// not sources: [`get`] is what fetches one. The list survives a compaction, so it is also how a
/// program whose text has left the context window is found again. A session that has run nothing yet
/// gets an empty `Vec` rather than an error.
///
/// # Errors
///
/// `Unavailable` when this agent keeps no program library — which is a different fact from an empty
/// one, and the reason this hands back a `Result` rather than a bare `Vec`.
#[doc(alias = "ggop:programs.history")]
pub fn history() -> Result<Vec<ProgramSummary>, ToolError> {
    wire::lift(programs::history())
        .map(|summaries| summaries.into_iter().map(wire::program_summary).collect())
}

/// Fetch the exact source of one program that ran, as a `String`; `None` fetches the most recent.
///
/// This is the first half of fixing a program without rewriting it: get what ran, patch it with
/// ordinary string work, and hand the result to [`rerun`]. What comes back is the program that
/// **executed**, so when a turn's program was itself handed over by [`rerun`], the program that ran is
/// what arrives rather than the few lines that asked for it — and fetch-patch-run composes turn after
/// turn.
///
/// # Arguments
///
/// * `turn` — The turn whose program to fetch, as [`history`] reports it; `None` fetches the most
///   recent one.
///
/// # Errors
///
/// `NotFound`, naming the turns that are held, for a turn that ran no program or one old enough that
/// the library has dropped it, and `Unavailable` when this agent keeps no program library.
#[doc(alias = "ggop:programs.get")]
pub fn get(turn: Option<u32>) -> Result<String, ToolError> {
    wire::lift(programs::get(turn))
}

/// Hand gg a program to run in place of this one.
///
/// The calling program finishes, then gg compiles and runs `source` as this turn's program. Used with
/// [`get`] it fixes a program without re-emitting it. Nothing is undone: every call the calling
/// program already made stands, and the program that runs next sees the world it left behind — so the
/// hand-over belongs before work that should not happen twice.
///
/// The first call stands, because a silently replaced program is a change nobody can see. If the
/// calling program then fails, the hand-over is cancelled along with everything else that program
/// decided, and the turn ends in an ordinary error. Chains are bounded: one hand-over per turn, and
/// the fixed program is the one that does the work.
///
/// # Arguments
///
/// * `source` — The program to run in place of this one, as Rust. It may not be blank.
///
/// # Errors
///
/// `Refused` for a second hand-over in one turn, `InvalidArgument` for a blank source, and
/// `Unavailable` when this agent keeps no program library.
#[doc(alias = "ggop:programs.rerun")]
pub fn rerun(source: &str) -> Result<(), ToolError> {
    wire::lift(programs::rerun(source))
}

/// One program that already ran, as [`history`] lists it.
///
/// It describes the program's **shape**, never its source: a directory that inlined every program
/// would put the whole session back in the context window, which is the one thing the library exists
/// to avoid. [`get`] is what fetches a source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramSummary {
    /// The turn it ran on — what [`get`] takes.
    pub turn: u32,
    /// How many lines of source it was.
    pub lines: u32,
    /// How many characters of source it was.
    pub chars: u32,
    /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
    pub ok: bool,
    /// The error it ended with, when it did not run to its end.
    pub error: Option<String>,
}
