//! fetch a program you already ran, and hand a patched copy back to be run
//!
//! Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
//! program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
//! what ran, patch it with ordinary string work, hand it back.
//!
//! ```ignore
//! let source = programs::get(None)?;
//! programs::rerun(&source.replace("fs::read_fil(", "fs::read_file("))?;
//! ```

use crate::bindings::test_cabinet::gg::programs;
use crate::error::ToolError;
use crate::types::ProgramSummary;
use crate::wire;

crate::meta::directory_of!("programs");

/// The programs you have already run this session, oldest first — each with the turn it ran on, how
/// big it was, and whether it ran to its end.
///
/// It lists shapes, not sources: fetch the one you want with [`get`]. The list survives a
/// compaction, so it is also how you find a program whose text has left your context window. It is
/// empty — never an error — for a session that has run nothing yet.
pub fn history() -> Result<Vec<ProgramSummary>, ToolError> {
    wire::lift(programs::history())
        .map(|summaries| summaries.into_iter().map(wire::program_summary).collect())
}

/// The exact source of one program you ran, as a `String`. With `None`, your most recent one.
///
/// This is the first half of fixing a program without rewriting it: get what ran, patch it with
/// ordinary string work, and hand the result to [`rerun`]. What comes back is the program that
/// **executed** — so when a turn's program was itself handed over by `programs::rerun`, you get the
/// program that ran, not the few lines that asked for it, and fetch-patch-run composes turn after
/// turn.
///
/// # Arguments
///
/// * `turn` — The turn whose program to fetch, as [`history`] reports it; `None` fetches your most
///   recent one.
///
/// # Errors
///
/// `NotFound`, naming the turns that are held, for a turn that ran no program or one old enough that
/// the library has dropped it.
pub fn get(turn: Option<u32>) -> Result<String, ToolError> {
    wire::lift(programs::get(turn))
}

/// Hand gg a program to run in place of this one. Your program finishes, then gg compiles and runs
/// `source` as this turn's program.
///
/// Use it with [`get`] to fix a program without re-emitting it. Nothing is undone: every call your
/// program already made stands, and the program that runs next sees the world your program left
/// behind — so hand over BEFORE doing work you do not want done twice.
///
/// The first call stands, because a silently replaced program is a change you cannot see. If your
/// program then fails, the hand-over is cancelled along with everything else the failed program
/// decided, and you get an ordinary error turn instead. Chains are bounded: hand over once per turn,
/// and write the fixed program to do the work.
///
/// # Arguments
///
/// * `source` — The program to run in place of this one, as Rust. It may not be blank.
///
/// # Errors
///
/// `Refused` for a second hand-over in one turn, and `InvalidArgument` for a blank source.
pub fn rerun(source: &str) -> Result<(), ToolError> {
    wire::lift(programs::rerun(source))
}
