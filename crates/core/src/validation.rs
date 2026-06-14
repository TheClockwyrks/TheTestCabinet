//! Validation: an automated first pass over a finished implementation.
//!
//! See `docs/validation.md`. Validation catches gross failures cheaply and,
//! where a test case calls for it, compares an implementation against the
//! reference visuals it was given. It is **not** a pass/fail gate.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::test_case::TestCaseVersion;

/// Outcome of the load check: building, serving, and loading the implementation
/// in a headless browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadCheck {
    /// Whether the implementation built, served, and rendered without a fatal
    /// error. This is the clearest possible signal about a run.
    pub loaded: bool,
    /// Detail about any fatal error (build failure, uncaught runtime error).
    pub detail: Option<String>,
    /// Screenshots captured of the loaded application, keyed by view name.
    pub screenshots: Vec<CapturedView>,
}

/// A screenshot captured during the load check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedView {
    /// The view this screenshot corresponds to (matches a declared reference
    /// view, when one exists).
    pub view: String,
    /// Path to the captured screenshot on the host.
    pub image_path: PathBuf,
}

/// A similarity signal comparing a captured view against its reference visual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceComparison {
    /// The view that was compared.
    pub view: String,
    /// Similarity signal in the range `0.0..=1.0`. This is a signal, not a
    /// strict match requirement.
    pub similarity: f64,
}

/// The validation summary embedded in a [`crate::run_record::RunRecord`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    /// Whether the implementation loaded at all.
    pub loaded: bool,
    /// Per-view similarity signals against any declared reference views.
    pub reference_comparisons: Vec<ReferenceComparison>,
}

/// Runs validation over a produced implementation.
pub trait Validator {
    /// Build, serve, and load the implementation in a headless browser,
    /// capturing screenshots and detecting fatal errors.
    fn load_check(&self, artifacts: &ArtifactCollection) -> Result<LoadCheck>;

    /// Compare captured views against the reference visuals declared by the test
    /// case version, producing similarity signals.
    fn compare_references(
        &self,
        test_case: &TestCaseVersion,
        load_check: &LoadCheck,
    ) -> Result<Vec<ReferenceComparison>>;

    /// Run the full validation pass and summarize it for the run record.
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
    ) -> Result<ValidationSummary> {
        let load_check = self.load_check(artifacts)?;
        let reference_comparisons = self.compare_references(test_case, &load_check)?;
        Ok(ValidationSummary {
            loaded: load_check.loaded,
            reference_comparisons,
        })
    }
}
