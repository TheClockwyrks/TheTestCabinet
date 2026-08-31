//! End the session, with the ending that belongs to this session's role.
//!
//! A run binds only the group its role has: work is ended by reporting what was done, and a review
//! is ended with a verdict.
//!
//! None of these calls stops the program. Whatever follows an ending still runs, and a program that
//! then fails has its ending revoked along with everything else it decided.

use crate::bindings::test_cabinet::gg::session;
use crate::core::ApiError;
use crate::wire;

/// End the session, reporting what was done in a sentence or two.
///
/// It does not stop the program: whatever follows it still runs. A program that then fails has the
/// ending cancelled and gets another turn.
///
/// # Arguments
///
/// * `summary` — What was done, in a sentence or two.
///
/// # Errors
///
/// `InvalidArgument` for a blank summary, and `Unavailable` when this session's role ends some other
/// way.
#[doc(alias = "ggop:session.finish")]
pub fn finish(summary: &str) -> Result<(), ApiError> {
    wire::lift(session::finish(summary))
}

/// Accept the work under review: it meets every completion criterion and stays in scope.
///
/// This ends the session. It does not stop the program: whatever follows it still runs.
///
/// # Errors
///
/// `Unavailable` when this session's role ends some other way.
#[doc(alias = "ggop:session.approve")]
pub fn approve() -> Result<(), ApiError> {
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
/// `InvalidArgument` when the list is empty, and `Unavailable` when this session's role ends some
/// other way.
#[doc(alias = "ggop:session.request_changes")]
pub fn request_changes(items: &[&str]) -> Result<(), ApiError> {
    wire::lift(session::request_changes(&wire::strings(items)))
}
