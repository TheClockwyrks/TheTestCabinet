//! return your verdict on the work you are reviewing
//!
//! An ending is a **result**, and a reviewer's result has a shape of its own: not what was done, but
//! whether it may stand. So it is its own pair of calls rather than a `finish` carrying a verdict in
//! prose, and they are bound only for a program whose agent is reviewing — an agent doing work has
//! [`harness::finish`](crate::harness::finish) and no `review` object at all.

use crate::bindings::test_cabinet::gg::session;
use crate::error::ToolError;
use crate::wire;

crate::meta::directory_of!("review");

/// Accept the work you are reviewing: it meets every completion criterion and stays in scope. This
/// ends your session.
///
/// It does not stop your program — whatever follows it still runs — so call it last, once you have
/// actually read the change. It takes nothing: an approval carries no obligation beyond itself.
pub fn approve() -> Result<(), ToolError> {
    wire::lift(session::approve())
}

/// Reject the work you are reviewing, listing every change that must be made before it can be
/// accepted. This ends your session, and does not stop your program.
///
/// Each item says what is wrong and what to change; the list may not be empty.
///
/// # Arguments
///
/// * `items` — Every change that must be made before the work can be accepted, one per entry: what
///   is wrong, and what to change. It may not be empty.
///
/// # Errors
///
/// `InvalidArgument` when the list is empty.
pub fn request_changes(items: &[&str]) -> Result<(), ToolError> {
    wire::lift(session::request_changes(&wire::strings(items)))
}
