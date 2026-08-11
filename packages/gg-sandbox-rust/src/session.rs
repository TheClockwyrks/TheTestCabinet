//! End the session, with the ending that belongs to this agent's role.
//!
//! Under responses as code every reply is a program, so there is no prose turn that could mean "the
//! work is done" — a model that answers "task complete" has written a reply that failed to be a
//! program, not an ending. These are the calls that mean it, and a run binds only the group its
//! agent's role has: an agent doing work gets [`finish`], and a reviewer gets [`approve`] and
//! [`request_changes`] instead.
//!
//! None of them stops the program. Whatever follows an ending still runs, so an ending belongs last —
//! and a program that then fails has its ending revoked along with everything else it decided.

use crate::bindings::test_cabinet::gg::session;
use crate::core::ToolError;
use crate::wire;


/// End the session, reporting what was done in a sentence or two.
///
/// This is the only thing that ends a working agent's session. It does not stop the program — whatever
/// follows it still runs — so it belongs last, once the tools have confirmed the work is really done.
/// A program that then fails has the ending cancelled and gets another turn.
///
/// # Arguments
///
/// * `summary` — What was done, in a sentence or two.
///
/// # Errors
///
/// `InvalidArgument` for a blank summary, and `Unavailable` when this agent's role ends its session
/// some other way.
#[doc(alias = "ggop:session.finish")]
pub fn finish(summary: &str) -> Result<(), ToolError> {
    wire::lift(session::finish(summary))
}

/// Accept the work under review: it meets every completion criterion and stays in scope.
///
/// This ends the session. It does not stop the program — whatever follows it still runs — so it
/// belongs last, once the change has actually been read. It takes nothing, because an approval
/// carries no obligation beyond itself.
///
/// # Errors
///
/// `Unavailable` when this agent's role ends its session some other way.
#[doc(alias = "ggop:session.approve")]
pub fn approve() -> Result<(), ToolError> {
    wire::lift(session::approve())
}

/// Reject the work under review, listing every change that must be made before it can be accepted.
///
/// This ends the session, and does not stop the program. Each item says what is wrong and what to
/// change.
///
/// # Arguments
///
/// * `items` — Every change that must be made before the work can be accepted, one per entry: what is
///   wrong, and what to change. It may not be empty.
///
/// # Errors
///
/// `InvalidArgument` when the list is empty, and `Unavailable` when this agent's role ends its
/// session some other way.
#[doc(alias = "ggop:session.request_changes")]
pub fn request_changes(items: &[&str]) -> Result<(), ToolError> {
    wire::lift(session::request_changes(&wire::strings(items)))
}
