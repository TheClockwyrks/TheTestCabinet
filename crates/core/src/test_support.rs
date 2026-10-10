//! Paths this crate's tests read from outside it.
//!
//! The contract fixtures live in the contracts repository, the `contracts/`
//! submodule, at `contracts/crates/contracts/fixtures/`. The one constant below
//! names that tree for every test that joins a path onto it. The `include_str!`
//! sites that read the same tree (`gg_query.test.rs`, `review.goldens.test.rs`)
//! cannot take a constant and spell the path literally.

/// The contract fixtures directory, relative to this crate's manifest directory.
pub(crate) const CONTRACT_FIXTURES: &str = "../../contracts/crates/contracts/fixtures";
