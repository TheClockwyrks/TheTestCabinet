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
//! # Why there are four of them
//!
//! An ending is a **result**, and a role's result has a shape: an agent doing work reports what it
//! did, a reviewer returns a verdict, a judge names a winner. Handing every role one
//! `finish(summary)` and reading the verdict back out of the summary text is what gg used to do, and
//! every such parse fails by producing a *plausible* answer rather than an error — a reviewer that
//! rejected the work and listed nothing to fix, a judge whose marker line never appeared. A typed
//! call cannot fail that way, because the shape is refused here before it is ever a verdict.
//!
//! The guest binds exactly one group, chosen by the [role](crate::ending::EndingRole) the host passed
//! to `run`, so the calls in this file that a given program can reach are the ones it was given.
//!
//! Nothing here touches the [api](super::ToolApi). Ending performs no work: it sets a flag in the
//! agent's own [context](MembraneState), which is why it goes to [`MembraneState::declare`] rather
//! than through the dispatch path's guards. Every rule these obey — last call wins, a malformed
//! declaration is refused, a spent wall-clock budget never withholds the exit, a program that fails
//! afterwards loses the ending — lives there, next to the field it writes.

use super::test_cabinet::gg::session::Host as SessionHost;
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::completion::{APPROVE_TOOL, FINISH_TOOL, REQUEST_CHANGES_TOOL};
use crate::ending::Ending;

impl<A: ToolApi> SessionHost for MembraneState<A> {
    /// Declare the work complete. See [`MembraneState::declare`] for what setting the flag does and
    /// does not do.
    fn finish(&mut self, summary: String) -> Result<(), ToolError> {
        self.declare(Ending::finished(summary), FINISH_TOOL)
    }

    /// Declare the work under review acceptable. Takes nothing, so there is nothing to refuse.
    fn approve(&mut self) -> Result<(), ToolError> {
        self.declare(Ok(Ending::Approved), APPROVE_TOOL)
    }

    /// Declare the work under review unacceptable. A list with nothing actionable in it is refused
    /// here rather than accepted and papered over downstream: it is dispatched verbatim to the agent
    /// that has to fix the work, and an empty one would give it nothing to do.
    fn request_changes(&mut self, items: Vec<String>) -> Result<(), ToolError> {
        self.declare(Ending::changes_requested(items), REQUEST_CHANGES_TOOL)
    }
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
