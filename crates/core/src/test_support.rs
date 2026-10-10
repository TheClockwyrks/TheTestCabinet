//! Paths this crate's tests read from outside it.
//!
//! The contract fixtures live in `crates/contracts/fixtures/`, a tree that moves
//! to the contracts repository, so the one constant below is the line a move of
//! that tree edits. The `include_str!` sites that read the same tree
//! (`gg_query.test.rs`, `review.goldens.test.rs`) cannot take a constant and
//! spell the path literally.

/// The contract fixtures directory, relative to this crate's manifest directory.
pub(crate) const CONTRACT_FIXTURES: &str = "../contracts/fixtures";
