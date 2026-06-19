//! Validation: an automated first pass over a finished implementation.
//!
//! See `docs/validation.md`. Validation catches gross failures cheaply and, for
//! the checks a test case opts into, compares the implementation against the
//! reference baselines those checks name. It is **not** a pass/fail gate.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{MediaKind, ProofFile, TestCaseVersion};

/// A screenshot captured from the implementation during validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedView {
    /// The view this screenshot corresponds to (matches a declared check).
    pub view: String,
    /// Path to the captured screenshot on the host.
    pub image_path: PathBuf,
}

/// The outcome of a single **required** build step — dependency install or the
/// static build — that every run performs before the load check.
///
/// Building an implementation is not a single opaque step: the install and the
/// build each run a manifest-declared command and each can fail on its own, so
/// each is reported in the [`ValidationSummary`] in its own right rather than
/// being folded silently into the load signal. See `docs/validation.md`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    /// The command that was run (the manifest's `install` or `build` command).
    pub command: String,
    /// Whether the command exited successfully.
    pub succeeded: bool,
    /// Detail about a failure (a tail of the command's stderr), or `None` when
    /// the step succeeded.
    pub detail: Option<String>,
}

/// The result of a single opt-in validation check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// The view the check records under.
    pub view: String,
    /// Human-readable display name for the check, carried through from the
    /// declared [`Check`](crate::test_case::Check).
    pub name: String,
    /// Whether the check could drive the implementation into the view and
    /// capture it for comparison. When false, [`Self::similarity`] is `0.0` and
    /// [`Self::detail`] explains why.
    pub reached: bool,
    /// Similarity signal in the range `0.0..=1.0` against the reference
    /// baseline. This is a signal, not a strict match requirement.
    pub similarity: f64,
    /// Detail about a check that could not be completed.
    pub detail: Option<String>,
}

/// The presence result for a single declared proof-of-implementation artifact.
///
/// A test case can ask the agent to write evidence (a screenshot or short clip)
/// to a known path; validation records whether each declared proof turned up in
/// the produced tree. This is **informational** — a missing proof never gates the
/// run's status; it is surfaced so a reviewer sees the gap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofResult {
    /// The proof id this result records under (matches a declared
    /// [`ProofFile`](crate::test_case::ProofFile)).
    pub id: String,
    /// Human-readable display name, carried through from the declared proof.
    pub name: String,
    /// Whether the proof media is an image or a video.
    pub kind: MediaKind,
    /// The run-root-relative path the proof was expected at, carried through from
    /// the declared proof. Locates the produced file for publishing and tells a UI
    /// where it lives.
    pub dest: String,
    /// Whether the agent produced the proof at its declared `dest`.
    pub present: bool,
    /// Detail about a missing or unreadable proof, or `None` when present.
    pub detail: Option<String>,
}

/// The validation summary embedded in a [`crate::run_record::RunRecord`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    /// Whether the implementation built, served, and rendered without a fatal
    /// error. This is the clearest possible signal about a run.
    pub loaded: bool,
    /// Detail about a fatal load failure (build failure, uncaught runtime error,
    /// or a missing browser that prevented capture).
    pub detail: Option<String>,
    /// Outcome of the required dependency-install step, or `None` if the build
    /// never reached it (for example, no `package.json` was found).
    #[serde(default)]
    pub install: Option<StepResult>,
    /// Outcome of the required static-build step, or `None` if it was never
    /// reached (the install failed, or there was no `package.json`).
    #[serde(default)]
    pub build: Option<StepResult>,
    /// Per-check results for the validation checks the test case declares.
    pub checks: Vec<CheckResult>,
    /// Per-proof presence results for the proof-of-implementation artifacts the
    /// test case requests. Empty when the case declares none. Informational: a
    /// missing proof does not change [`Self::loaded`].
    #[serde(default)]
    pub proofs: Vec<ProofResult>,
}

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
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary>;
}
