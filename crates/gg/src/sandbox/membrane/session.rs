//! Ending the run — the one model-facing function on this membrane that is not a gg tool.
//!
//! Under responses-as-code every turn is a program, so there is no prose turn that could mean "I am
//! done": a model that answers "task complete" has written a reply that failed to *be* a program,
//! not a completion. `finish(summary)` is what means it, and it is the only thing that does.
//!
//! It has its own interface in the WIT, and its own file here, for one structural reason: the eight
//! tool interfaces stand in exact one-to-one correspondence with gg's
//! [tool vocabulary](crate::tools::ALL_TOOL_NAMES), and that bijection is what the committed
//! component is checked against. A function that is not a tool — no capability offers it, nothing
//! dispatches it, and it is bound into every program's scope including one in a run that enables no
//! tools at all — would perturb that check if it were filed among them.
//!
//! Nothing here touches the [api](super::ToolApi). Finishing performs no work: it sets a flag in the agent's own
//! [context](MembraneState), which is why it goes to [`MembraneState::complete`] rather than through
//! the dispatch path's guards. The whole implementation is one delegation, and every rule it obeys —
//! last call wins, an empty summary is refused, a spent wall-clock budget never withholds the exit,
//! a program that fails afterwards loses the ending — lives there, next to the field it writes.

use super::test_cabinet::gg::session::Host as SessionHost;
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};

impl<A: ToolApi> SessionHost for MembraneState<A> {
    /// Set this agent's completion flag and return.
    ///
    /// The program is not stopped, nothing is unwound, and no later call is refused: what ends the
    /// run is the loop reading this flag once the program has ended. That is what makes the ending a
    /// fact gg owns rather than an exception the guest has to raise and the program must not catch.
    fn finish(&mut self, summary: String) -> Result<(), ToolError> {
        self.complete(summary)
    }
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
