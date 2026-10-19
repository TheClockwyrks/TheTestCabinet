//! The engine resolution the local commands share.
//!
//! `tcab seed`, `tcab validate` and `tcab prompt` each take an `--engine`, and each
//! has to answer the same two questions before it does anything: is the slug one
//! this build carries, and is it one the case declares support for. A run launched
//! from the console is gated by the run engine the driver executes; a local command
//! has no such gate and must do it itself.

use anyhow::Result;
use test_cabinet_driver::{
    EngineSelection, ResolvedEngine, TestCaseVersion, ensure_engine_supported,
};

/// Resolve an `--engine` slug for a specific test case version, refusing an
/// engine the case does not support.
///
/// The two failures are reported in this order deliberately, matching the engine's
/// own gate: an unresolvable slug is a typo on the flag and is reported as the
/// unknown engine it is — naming every engine that would have worked — rather
/// than as an engine this case happens not to support, which would send the user
/// looking in the wrong place. Only a slug that *is* an engine is then held
/// against the case's declared set.
///
/// The case-side half is the engine's own
/// [`ensure_engine_supported`] rather than a re-statement of it, so a local
/// `tcab seed` and a run the driver executes refuse the same pairing with the same
/// words — and so the *version* half of the gate (a case's declared
/// `[[engine]]` range against the version the host package store holds) applies
/// here too, without this module having to know it exists.
pub fn resolve_for_case(slug: &str, test_case: &TestCaseVersion) -> Result<ResolvedEngine> {
    let engine =
        test_cabinet_driver::engine::built_in_catalog().resolve(&EngineSelection::new(slug))?;
    ensure_engine_supported(test_case, &engine)?;
    Ok(engine)
}

#[cfg(test)]
#[path = "engine_selection.test.rs"]
mod tests;
