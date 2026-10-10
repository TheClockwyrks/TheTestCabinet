//! Validation: an automated first pass over a finished implementation.
//!
//! See `docs/validation.md`. Validation catches gross failures cheaply and, for
//! the checks a test case opts into, compares the implementation against the
//! reference baselines those checks name. It is **not** a pass/fail gate.
//!
//! The summary a validator produces is part of the run record, so its shapes live
//! in `test_cabinet_contracts::validation` and are re-exported here at their old
//! paths; the [`Validator`] seam, which runs against a collected run, is this
//! module's.

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{ProofFile, TestCaseVersion, Variant};

pub use test_cabinet_contracts::validation::*;

/// Runs validation over a produced implementation.
pub trait Validator {
    /// Build, serve, and load-check the implementation, then run each declared
    /// check against the rendered reference baselines and summarize the result.
    ///
    /// `references` are the screenshots rendered from the test case's reference
    /// mockups (see [`crate::reference::ReferenceRenderer`]); a check's baseline
    /// is looked up here by its reference view. `proofs` are the proof-of-
    /// implementation artifacts requested for the selected variant (see
    /// [`TestCaseVersion::proofs_for`]); each is recorded present or missing.
    /// `variant` is the selected variant: most validators ignore it, but a voxel
    /// case reads the effective bounding volume for the run through it (see
    /// [`TestCaseVersion::voxel_for`]) so a half/double run is scored against the
    /// size it was actually given, not the case's base volume.
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary>;
}
