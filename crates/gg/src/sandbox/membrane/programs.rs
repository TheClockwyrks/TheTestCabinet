//! The program library — the fourth model-facing carve-out on this membrane (the others are
//! [`session`](super::session), [`docs`](super::docs) and [`views`](super::views)).
//!
//! Like them it is NOT a gg tool: nothing dispatches it by name, so it has its own WIT interface and
//! the one-to-one correspondence the tool interfaces hold with
//! [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) is undisturbed. Unlike them it is gated by a
//! [capability](test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY) rather than being bound
//! unconditionally or by a role.
//!
//! **The three calls below carry no capability check of their own.** Every arm's SDK is static —
//! the `programs` module is compiled into it whatever the agent holds — so the check is the
//! [bracket's](super::recording), taken from gg's own [operations table](crate::sandbox::Binding)
//! before any of these bodies runs. Without it an agent with no library could hand gg a replacement
//! program for a turn it was never given the capability to replace.
//!
//! The two **reads** go straight to the [api](super::ToolApi), because
//! [`dispatch`](super::MembraneState)'s deadline guard is wrong for a call that is not a tool: a
//! spent wall-clock budget must not withhold a lookup that reads gg's own memory and touches
//! nothing. The capability check is not a budget either — it is a fact about what this agent *is*,
//! so it applies whatever the clock says, which is exactly why it sits in the bracket above rather
//! than beside the deadline.
//!
//! The one **write** — `rerun` — touches no api at all. It sets a field in this agent's host-side
//! state, exactly as [`finish`](super::session) does, and for the same reason: what it declares is a
//! decision about the *turn*, which only the host can act on. The program carries on to its end and
//! the loop reads the field once it has, which is what makes the hand-over impossible to lose to a
//! `try`/`catch` and impossible to perform underneath a program that is still running.

use super::test_cabinet::gg::programs::{Host as ProgramsHost, ProgramSummary};
use super::test_cabinet::gg::types::{ErrorCode, ToolError};
use super::{MembraneState, ToolApi};
use crate::sandbox::operations::{PROGRAMS_GET, PROGRAMS_HISTORY, PROGRAMS_RERUN};

impl<A: ToolApi> ProgramsHost for MembraneState<A> {
    /// The programs this agent has run, oldest first — or `unavailable` when it keeps no library.
    ///
    /// A library it *does* keep and has run nothing into is an empty list rather than an error,
    /// which is the honest answer on the first turn of every session. That is exactly why this is a
    /// `result` and not a bare list: the empty answer and the refusal are different facts, and one
    /// list could only tell the model one of them.
    fn history(&mut self) -> Result<Vec<ProgramSummary>, ToolError> {
        self.recorded(PROGRAMS_HISTORY, |state, rec| {
            Ok(state
                .api(rec)
                .program_history()
                .into_iter()
                .map(|summary| ProgramSummary {
                    // The library counts turns in `u64` because a session's turn numbers are the
                    // context window's, which are; the membrane carries `u32`, which no real session
                    // approaches. Saturating rather than wrapping keeps a nonsense value out of a
                    // number the model will pass straight back to `get`.
                    turn: u32::try_from(summary.turn).unwrap_or(u32::MAX),
                    lines: summary.lines,
                    chars: summary.chars,
                    ok: summary.ok,
                    error: summary.error,
                })
                .collect())
        })
    }

    /// The source of one program as it was run, or `not-found` naming the turns that are held.
    fn get(&mut self, turn: Option<u32>) -> Result<String, ToolError> {
        self.recorded(PROGRAMS_GET, |state, rec| {
            state
                .api(rec)
                .program_source(turn.map(u64::from))
                .map_err(|refusal| ToolError {
                    code: super::error_code(Some(refusal.failure)),
                    tool: PROGRAMS_GET.key.to_string(),
                    message: refusal.message,
                })
        })
    }

    /// Register the program gg is to run in place of this one, and return.
    ///
    /// Registered and not performed: running it here would mean a program executing inside itself,
    /// with two sets of tool calls, two throw sites and one turn to report them in. The first
    /// declaration stands — a silently replaced program is a change the model cannot see, the same
    /// argument that makes a succession first-wins — and a blank source is refused rather than
    /// handed to a compiler that would answer with a syntax error about nothing.
    fn rerun(&mut self, source: String) -> Result<(), ToolError> {
        // The one host function on this membrane that touches neither the api nor the dispatch path
        // — it writes a field and returns — and it opens the bracket anyway. What is recorded is
        // that the model made the call, which is a fact about the model rather than about what gg
        // did with it.
        self.recorded(PROGRAMS_RERUN, |state, _rec| {
            // Nothing checks the capability here: the bracket above already did, so an agent with
            // no library is told it has none rather than told its (perfectly good) replacement
            // program was blank or came second.
            if source.trim().is_empty() {
                return Err(refused(
                    ErrorCode::InvalidArgument,
                    "`source` must not be blank",
                ));
            }
            if state.rerun.is_some() {
                return Err(refused(
                    ErrorCode::Refused,
                    "a program was already handed over this turn",
                ));
            }
            state.rerun = Some(source);
            Ok(())
        })
    }
}

/// A `rerun` refusal over the **argument** it was given, named after the call itself.
///
/// It does **not** go on the [refusal roster](MembraneState::record_refusal), and that is the line
/// between the two kinds of refusal this file produces. The roster answers "what did the model reach
/// for that this run does not offer it" — which is what the bracket's own
/// [gate](MembraneState::granted) records, and what a comparison of two configurations counts. A blank
/// source, or a second hand-over in one turn, is neither: the call was offered and was made, and
/// what it says about the model is nothing such a comparison is measuring. The throw the program sees is
/// the whole report, which is what it is for — the model reads it, drops the second hand-over, and
/// carries on.
fn refused(code: ErrorCode, message: &str) -> ToolError {
    ToolError {
        code,
        tool: PROGRAMS_RERUN.key.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
#[path = "programs.test.rs"]
mod tests;
