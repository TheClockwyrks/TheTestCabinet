//! Fetch a program that already ran, and hand a patched copy back to be run.
//!
//! Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
//! program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
//! what ran, patch it with ordinary string work, hand it back.
//!
//! ```ignore
//! let source = programs::get("k3p9")?;
//! programs::rerun(&source.replace("views::open_tex(", "views::open_text("))?;
//! ```

use crate::bindings::test_cabinet::gg::programs;
use crate::core::ApiError;
use crate::wire;

/// List the programs this session has already run, oldest first.
///
/// Each carries its id, the turn it ran on, how big it was, and whether it ran to its end. It lists
/// shapes, not sources: [`get`] is what fetches one. The list survives a compaction, so it is also
/// how a program whose text has left the context window is found again. A session that has run
/// nothing yet gets an empty `Vec` rather than an error.
///
/// # Returns
///
/// One summary per program this session has run, oldest first, each carrying the id [`get`] takes.
///
/// # Errors
///
/// `Unavailable` when this agent keeps no program library — which is a different fact from an empty
/// one, and the reason this hands back a `Result` rather than a bare `Vec`.
#[doc(alias = "ggop:programs.history")]
pub fn history() -> Result<Vec<ProgramSummary>, ApiError> {
    wire::lift(programs::history())
        .map(|summaries| summaries.into_iter().map(wire::program_summary).collect())
}

/// Fetch the exact source of one program that ran, by the id its acknowledgement carried.
///
/// The id is the tool result the `submit_program` call that carried the program was acknowledged
/// with — a receipt, not a verdict — and [`history`] reports it beside every program. This is the
/// first half of fixing a program without rewriting it: get what ran, patch it with ordinary string
/// work, and hand the result to [`rerun`]. What comes back is the program that **executed**, so when
/// a submission's program was itself handed over by [`rerun`], the program that ran is what arrives
/// rather than the few lines that asked for it — and fetch-patch-run composes turn after turn. A
/// rerun keeps the id of the submission it ran for.
///
/// # Arguments
///
/// * `id` — The program's id, as its acknowledgement carried it and as [`history`] reports it.
///
/// # Returns
///
/// That program's source, exactly as it executed — so a program that was itself handed over by
/// [`rerun`] comes back as what ran, not as the lines that asked for it.
///
/// # Errors
///
/// `NotFound`, naming the ids that are held, for an id this agent was never issued or one whose
/// program is old enough that the library has dropped it, and `Unavailable` when this agent keeps no
/// program library.
#[doc(alias = "ggop:programs.get")]
pub fn get(id: &str) -> Result<String, ApiError> {
    wire::lift(programs::get(id))
}

/// Hand gg a program to run in place of this one.
///
/// The calling program finishes, then gg compiles and runs `source` as this submission's program,
/// under the same id — so a later [`get`] of that id returns `source`, the program that ran. Used
/// with [`get`] it fixes a program without re-emitting it. Nothing is undone: every call the calling
/// program already made stands, and the program that runs next sees the world it left behind — so the
/// hand-over belongs before work that should not happen twice.
///
/// The first call stands, because a silently replaced program is a change nobody can see. If the
/// calling program then fails, the hand-over is cancelled along with everything else that program
/// decided, and the turn ends in an ordinary error. Chains are bounded: a submission runs at most
/// four programs, this one plus three handed over, and the fixed program is the one that does the
/// work.
///
/// # Arguments
///
/// * `source` — The program to run in place of this one, as Rust. It may not be blank.
///
/// # Errors
///
/// `Refused` for a second hand-over from the same program, `InvalidArgument` for a blank source, and
/// `Unavailable` when this agent keeps no program library.
#[doc(alias = "ggop:programs.rerun")]
pub fn rerun(source: &str) -> Result<(), ApiError> {
    wire::lift(programs::rerun(source))
}

/// One program that already ran, as [`history`] lists it.
///
/// It describes the program's **shape**, never its source: a directory that inlined every program
/// would put the whole session back in the context window, which is the one thing the library exists
/// to avoid. [`get`] is what fetches a source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramSummary {
    /// The id its `submit_program` acknowledgement carried — what [`get`] takes.
    pub id: String,
    /// The turn it ran on.
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

impl ProgramSummary {
    /// Fetch the exact source of this program.
    ///
    /// [`get`] with the id already supplied, for the common case where the summary worth fetching
    /// is in hand.
    ///
    /// # Returns
    ///
    /// That program's source, exactly as it executed.
    ///
    /// # Errors
    ///
    /// `NotFound` when the library's retention has since dropped that program.
    #[doc(alias = "ggop-alias:programs.get")]
    pub fn source(&self) -> Result<String, ApiError> {
        get(&self.id)
    }
}
