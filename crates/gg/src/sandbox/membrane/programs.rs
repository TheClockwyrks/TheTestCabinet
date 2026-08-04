//! The program library — the fourth model-facing carve-out on this membrane (the others are
//! [`session`](super::session), [`docs`](super::docs) and [`views`](super::views)).
//!
//! Like them it is NOT a gg tool: nothing dispatches it by name, so it has its own WIT interface and
//! the one-to-one correspondence the tool interfaces hold with
//! [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) is undisturbed. Unlike them it is gated by a
//! [capability](test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY) rather than being bound
//! unconditionally or by a role, which the host says with the `library` flag it passes to the
//! guest's `run` — so an agent without the capability has no `programs` object at all rather than
//! one whose every call is refused.
//!
//! The two **reads** go straight to the [api](super::ToolApi), because both of
//! [`dispatch`](super::MembraneState)'s guards are wrong for a call that is not a tool: there is no
//! enabled-set entry to check, and a spent wall-clock budget must not withhold a lookup that reads
//! gg's own memory and touches nothing.
//!
//! The one **write** — `rerun` — touches no api at all. It sets a field in this agent's host-side
//! state, exactly as [`finish`](super::session) does, and for the same reason: what it declares is a
//! decision about the *turn*, which only the host can act on. The program carries on to its end and
//! the loop reads the field once it has, which is what makes the hand-over impossible to lose to a
//! `try`/`catch` and impossible to perform underneath a program that is still running.

use super::test_cabinet::gg::programs::{Host as ProgramsHost, ProgramSummary};
use super::test_cabinet::gg::types::{ErrorCode, ToolError};
use super::{MembraneState, ToolApi};
use crate::sandbox::language::{PROGRAMS_GET, PROGRAMS_HISTORY, PROGRAMS_RERUN};

/// The name the membrane reports a `programs.rerun` refusal under.
///
/// It is not a gg tool, so it names *itself* — the same choice [`FINISH_FUNCTION`](super::super)
/// makes: putting a tool name in the error would name something the model did not call.
const RERUN_FUNCTION: &str = "rerun";

impl<A: ToolApi> ProgramsHost for MembraneState<A> {
    /// The programs this agent has run, oldest first. Cannot fail: an empty library is an empty
    /// list, which is the honest answer on the first turn of every session.
    fn history(&mut self) -> Vec<ProgramSummary> {
        self.recorded_ok(PROGRAMS_HISTORY, |state, rec| {
            state
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
                .collect()
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
                    tool: "get".to_string(),
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

/// A `rerun` refusal, named after the call itself.
///
/// It does **not** go through [`refuse`](MembraneState::refuse): that records the call on the
/// refused-tool roster, and this is not a tool — a line there would put a name in the operator's
/// stream that no gg tool answers to. The throw the program sees is the whole report, which is
/// exactly what it is for: the model reads it, drops the second hand-over, and carries on.
fn refused(code: ErrorCode, message: &str) -> ToolError {
    ToolError {
        code,
        tool: RERUN_FUNCTION.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
#[path = "programs.test.rs"]
mod tests;
