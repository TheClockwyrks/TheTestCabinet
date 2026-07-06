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
use crate::test_case::{MediaKind, ModelSpec, NineSlice, ProofFile, SheetSpec, TestCaseVersion};

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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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

/// The result of regenerating an asset-generation run.
///
/// An asset-generation run's authoritative output is its recorded action log(s);
/// the validator replays each through the same drawing logic the binary used (see
/// `crate::validator::AssetGenValidator`) to produce the **regenerated** image(s),
/// which are the output a human reviews against the brief. A single sprite
/// produces one [frame](AssetFrameResult); a sprite sheet produces one per
/// declared frame, each its own separate file. There is no target image and no
/// automated fidelity score. Present only on an asset-generation run's
/// [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AssetGenResult {
    /// The per-frame results: exactly one for a single sprite (frame index 0), one
    /// per declared frame for a sprite sheet, in declared order.
    pub frames: Vec<AssetFrameResult>,
    /// The sprite-sheet frame dimensions and named sequences, when the case draws a
    /// sprite sheet (`asset_kind = "sprite-sheet"`). Carried into the run record so
    /// the review UI can play the named animations from the per-frame images,
    /// without a separate catalog lookup. `None` for a single-sprite case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub sheet: Option<SheetSpec>,
    /// Detail about anything that could not be evaluated at the run level, or
    /// `None`. Per-frame detail lives on each [`AssetFrameResult`].
    #[serde(default)]
    pub detail: Option<String>,
}

/// The regenerate result for one frame of an asset-generation run.
///
/// For a single sprite this is the whole run's one frame (index 0); for a sprite
/// sheet there is one per declared frame, each a completely separate file. One
/// signal comes out of each, recorded rather than gated (the same stance as
/// end-to-end [checks](CheckResult)): the [divergence](Self::cheat_divergence)
/// between the regenerated image and the pixels the model left on disk — a high
/// divergence means the model drew outside the tool. There is no target image and
/// no fidelity score; the regenerated image is reviewed against the brief.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AssetFrameResult {
    /// The frame index this result records under: `0` for a single sprite, the
    /// declared `[[sheet.frame]]` index for a sprite sheet.
    pub index: u32,
    /// Run-root-relative path to the image regenerated from this frame's action
    /// log — the scored output for this frame.
    pub regenerated_image: String,
    /// Run-root-relative path to the pixels the model left on disk (this frame's
    /// `preview`), kept for the side-by-side comparison and the divergence signal.
    pub preview_image: String,
    /// Run-root-relative path to this frame's recorded action log.
    pub actions_log: String,
    /// How many operations this frame's log recorded.
    pub operation_count: usize,
    /// Divergence between the regenerated frame and the model's on-disk preview,
    /// in `0.0..=1.0` (0.0 is identical). High divergence flags drawing outside
    /// the tool. `None` when the model left no readable preview to compare.
    #[serde(default)]
    pub cheat_divergence: Option<f64>,
    /// Detail about anything that could not be evaluated for this frame.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The regenerate result of a voxel asset-generation run — the 3D analog of
/// [`AssetGenResult`].
///
/// A static model ([`crate::test_case::AssetKind::VoxelModel`]) produces one
/// [part](VoxelPartResult) (the whole model); an animated model
/// ([`crate::test_case::AssetKind::VoxelAnimation`]) produces one per declared
/// part. There is no target model and no automated fidelity score; the regenerated
/// model is reviewed against the brief. Present only on a voxel run's
/// [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VoxelGenResult {
    /// The per-part results: exactly one for a static model (named `model`), one per
    /// declared part for an animated model, in declared order.
    pub parts: Vec<VoxelPartResult>,
    /// The **required** rig (parts + joints) the case declared, for an animated
    /// model. The stable, game-facing joint interface reviewers score against.
    /// `None` for a static model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model: Option<ModelSpec>,
    /// The **full** rig the model actually produced (`rig.json`) — the required
    /// parts and joints plus any the model added of its own. This is what the
    /// viewer poses and a consuming game drives. `None` for a static model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub rig: Option<ModelSpec>,
    /// Whether this is a **skinned** run (`mc-skinned`/`sn-skinned`/`dc-skinned`):
    /// one continuous mesh bound to the rig and deformed by linear-blend skinning,
    /// rather than the rigid per-part posing of the other voxel-family kinds. The
    /// marker tells the 3D viewer to skin the single mesh rather than pose per-part
    /// meshes. `false` for every non-skinned voxel-family run.
    #[serde(default)]
    pub skinned: bool,
    /// Detail about anything that could not be evaluated at the run level, or
    /// `None`. Per-part detail lives on each [`VoxelPartResult`].
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result of a `ui` asset-generation run — the emitted flattened
/// PNG(s) plus the parsed `ui.json`. A `ui` run is **not** regenerated: its output
/// is the image data the `paint`/`ui` binaries emit, which the validator decodes and
/// well-formedness-checks. Present only on a `ui` run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct UiGenResult {
    /// The per-element results: one for a single-image case, one per declared
    /// element for a kit, in declared order.
    pub elements: Vec<UiElementResult>,
    /// Detail about anything that could not be evaluated at the run level (for
    /// example a missing or malformed `ui.json`), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result for one element of a `ui` run: its emitted flattened PNG,
