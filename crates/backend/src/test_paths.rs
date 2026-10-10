//! Paths this crate's tests read from outside it.
//!
//! The contract fixtures live in `crates/contracts/fixtures/`, a tree that moves
//! to the contracts repository, so the one constant below is the line a move of
//! that tree edits.

/// The contract fixtures directory, relative to this crate's manifest directory.
pub(crate) const CONTRACT_FIXTURES: &str = "../contracts/fixtures";
