//! Paths this crate's tests read from outside it.
//!
//! The contract fixtures live in the contracts repository, the `contracts/`
//! submodule, at `contracts/crates/contracts/fixtures/`. The one constant below
//! names that tree for every test that joins a path onto it.

/// The contract fixtures directory, relative to this crate's manifest directory.
pub(crate) const CONTRACT_FIXTURES: &str = "../../contracts/crates/contracts/fixtures";