/// its decoded dimensions, and any authored nine-slice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct UiElementResult {
    /// The element name this result records under (`canvas` for a single-image case,
    /// the declared `[[ui.element]]` name for a kit).
    pub name: String,
    /// Run-root-relative path to this element's emitted flattened RGBA PNG — the
    /// reviewed image.
    pub image: String,
    /// The decoded pixel width of the emitted PNG.
    pub width: u32,
    /// The decoded pixel height of the emitted PNG.
    pub height: u32,
    /// The nine-slice insets carried in `ui.json`, when the model authored them.
    /// `None` when the element declares no stretchable region.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub nine_slice: Option<NineSlice>,
    /// Detail about anything that could not be evaluated for this element (a missing
    /// PNG, a size mismatch, an out-of-bounds nine-slice), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result of a `material` asset-generation run — the emitted per-map
/// PNGs plus the parsed `material.json`. Like `ui`, a `material` run is **not**
/// regenerated: the validator decodes each declared map and parses `material.json`.
/// Present only on a `material` run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct MaterialGenResult {
    /// The per-map results, in declared order. Always includes `base-color`.
    pub maps: Vec<MaterialMapResult>,
    /// The maps' square resolution in pixels (the declared `[material].size`).
    pub size: u32,
    /// The suggested world-space tiling scale carried in `material.json`, when
    /// present. `None` when `material.json` declares none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tiling: Option<f64>,
    /// Detail about anything that could not be evaluated at the run level (a missing
    /// or malformed `material.json`, an absent `base-color`), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result for one map channel of a `material` run: its emitted PNG
/// and the color space it is tagged with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct MaterialMapResult {
    /// The map channel this result records under (`base-color`, `normal`, …).
    pub name: String,
    /// Run-root-relative path to this map's emitted PNG.
    pub image: String,
    /// The color space this map is tagged with in `material.json` (`srgb` for
    /// `base-color`/`emissive`, `linear` for the data maps).
    pub color_space: String,
    /// Detail about anything that could not be evaluated for this map (a missing PNG,
    /// a size mismatch), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result of a particle asset-generation run — the parsed
/// `system.json` (the authored emitter/force/curve definition) and the rendered
/// preview. A particle run is **not** regenerated and there is no bake: the validator
/// parses `system.json`, confirms it is well-formed and non-empty (it actually emits
/// particles), and takes the preview as the reviewer sees it. Present only on a
/// particle run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ParticleGenResult {
    /// Run-root-relative path to the emitted `system.json` — the authored definition
    /// every consumer simulates live.
    pub system: String,
    /// Run-root-relative path to the rendered preview animation (`effect.gif`) the
    /// reviewer plays, or `None` when the model rendered none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preview: Option<String>,
    /// How many emitters the authored system declares.
    pub emitter_count: usize,
    /// Detail about anything that could not be evaluated (a missing or malformed
    /// `system.json`, or a system that emits nothing), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation result of an audio asset-generation run — the decoded PCM
