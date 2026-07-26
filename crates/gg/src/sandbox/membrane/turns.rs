//! The three turn-level transitions, which always fail here.
//!
//! `enter_plan_mode`, `submit_plan` and `advance_state` change the **loop's mode**: the rest of the
//! turn runs read-only, or the run moves to its next process state. A program has nothing to
//! compose that into — "the rest of this turn is now a planning pass" is not a value — so the
//! sandbox never binds them into a program's scope, and a model is told as much in its system
//! prompt when a capability that offers them is on.
//!
//! They are nevertheless declared in the WIT and implemented here, for two reasons. The membrane
//! then covers gg's **whole** tool vocabulary, so "is every gg tool accounted for?" is a question
//! the compiler answers rather than a list someone maintains. And a guest that reached one anyway —
//! a hand-built guest, or a future one with a bug — is refused with an explanation instead of
//! silently reaching the loop and changing a mode mid-program.
//!
//! Nothing here touches the invoker: there is no dispatch to make, so the refusal is recorded as a
//! refusal (never as a serviced call) and returns immediately.

use super::MembraneState;
use super::test_cabinet::gg::turns::Host as TurnsHost;
use super::test_cabinet::gg::types::ToolError;
use crate::tools::{ADVANCE_STATE_TOOL, ENTER_PLAN_MODE_TOOL, SUBMIT_PLAN_TOOL};

impl TurnsHost for MembraneState {
    fn enter_plan_mode(&mut self) -> Result<(), ToolError> {
        Err(self.refuse_turn_level(ENTER_PLAN_MODE_TOOL, "entering plan mode"))
    }

    fn submit_plan(&mut self, _plan: String) -> Result<(), ToolError> {
        Err(self.refuse_turn_level(SUBMIT_PLAN_TOOL, "submitting a plan"))
    }

    fn advance_state(&mut self, _note: Option<String>) -> Result<(), ToolError> {
        Err(self.refuse_turn_level(ADVANCE_STATE_TOOL, "advancing the run's process state"))
    }
}

#[cfg(test)]
#[path = "turns.test.rs"]
mod tests;
