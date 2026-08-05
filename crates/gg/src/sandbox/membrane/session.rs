//! Ending the session — the model-facing functions on this membrane that are not gg tools.
//!
//! Under responses-as-code every turn is a program, so there is no prose turn that could mean "I am
//! done": a model that answers "task complete" has written a reply that failed to *be* a program, not
//! an ending. These calls are what mean it, and they are the only things that do.
//!
//! They have their own interface in the WIT, and their own file here, for one structural reason: the
//! eight tool interfaces stand in exact one-to-one correspondence with gg's
//! [tool vocabulary](crate::tools::ALL_TOOL_NAMES), and that bijection is what the committed
//! component is checked against. A function that is not a tool — no capability offers it, nothing
//! dispatches it, and one group of them is bound into every program's scope including one in a run
//! that enables no tools at all — would perturb that check if it were filed among them.
//!
//! # Why there are three of them
//!
//! An ending is a **result**, and a role's result has a shape: an agent doing work reports what it
//! did, a reviewer returns a verdict, a judge names a winner. Handing every role one
//! `finish(summary)` and reading the verdict back out of the summary text is what gg used to do, and
//! every such parse fails by producing a *plausible* answer rather than an error — a reviewer that
//! rejected the work and listed nothing to fix, a judge whose marker line never appeared. A typed
//! call cannot fail that way, because the shape is refused here before it is ever a verdict.
//!
//! The guest binds exactly one group, chosen by the [role](crate::ending::EndingRole) the host passed
//! to `run` — and the host checks the same value again on every call, because a guest that links its
//! SDK as an ordinary library has no scope to withhold a name from. A verdict is the one declaration
//! nothing downstream re-examines, so an agent that may not give one must be stopped from giving one
//! here.
//!
//! Nothing here touches the [api](super::ToolApi) for the *work* — ending performs none: it sets a
//! flag in the agent's own [context](MembraneState), which is why it goes to
//! [`MembraneState::declare`] rather than through the dispatch path's guards. Every rule these obey
//! — the role gate first, last call wins, a malformed declaration is refused, a spent wall-clock
//! budget never withholds the exit, a program that fails afterwards loses the ending — lives there,
//! next to the field it writes.
//!
//! They are still **recorded** like every other model-facing call, through the same
//! [bracket](super::recording): "no tool dispatches it" was never a reason for `harness.finish` to
//! be the one call an agent made that nothing counted.

use super::test_cabinet::gg::session::Host as SessionHost;
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::ending::Ending;
use crate::sandbox::language::{HARNESS_FINISH, REVIEW_APPROVE, REVIEW_REQUEST_CHANGES};

impl<A: ToolApi> SessionHost for MembraneState<A> {
    /// Declare the work complete. See [`MembraneState::declare`] for what setting the flag does and
    /// does not do, and for the role check every one of these three passes through first.
    fn finish(&mut self, summary: String) -> Result<(), ToolError> {
        self.recorded(HARNESS_FINISH, |state, rec| {
            state.declare(rec, Ending::finished(summary), HARNESS_FINISH)
        })
    }

    /// Declare the work under review acceptable. Takes nothing, so the only thing that can refuse it
    /// is the role check: an agent that was not dispatched to review has no verdict to give.
    fn approve(&mut self) -> Result<(), ToolError> {
        self.recorded(REVIEW_APPROVE, |state, rec| {
            state.declare(rec, Ok(Ending::Approved), REVIEW_APPROVE)
        })
    }

    /// Declare the work under review unacceptable. A list with nothing actionable in it is refused
    /// here rather than accepted and papered over downstream: it is dispatched verbatim to the agent
    /// that has to fix the work, and an empty one would give it nothing to do.
    fn request_changes(&mut self, items: Vec<String>) -> Result<(), ToolError> {
        self.recorded(REVIEW_REQUEST_CHANGES, |state, rec| {
            state.declare(
                rec,
                Ending::changes_requested(items),
                REVIEW_REQUEST_CHANGES,
            )
        })
    }
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