/// `clip.wav` (and, for `music`, the portable `clip.mid`). The validator decodes the
/// `.wav`, confirms it is well-formed, within the `[audio]` format, no longer than
/// the cap, and not silent. Present only on an audio run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AudioGenResult {
    /// Run-root-relative path to the emitted PCM `clip.wav` — the clip a game plays
    /// and the reviewer hears.
    pub clip: String,
    /// Run-root-relative path to the portable `clip.mid` score, for a `music` run.
    /// `None` for the two SFX kinds (and when a `music` run emitted none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub midi: Option<String>,
    /// Run-root-relative path to the rendered waveform/spectrogram preview PNG, or
    /// `None` when the model rendered none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preview: Option<String>,
    /// The decoded sample rate in Hz.
    pub sample_rate: u32,
    /// The decoded channel count (1 = mono, 2 = stereo).
    pub channels: u32,
    /// The decoded clip length in milliseconds.
    pub duration_ms: u32,
    /// Detail about anything that could not be evaluated (a missing or malformed
    /// `.wav`, a format mismatch, an over-cap or silent clip), or `None`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The regenerate result for one part of a voxel-generation run.
///
/// For a static model this is the whole model's one part; for an animated model
/// there is one per declared part. Cheat detection is retired for the voxel family:
/// the scored artifact is the emitted geometry (the `PartMesh`-shaped `.glb`
/// every voxel-family binary emits) plus reviewer judgment of the model's own
/// rendered preview, so — unlike the sprite [`AssetFrameResult`] — a voxel part
/// carries no regenerated image and no cheat divergence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VoxelPartResult {
    /// The part name this result records under: `model` for a static model, the
    /// declared `[[model.part]]` name for an animated model.
    pub name: String,
    /// Run-root-relative path to the `PartMesh`-shaped `.glb` this part's binary
    /// emitted — **what the client renders in 3D** for every voxel-family kind (both
    /// the cube kinds and the six surface-meshed kinds emit it). `mesh.glb` for a
    /// static kind, `meshes/<part>.glb` per part for an animated one.
    pub mesh: String,
    /// Run-root-relative path to the isometric PNG the model rendered for this part
    /// (its `preview`) — the reviewed image for this part.
    pub preview_image: String,
    /// Run-root-relative path to this part's recorded operation log.
    pub ops_log: String,
    /// How many operations this part's log recorded.
    pub operation_count: usize,
    /// How many occupied voxels the regenerated part contains.
    pub voxel_count: usize,
    /// Detail about anything that could not be evaluated for this part.
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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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

/// One auto-generated proof replay: the submission played head-to-head against a
/// single reference opponent. A finished adversarial run records one of these per
/// opponent in [`AdversarialResult::replays`] — programmatic, reproducible
/// evidence the implementation actually plays, which is what *replaces*
/// proof-of-implementation for adversarial cases.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AdversarialReplay {
    /// The id of the opponent the submission was matched against (Blue).
    pub opponent: String,
    /// Run-root-relative path to the published, browser-playable replay.
    pub replay_json: String,
    /// The winning side, or `None` for a draw. `red` is the submission.
    pub winner: Option<AdversarialTeam>,
    /// The submission's (Red's) banked score at the end of the match.
    pub red_score: u32,
    /// The opponent's (Blue's) banked score at the end of the match.
    pub blue_score: u32,
    /// How the match ended (`swept`, `time_limit`, or `forfeit`).
    pub ended: String,
    /// How many ticks the match ran for.
    pub ticks: u32,
    /// The outcome from the submission's perspective.
    pub outcome: AdversarialOutcome,
    /// Whether this match's outcome counts as recorded evidence. `false` for an
    /// exhibition opponent (e.g. `random`, a trivial bar): its replay is kept so a
    /// reviewer can watch it, but the outcome is informational only.
    pub scored: bool,
}

/// The result of scoring an adversarial run.
///
/// An adversarial run's authoritative output is its compiled wasm controller. The
/// validator (see `crate::adversarial_validator::AdversarialValidator`) loads it
/// as Red and plays it against the case's committed reference opponents (Blue),
/// each through the shared [Foray host](foray_host), writing one published replay
/// per opponent into the run's asset directory (see [`Self::replays`]). The
/// top-level fields mirror the **canonical** opponent's match (`border-soldier`),
/// which scoring and the leaderboard read. A submission that fails to build, does
/// not export the entry, or forfeits is recorded as a loss/forfeit — never a
/// crash. Present only on an adversarial run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AdversarialResult {
    /// Run-root-relative path to the canonical published replay (`replay.json`) —
    /// the scored artifact mirrored by the top-level fields below. Also the first
    /// entry of [`Self::replays`].
    pub replay_json: String,
    /// The id of the canonical opponent the submission was scored against (Blue).
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
    /// Run-root-relative path to the produced controller wasm module (the case's
    /// `build.module`), or empty when the build emitted none. Lets the push flow
    /// upload the controller to the backend (so a pushed run is selectable in the
    /// arena) without re-resolving the case manifest.
    #[serde(default)]
    pub controller_module: String,
    /// One proof replay per reference opponent the run was auto-replayed against
    /// (canonical opponent first). These are the run's evidence of play. Empty
    /// only when the submission never presented a loadable controller (a forfeit
    /// before any match could run).
    #[serde(default)]
    pub replays: Vec<AdversarialReplay>,
}

