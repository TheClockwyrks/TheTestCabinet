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

/// The result of regenerating and scoring an asset-generation run.
///
/// An asset-generation run's authoritative output is its recorded action log; the
/// validator replays it through the same drawing logic the binary used (see
/// `crate::validator::AssetGenValidator`) to produce the **regenerated** image,
/// which is the scored output. Two signals come out of it, both recorded rather
/// than gated (the same stance as end-to-end [checks](CheckResult)): the
/// [fidelity](Self::target_fidelity) of the regenerated image against the seeded
/// target, and the [divergence](Self::cheat_divergence) between the regenerated
/// image and the pixels the model left on disk — a high divergence means the
/// model drew outside the tool. Present only on an asset-generation run's
/// [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetGenResult {
    /// Run-root-relative path to the image regenerated from the action log — the
    /// scored output of the run.
    pub regenerated_image: String,
    /// Run-root-relative path to the pixels the model left on disk (the tool's
    /// `preview`), kept for the side-by-side comparison and the divergence signal.
    pub preview_image: String,
    /// Run-root-relative path to the seeded target the regenerated image is scored
    /// against.
    pub target_image: String,
    /// Run-root-relative path to the recorded action log.
    pub actions_log: String,
    /// How many operations the log recorded.
    pub operation_count: usize,
    /// Similarity of the regenerated image to the target, in `0.0..=1.0` (1.0 is
    /// identical). A recorded signal, not a pass/fail gate.
    pub target_fidelity: f64,
    /// Divergence between the regenerated image and the model's on-disk preview,
    /// in `0.0..=1.0` (0.0 is identical). High divergence flags drawing outside
    /// the tool. `None` when the model left no readable preview to compare.
    #[serde(default)]
    pub cheat_divergence: Option<f64>,
    /// Detail about anything that could not be evaluated (for example an action
    /// log that named operations but produced no preview to compare).
    #[serde(default)]
    pub detail: Option<String>,
}

/// Which side a match outcome is reported from, for an adversarial run.
///
/// The validator always runs the submission as Red against the committed baseline
/// opponent as Blue (lead decision 4), so [`AdversarialResult::outcome`] is from
/// the submission's perspective and this records that the submission was Red.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdversarialTeam {
    /// The west colony — the submission, in the canonical match.
    Red,
    /// The east colony — the baseline opponent, in the canonical match.
    Blue,
}

/// The outcome of an adversarial run's canonical match, from the **submission's**
/// perspective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdversarialOutcome {
    /// The submission won the match.
    Win,
    /// The submission lost the match.
    Loss,
    /// The match was a draw.
    Draw,
    /// The submission forfeited (it failed to build, did not export the contract
    /// entry, trapped, exhausted its fuel/memory, or returned an invalid action).
    Forfeit,
}

/// The result of scoring an adversarial run's single canonical match.
///
/// An adversarial run's authoritative output is its compiled wasm controller. The
/// validator (see `crate::adversarial_validator::AdversarialValidator`) loads it
/// as Red, loads the case's committed baseline opponent as Blue, runs **one**
/// match through the shared [Foray host](foray_host), writes the published
/// `replay.json` into the run's asset directory, and records the result here. A
/// submission that fails to build, does not export the entry, or forfeits is
/// recorded as a loss/forfeit — never a crash. Present only on an adversarial
/// run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdversarialResult {
    /// Run-root-relative path to the published, browser-playable replay — the
    /// scored artifact of the run.
    pub replay_json: String,
    /// The id of the baseline opponent the submission was matched against (Blue).
    pub opponent: String,
    /// Which side the submission played (always [`AdversarialTeam::Red`] for the
    /// canonical match; recorded so a consumer never has to assume it).
    pub submission_team: AdversarialTeam,
    /// The winning side, or `None` for a draw. `red` is the submission.
    pub winner: Option<AdversarialTeam>,
    /// The submission's (Red's) banked score at the end of the match.
    pub red_score: u32,
    /// The opponent's (Blue's) banked score at the end of the match.
    pub blue_score: u32,
    /// How the match ended (the replay's `ended`: `swept`, `time_limit`, or
    /// `forfeit`).
    pub ended: String,
    /// How many ticks the match ran for.
    pub ticks: u32,
    /// The outcome from the submission's perspective.
    pub outcome: AdversarialOutcome,
    /// Detail about a submission that could not be matched (for example a missing
    /// or unloadable module), or `None` when the match ran.
    #[serde(default)]
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
    /// The regenerate-and-score result of an asset-generation run. `None` for an
    /// end-to-end run, so an end-to-end summary serializes with no new field at
    /// all and its shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<AssetGenResult>,
    /// The canonical-match result of an adversarial run. `None` for any other
    /// type, so a non-adversarial summary serializes with no new field at all and
    /// its shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adversarial: Option<AdversarialResult>,
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