/// The result of scoring a performance run.
///
/// A performance run's authoritative output is its compiled wasm engine. The
/// validator (see `crate::performance_validator::PerformanceValidator`) loads it,
/// runs it once per held-out input case through the shared [Lattice
/// host](lattice_host) under the manifest's per-case fuel/memory limits, and
/// checks each case's output against the reference oracle. A run is **correct**
/// only when every case is, and its [`total_fuel`](Self::total_fuel) — the fuel a
/// correct engine consumes — is the comparable performance result. A built-but-
/// wrong engine still loaded (it presented an engine); its correctness gate lives
/// here, mirroring how an adversarial run records its outcome separately from the
/// load signal. Present only on a performance run's [`ValidationSummary`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PerformanceResult {
    /// Whether **every** scored input case produced the oracle's exact answer.
    pub correct: bool,
    /// The total fuel consumed across all cases — the comparable performance
    /// result. `Some` only when [`Self::correct`]; `None` for an incorrect run,
    /// where the fuel is meaningless.
    pub total_fuel: Option<u64>,
    /// The per-case results, in the case's declared order.
    pub cases: Vec<PerformanceCaseResult>,
    /// Detail about a run that could not be scored at all (for example a missing or
    /// unloadable module), or `None` when every case ran.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The result of scoring one held-out input case of a performance run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PerformanceCaseResult {
    /// The case-relative path of the input instance this result records under, so a
    /// reviewer can tie the result back to its case.
    pub input: String,
    /// Whether the engine produced the oracle's exact answer for this case.
    pub correct: bool,
    /// The fuel the engine consumed on this case. `Some` whenever the engine ran
    /// (recorded for diagnostics even when incorrect); `None` when the engine could
    /// not be run on this case at all (a host failure).
    pub fuel: Option<u64>,
    /// The tick of the first snapshot whose answer diverged from the oracle, when
    /// the engine is incorrect for that reason. `None` when correct, or when the
    /// failure was structural rather than a checksum mismatch.
    pub first_mismatch_tick: Option<u64>,
    /// Detail about an incorrect or unrunnable case, or `None` when correct.
    #[serde(default)]
    pub detail: Option<String>,
}

/// The validation summary embedded in a [`crate::run_record::RunRecord`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "RunValidation"),
    schemars(rename = "RunValidation")
)]
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
    #[cfg_attr(feature = "contract", ts(optional))]
    pub asset: Option<AssetGenResult>,
    /// The regenerate result of a voxel asset-generation run — also carries the
    /// **skinned** kinds (with [`VoxelGenResult::skinned`] set). `None` for every
    /// other type (and for the 2D sprite kinds, which use [`Self::asset`]), so a
    /// non-voxel summary serializes with no new field at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub voxel: Option<VoxelGenResult>,
    /// The validation result of a `ui` asset-generation run. `None` for every other
    /// kind/type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub ui: Option<UiGenResult>,
    /// The validation result of a `material` asset-generation run. `None` for every
    /// other kind/type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub material: Option<MaterialGenResult>,
    /// The validation result of a particle asset-generation run. `None` for every
    /// other kind/type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub particle: Option<ParticleGenResult>,
    /// The validation result of an audio asset-generation run. `None` for every
    /// other kind/type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub audio: Option<AudioGenResult>,
    /// The canonical-match result of an adversarial run. `None` for any other
    /// type, so a non-adversarial summary serializes with no new field at all and
    /// its shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub adversarial: Option<AdversarialResult>,
    /// The correctness-and-fuel result of a performance run. `None` for any other
    /// type, so a non-performance summary serializes with no new field at all and
    /// its shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub performance: Option<PerformanceResult>,
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
