//! Concrete [`Validator`].
//!
//! See `docs/validation.md`. This performs the cheap first pass: it installs and
//! builds the produced implementation as a static site, serves it, and — for the
//! checks a test case opts into — drives the served build into each view with a
//! headless browser, screenshots it, and scores its similarity against the
//! rendered reference baseline. It is a signal, not a pass/fail gate, so a
//! missing browser degrades to a build-only signal rather than failing the run.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::adversarial_validator::AdversarialValidator;
use crate::browser::{self, ScriptOutputSpec, StaticServer};
use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::performance_validator::PerformanceValidator;
use crate::reference::RenderedReference;
use crate::test_case::{
    AnimationSpec, AnimationTrackSpec, AssetKind, AxisSpec, DriveKindSpec, InterpSpec,
    JointKindSpec, JointSpec, KeyframeSpec, MediaKind, ModelSpec, NineSlice, PartSpec, ProofFile,
    ReviewItem, ReviewValidation, TestCaseVersion, TestType, Variant,
};
use crate::validation::{
    Assertion, AssetFrameResult, AssetGenResult, AudioGenResult, AutoVerdict, CheckResult,
    DebugScriptOutput, DebugScriptResult, MaterialGenResult, MaterialMapResult, ParticleGenResult,
    ProofResult, StepResult, UiElementResult, UiGenResult, ValidationSummary, Validator,
    VoxelGenResult, VoxelPartResult,
};

/// Candidate output directories a static build may produce.
const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// A validator that builds the implementation and load-checks it in a browser.
#[derive(Debug, Clone)]
pub struct BuildValidator {
    /// Base directory captured screenshots are written under. Each run's
    /// captures land in a fresh unique sub-directory of this, so concurrent runs
    /// never share a capture path.
    screenshot_dir: PathBuf,
}

impl BuildValidator {
    /// Write captured screenshots under `screenshot_dir`. Each call to
    /// [`validate`](Validator::validate) captures into its own unique
    /// sub-directory of it.
    pub fn new(screenshot_dir: impl Into<PathBuf>) -> Self {
        Self {
            screenshot_dir: screenshot_dir.into(),
        }
    }
}

impl Validator for BuildValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;

        // Proof presence is independent of whether the build succeeds — the agent
        // writes proofs into the working tree regardless — so it is recorded on
        // every path, including an early return for a build that never loads.
        let proof_results = proof_results(proofs, repo);

        // This validator builds a static site, which only an end-to-end case
        // declares; the orchestrator never routes another type here. Guard the
        // invariant rather than panicking so a misroute degrades to a clear failed
        // load instead of a crash.
        let Some(build_commands) = test_case.build.as_ref() else {
            return Ok(failed_load(
                "end-to-end validation requires a [build] table",
                None,
                None,
                proof_results,
            ));
        };

        if !repo.join("package.json").is_file() {
            return Ok(failed_load(
                "no package.json found in the produced implementation",
                None,
                None,
                proof_results,
            ));
        }

        // The two required build steps run in order and are each reported in the
        // summary. Install runs first; if it fails the build step is never
        // reached, so it stays `None`.
        let install = run_step(repo, &build_commands.install);
        if !install.succeeded {
            let detail = install.detail.clone().unwrap_or_default();
            return Ok(failed_load(&detail, Some(install), None, proof_results));
        }
        let build = run_step(repo, &build_commands.build);
        if !build.succeeded {
            let detail = build.detail.clone().unwrap_or_default();
            return Ok(failed_load(
                &detail,
                Some(install),
                Some(build),
                proof_results,
            ));
        }

        let Some(output_dir) = BUILD_OUTPUTS
            .iter()
            .map(|d| repo.join(d))
            .find(|p| p.is_dir())
        else {
            return Ok(failed_load(
                "build produced no dist/build/out directory",
                Some(install),
                Some(build),
                proof_results,
            ));
        };

        // The build succeeded and produced output: the load signal is positive.
        // Running the declared checks is best-effort on top of that.
        let (checks, detail) = self.run_checks(test_case, &output_dir, references);
        // Drive the case's debug scripts (if any) against the served build to
        // decide the objective review items and synthesize their proof media. A
        // failed script gates the run (see `ValidationSummary::debug_api_failed`),
        // decided downstream in `completed_state`; here we only record the results.
        let debug_scripts = self.run_debug_scripts(test_case, variant, repo, &output_dir);
        Ok(ValidationSummary {
            loaded: true,
            detail,
            install: Some(install),
            build: Some(build),
            checks,
            proofs: proof_results,
            debug_scripts,
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        })
    }
}

/// Record whether each requested proof-of-implementation artifact is present in
/// the produced tree. A proof counts as present when its `dest` exists and is a
/// non-empty file; an empty file is treated as missing, since a zero-byte capture
/// is never a usable proof.
pub(crate) fn proof_results(proofs: &[ProofFile], repo: &Path) -> Vec<ProofResult> {
    proofs
        .iter()
        .map(|proof| {
            let path = repo.join(&proof.dest);
            let (present, detail) = match std::fs::metadata(&path) {
                Ok(meta) if meta.is_file() && meta.len() > 0 => (true, None),
                Ok(meta) if meta.is_file() => {
                    (false, Some(format!("`{}` is empty", proof.dest.display())))
                }
                Ok(_) => (
                    false,
                    Some(format!("`{}` is not a file", proof.dest.display())),
                ),
                Err(_) => (
                    false,
                    Some(format!("`{}` was not produced", proof.dest.display())),
                ),
            };
            ProofResult {
                id: proof.id.clone(),
                name: proof.name.clone(),
                kind: proof.kind,
                dest: proof.dest.to_string_lossy().replace('\\', "/"),
                present,
                detail,
            }
        })
        .collect()
}

impl BuildValidator {
    /// Serve the build and run every declared check against it.
    ///
    /// Returns the per-check results and an optional summary-level detail (for
    /// example, that no browser was available to capture anything).
    fn run_checks(
        &self,
        test_case: &TestCaseVersion,
        output_dir: &Path,
        references: &[RenderedReference],
    ) -> (Vec<CheckResult>, Option<String>) {
        if test_case.checks.is_empty() {
            return (Vec::new(), None);
        }

        let server = match StaticServer::start(output_dir.to_path_buf()) {
            Ok(server) => server,
            Err(err) => {
                let detail = format!("could not serve the build for checks: {err}");
                return (unreached(test_case, &detail), Some(detail));
            }
        };
        let url = server.url();

        // Capture this run's screenshots into a fresh unique sub-directory.
        // Captures are written and then read back to score them, so two
        // concurrent runs that share a view slug (for example the same test case
        // run against two models) would otherwise write to — and read from — the
        // same `{view}.png` path and score against each other's screenshot.
        let captures = self.screenshot_dir.join(format!("run-{}", Uuid::new_v4()));

        let mut results = Vec::with_capacity(test_case.checks.len());
        for check in &test_case.checks {
            results.push(self.run_check(check, &url, &captures, references));
        }
        (results, None)
    }

    /// Drive one check and score it against its reference baseline, capturing its
    /// screenshot into `captures` (this run's private capture directory).
    fn run_check(
        &self,
        check: &crate::test_case::Check,
        url: &str,
        captures: &Path,
        references: &[RenderedReference],
    ) -> CheckResult {
        let Some(baseline) = references.iter().find(|r| r.view == check.reference_view) else {
            return CheckResult {
                view: check.view.clone(),
                name: check.name.clone(),
                reached: false,
                similarity: 0.0,
                detail: Some(format!(
                    "reference baseline `{}` was not rendered",
                    check.reference_view
                )),
            };
        };
        // A check scores a captured screenshot pixel-for-pixel against its
        // baseline, which only makes sense for an image baseline. A video
        // reference cannot be a check baseline, so flag the misconfiguration
        // rather than attempting to decode it as a PNG.
        if baseline.kind != MediaKind::Image {
            return CheckResult {
                view: check.view.clone(),
                name: check.name.clone(),
                reached: false,
                similarity: 0.0,
                detail: Some(format!(
                    "reference baseline `{}` is not an image and cannot be scored",
                    check.reference_view
                )),
            };
        }

        let capture = captures.join(format!("{}.png", check.view));
        if let Err(detail) = browser::capture(url, &check.actions, &capture) {
            return CheckResult {
                view: check.view.clone(),
                name: check.name.clone(),
                reached: false,
                similarity: 0.0,
                detail: Some(detail),
            };
        }

        match score(&baseline.media_path, &capture) {
            Ok(similarity) => CheckResult {
                view: check.view.clone(),
                name: check.name.clone(),
                reached: true,
                similarity,
                detail: None,
            },
            Err(detail) => CheckResult {
                view: check.view.clone(),
                name: check.name.clone(),
                reached: false,
                similarity: 0.0,
                detail: Some(detail),
            },
        }
    }

    /// Drive the case's per-item debug scripts against the served build to decide
    /// the objective review items and synthesize their *actual* proof media.
    ///
    /// For each review item that declares a `validation` script, this drives the
    /// model's build through the script against the case's
    /// [instrumentation](crate::test_case::Instrumentation) handle, capturing the
    /// declared media into the collected tree under `.tcab/validation/` and reading
    /// back the auto verdicts. A script that could be run but did not complete
    /// against a conformant build is recorded with `ran = false`, which
    /// [gates](ValidationSummary::debug_api_failed) the run. Returns an empty vec —
    /// no gate — when the case declares no instrumentation, no scripted items, or
    /// the host has no browser to drive with (the same degrade-don't-fail stance the
    /// [checks](Self::run_checks) take).
    ///
    /// Only the *actual* media (from the model's build) is produced here. The
    /// *baseline* media (from the reference implementation) is a fixed property of
    /// the case version, synthesized once at publish-reference time (see
    /// [`capture_baseline_media`]) and served case-scoped — never re-driven per run.
    fn run_debug_scripts(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        repo: &Path,
        output_dir: &Path,
    ) -> Vec<DebugScriptResult> {
        // Serve the model's build. A serve failure is an infra fault, not the
        // model's — degrade the whole stage rather than gate.
        let Ok(server) = StaticServer::start(output_dir.to_path_buf()) else {
            return Vec::new();
        };
        let media_dir = repo.join(VALIDATION_MEDIA_DIR);

        // Drive the case's scripted items against the served build, capturing the
        // *actual* media into the run's `.tcab/validation/` tree. `None` means there
        // is nothing to do (no scripted items) or nothing can be done (no browser) —
        // either way no results and no gate.
        let Some(drives) = drive_scripted_items(test_case, variant, &server.url(), &media_dir)
        else {
            return Vec::new();
        };

        drives
            .into_iter()
            .map(|drive| DebugScriptResult {
                item_id: drive.item_id,
                sub_item_id: drive.sub_item_id,
                title: drive.title,
                category_title: drive.category_title,
                script: drive.script_rel,
                ran: drive.ran,
                detail: drive.detail,
                verdicts: drive
                    .verdicts
                    .into_iter()
                    .map(|verdict| AutoVerdict {
                        id: verdict.id,
                        pass: verdict.pass,
                        assertions: verdict
                            .assertions
                            .into_iter()
                            .map(|a| Assertion {
                                label: a.label,
                                pass: a.pass,
                                expected: a.expected,
                                actual: a.actual,
                            })
                            .collect(),
                    })
                    .collect(),
                outputs: drive
                    .outputs
                    .into_iter()
                    .map(|output| DebugScriptOutput {
                        id: output.id,
                        name: output.name,
                        kind: output.kind,
                        actual_present: output.present,
                    })
                    .collect(),
            })
            .collect()
    }
}

/// One scripted verdict unit driven against a served build: its identity, whether the
/// debug script ran clean against a conformant build, the auto verdicts it decided,
/// and the presence of each declared media output. A unit is a whole review item
/// (validated as a whole) or one of its sub-items. The output media files themselves
/// are written into the caller's media directory under their flat
/// [`validation_media_name`], keyed by the unit's verdict id.
#[derive(Debug, Clone)]
pub struct ScriptedItemDrive {
    /// The backing review item's id.
    pub item_id: String,
    /// The backing sub-item's id when this unit is a sub-item, or `None` when the whole
    /// item is validated. Together with [`Self::item_id`] it forms the verdict id
    /// (`<item>.<sub>` or `<item>`) that keys the auto verdict and the media.
    pub sub_item_id: Option<String>,
    /// The verdict unit's own title, for display — the sub-item's title for a
    /// per-sub-item driver (the category groups them), or the item's title when the
    /// whole item is validated. Carries no category prefix.
    pub title: String,
    /// The backing category/item's title, for grouping the unit under its category in
    /// the reviewer UI. Equal to [`Self::title`] for a whole-item driver.
    pub category_title: String,
    /// The version-folder-relative script path that was run.
    pub script_rel: String,
    /// Whether the script executed to completion against a conformant build.
    pub ran: bool,
    /// Detail about a failed or degraded drive, or `None` when it ran clean.
    pub detail: Option<String>,
    /// The auto verdicts the script decided.
    pub verdicts: Vec<crate::browser::ScriptVerdict>,
    /// Per declared output: its metadata and whether the drive captured it.
    pub outputs: Vec<ScriptedOutput>,
}

/// One declared media output of a [`ScriptedItemDrive`], with whether the drive
/// captured it into the media directory (at its [`validation_media_name`]).
#[derive(Debug, Clone)]
pub struct ScriptedOutput {
    /// The output id — the media file's stem.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Whether this output is an image or a video clip.
    pub kind: MediaKind,
    /// Whether the driven build produced this output (the file now exists under the
    /// media directory at its [`validation_media_name`]).
    pub present: bool,
}

/// One scripted verdict unit to drive: a whole review item (validated as a whole) or
/// one of its sub-items, resolved to its verdict id, display title, and validation
/// driver. Borrows the driver from the caller's `review_items_for` list.
struct DriveUnit<'a> {
    item_id: String,
    sub_item_id: Option<String>,
    /// The verdict id (`<item>` or `<item>.<sub>`) that keys the auto verdict and media.
    verdict_id: String,
    /// The unit's own display title (the sub-item's, or the item's), no category prefix.
    title: String,
    /// The backing category/item's title, for grouping under its category.
    category_title: String,
    validation: &'a ReviewValidation,
}

/// Drive every scripted verdict unit of `variant` against the served build at `url`,
/// capturing each declared media output into `media_dir` under its flat, addressable
/// `<verdict>__<output>.<ext>` name ([`validation_media_name`]).
///
/// A unit is a verdict-bearing point: a whole review item that carries validation (it
/// has no sub-items), or a sub-item that does. Each unit has its own script, its own
/// verdict, and its own proof media keyed by the verdict id, so a reviewer can verify
/// each sub-item independently.
///
/// This is the shared engine behind both automated-validation media flows: the
/// per-run [`BuildValidator`] drives the *model's* build to synthesize the *actual*
/// media, and `tcab publish-reference` drives the *reference implementation* once to
/// synthesize the case's *baseline* media (see [`capture_baseline_media`]). The two
/// differ only in which build is served and where the media lands; the drive itself
/// is identical.
///
/// Returns `None` — nothing to record, no gate — when the case declares no
/// [instrumentation](crate::test_case::Instrumentation), no scripted units, or the
/// host has no browser to drive with (the degrade-don't-fail stance the whole
/// validator takes). Otherwise returns one entry per scripted unit; a `ran = false`
/// entry records a debug-API contract failure the per-run path
/// [gates](crate::validation::ValidationSummary::debug_api_failed) on.
pub fn drive_scripted_items(
    test_case: &TestCaseVersion,
    variant: &Variant,
    url: &str,
    media_dir: &Path,
) -> Option<Vec<ScriptedItemDrive>> {
    let instrumentation = test_case.instrumentation.as_ref()?;
    let items = test_case.review_items_for(variant);
    // Flatten items into verdict units: an item validated as a whole contributes one
    // unit keyed by its own id; an item with sub-items contributes one unit per
    // validated sub-item keyed by `<item>.<sub>` (item-level validation and sub-items
    // are mutually exclusive, so at most one branch fires per item).
    let units: Vec<DriveUnit> = items
        .iter()
        .flat_map(|item| {
            let own = item.validation.as_ref().map(|validation| DriveUnit {
                item_id: item.id.clone(),
                sub_item_id: None,
                verdict_id: item.id.clone(),
                title: item.title.clone(),
                category_title: item.title.clone(),
                validation,
            });
            let subs = item.sub_items.iter().filter_map(|sub| {
                sub.validation.as_ref().map(|validation| DriveUnit {
                    item_id: item.id.clone(),
                    sub_item_id: Some(sub.id.clone()),
                    verdict_id: ReviewItem::sub_item_verdict_id(&item.id, &sub.id),
                    // The unit's own title is the sub-item's; the category (the item)
                    // groups the sub-items in the reviewer UI, so no prefix here.
                    title: sub.title.clone(),
                    category_title: item.title.clone(),
                    validation,
                })
            });
            own.into_iter().chain(subs)
        })
        .collect();
    if units.is_empty() {
        return None;
    }
    let handle = &instrumentation.handle;
    std::fs::create_dir_all(media_dir).ok()?;

    let mut results = Vec::with_capacity(units.len());
    for unit in units {
        let validation = unit.validation;
        let outputs_spec: Vec<ScriptOutputSpec> = validation
            .outputs
            .iter()
            .map(|output| ScriptOutputSpec {
                id: output.id.clone(),
                kind: media_kind_tag(output.kind).to_string(),
            })
            .collect();

        // Drive the build. An `Err` is an infra fault (no browser), which is
        // host-wide — degrade the entire stage rather than gate on the environment.
        let tmp = media_dir.join(format!(".drive-{}", unit.verdict_id));
        let drive =
            match browser::drive_script(url, &validation.script, handle, &tmp, &outputs_spec) {
                Ok(result) => result,
                Err(_) => return None,
            };

        // Relocate the captured media to their stable, addressable flat names (keyed by
        // the verdict id) and record whether each declared output was produced.
        let outputs = relocate_outputs(validation, &unit.verdict_id, media_dir, &tmp);
        let _ = std::fs::remove_dir_all(&tmp);

        results.push(ScriptedItemDrive {
            item_id: unit.item_id,
            sub_item_id: unit.sub_item_id,
            title: unit.title,
            category_title: unit.category_title,
            script_rel: validation.script_rel.clone(),
            ran: drive.ran,
            detail: drive.detail,
            verdicts: drive.verdicts,
            outputs,
        });
    }
    Some(results)
}

/// Synthesize a case variant's **baseline** validation media once, from its
/// reference implementation's already-built static site at `build_dir`, writing each
/// declared output into `baseline_dir` under its flat [`validation_media_name`].
///
/// This is the ingest-time counterpart to the per-run *actual* capture: the baseline
/// is a fixed property of the case *version* (the reference implementation does not
/// change per run), so it is generated exactly once — by `tcab publish-reference`,
/// which owns building the reference implementation — and committed under the version
/// folder, rather than re-driven on every run. Serves the build over an ephemeral
/// static server and delegates to [`drive_scripted_items`]; see there for the `None`
/// degrade cases.
pub fn capture_baseline_media(
    test_case: &TestCaseVersion,
    variant: &Variant,
    build_dir: &Path,
    baseline_dir: &Path,
) -> Option<Vec<ScriptedItemDrive>> {
    let server = StaticServer::start(build_dir.to_path_buf()).ok()?;
    drive_scripted_items(test_case, variant, &server.url(), baseline_dir)
}

/// The run-root-relative directory synthesized *actual* validation media is
/// collected under, so it travels with the published implementation and is served
/// by [`crate::playable::serve_validation_file`].
pub(crate) const VALIDATION_MEDIA_DIR: &str = ".tcab/validation";

/// The version-folder-relative directory a case's committed **baseline** validation
/// media lives under, one sub-directory per variant: `validation-baseline/<variant>/`.
/// Synthesized once at publish-reference time from the reference implementation and
/// committed beside the case, then served case-scoped by the backend — the invariant
/// counterpart to the per-run [`VALIDATION_MEDIA_DIR`] *actual* media.
pub const VALIDATION_BASELINE_DIR: &str = "validation-baseline";

/// The version-folder-relative directory a case's reporter-side automated-validation
/// debug scripts live under (`validation/<item>.mjs`, plus any shared modules those
/// scripts import — e.g. `validation/_helpers.mjs`). Reporter-side and **never**
/// seeded into the model's run container; the whole directory is materialized into a
/// backend-driven run's definition store (see [`crate::materialize_version`]) so a
/// script's sibling imports resolve when the validator runs it.
pub const VALIDATION_SCRIPT_DIR: &str = "validation";

/// The driver's `--outputs` kind tag for a media kind.
fn media_kind_tag(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Image => "image",
        MediaKind::Video => "video",
    }
}

/// The file extension a synthesized output is captured under, by kind: a still is a
/// PNG, a clip is the `.webm` Playwright records natively.
pub(crate) fn validation_output_extension(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Image => "png",
        MediaKind::Video => "webm",
    }
}

/// The file extension a synthesized validation output is published under **in the
/// public snapshot** — the counterpart to [`validation_output_extension`], which is
/// how it is captured on disk and served live.
///
/// They differ for video only. A clip is captured as the `.webm` Playwright records
/// natively (the on-disk name both the run-scoped *actual* and case-scoped *baseline*
/// media use, and what the live console/artifact service serve verbatim); but the
/// snapshot builder transcodes it to H.264 `.mp4` so the public gallery plays on every
/// browser (webm/VP8 does not on iOS/Safari) — exactly as a video proof is published
/// (see [`crate::proof_published_extension`]). A still publishes as its captured PNG
/// unchanged.
pub fn validation_published_extension(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Image => "png",
        MediaKind::Video => "mp4",
    }
}

/// The flat, addressable file name a synthesized output is stored and served under:
/// `<verdict>__<output>.<ext>`. Kept flat (one path segment) so it routes through the
/// one-segment `/validation/{file}` endpoints unchanged, and shared with
/// [`crate::playable::serve_validation_file`] and the gallery URL resolver.
///
/// `verdict_id` is the id of the verdict unit the output backs — a whole item's own id
/// (`<item>`, for an item validated as a whole) or a sub-item's composite id
/// (`<item>.<sub>`, since validation and its proof media attach per sub-item once an
/// item is sub-divided). It contains no `/` (ids are plain slugs joined by a single
/// `.`), so the name stays a single path segment and cannot escape the media directory.
///
/// Both the model's *actual* media (under a run's [`VALIDATION_MEDIA_DIR`]) and a
/// case's *baseline* media (under the version folder's [`VALIDATION_BASELINE_DIR`]`/
/// <variant>/`) use this same name; the directory, not the name, tells them apart.
pub fn validation_media_name(verdict_id: &str, output_id: &str, kind: MediaKind) -> String {
    let ext = validation_output_extension(kind);
    format!("{verdict_id}__{output_id}.{ext}")
}

/// Move each declared output's captured file from a drive's temp directory to its
/// stable flat name under `media_dir`, returning the per-output presence record.
fn relocate_outputs(
    validation: &ReviewValidation,
    verdict_id: &str,
    media_dir: &Path,
    tmp: &Path,
) -> Vec<ScriptedOutput> {
    validation
        .outputs
        .iter()
        .map(|output| {
            let ext = validation_output_extension(output.kind);
            let captured = format!("{}.{ext}", output.id);
            let present = relocate(
                &tmp.join(&captured),
                &media_dir.join(validation_media_name(verdict_id, &output.id, output.kind)),
            );
            ScriptedOutput {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
                present,
            }
        })
        .collect()
}

/// Move `from` to `to`, returning whether the source existed and was relocated.
fn relocate(from: &Path, to: &Path) -> bool {
    from.is_file() && std::fs::rename(from, to).is_ok()
}

/// A validator for asset-generation runs.
///
/// It ignores the build pipeline entirely. Instead it reads each recorded action
/// log, replays it through the **same** drawing library the in-container binary
/// used ([`test_cabinet_draw::render`]) to regenerate the image, and compares it
/// to the pixels the model left on disk (cheat divergence). An asset-generation
/// run has no target image: the regenerated image is the output a human reviews
/// against the brief, and cheat divergence is the one recorded signal — not a
/// gate. A single sprite has one log and one regenerated image; a sprite sheet has
/// one of each **per declared frame** — every frame a separate file. The
/// regenerated image(s) are written into the produced tree so they are collected
/// and served.
#[derive(Debug, Clone, Default)]
pub struct AssetGenValidator;

impl AssetGenValidator {
    /// A new asset-generation validator. It keeps no state: every output is
    /// derived from the run's own action log(s) and written into the run's tree.
    pub fn new() -> Self {
        Self
    }
}

/// The per-frame plan the validator regenerates: where this frame's recorded log
/// and preview live, and where its regenerated image is written.
struct FramePlan {
    index: u32,
    actions_rel: PathBuf,
    preview_rel: PathBuf,
    regenerated_rel: String,
}

impl Validator for AssetGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        // An asset-generation run has no target image, so references — the
        // browser-rendered baselines other types score against — are unused here.
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        // A case may still declare proofs; record their presence as for any type.
        let proof_results = proof_results(proofs, repo);

        // The orchestrator only routes asset-generation cases here, so the tables
        // are present; guard the invariant rather than panicking.
        let (Some(canvas_spec), Some(tool), Some(output)) = (
            test_case.canvas.as_ref(),
            test_case.tool.as_ref(),
            test_case.output.as_ref(),
        ) else {
            return Ok(failed_load(
                "asset-generation validation requires [canvas], [tool], and [output]",
                None,
                None,
                proof_results,
            ));
        };

        let background = match test_cabinet_draw::Background::parse(&canvas_spec.background) {
            Ok(background) => background,
            Err(err) => {
                return Ok(failed_load(
                    &format!("invalid canvas background: {err}"),
                    None,
                    None,
                    proof_results,
                ));
            }
        };
        let canvas = test_cabinet_draw::Canvas {
            width: canvas_spec.width,
            height: canvas_spec.height,
            background,
        };

        // One frame for a single sprite (index 0); one per declared frame for a
        // sheet, each with its own log, preview, and regenerated image.
        let plans: Vec<FramePlan> = match test_case.sheet.as_ref() {
            None => vec![FramePlan {
                index: 0,
                actions_rel: output.actions.clone(),
                preview_rel: tool.preview.clone(),
                regenerated_rel: "regenerated.png".to_string(),
            }],
            Some(sheet) => sheet
                .frames
                .iter()
                .map(|&index| FramePlan {
                    index,
                    actions_rel: crate::test_case::frame_path(&output.actions, index),
                    preview_rel: crate::test_case::frame_path(&tool.preview, index),
                    regenerated_rel: format!("regenerated/{index}.png"),
                })
                .collect(),
        };

        let mut frames = Vec::with_capacity(plans.len());
        for plan in &plans {
            match score_frame(repo, &canvas, plan) {
                Ok(frame) => frames.push(frame),
                // A frame whose log is missing, unparseable, or unrenderable has
                // nothing to score: the run produced no scorable output, so it is a
                // failed load rather than a partial result.
                Err(detail) => return Ok(failed_load(&detail, None, None, proof_results)),
            }
        }

        Ok(ValidationSummary {
            // The run produced scorable image(s): the load signal is positive.
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: Some(AssetGenResult {
                frames,
                // Carry the sprite-sheet frame dims and sequences (when this case
                // draws one) into the run record so the review UI can play the named
                // sequences from the per-frame images directly.
                sheet: test_case.sheet.clone(),
                detail: None,
            }),
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        })
    }
}

/// Regenerate one frame and measure its cheat divergence. Returns `Err` with a
/// fatal reason when the frame's action log cannot be read, parsed, or rendered —
/// the caller maps that to a failed load. A non-fatal gap (a missing preview)
/// is recorded in the frame's `detail` instead.
fn score_frame(
    repo: &Path,
    canvas: &test_cabinet_draw::Canvas,
    plan: &FramePlan,
) -> std::result::Result<AssetFrameResult, String> {
    let actions_path = repo.join(&plan.actions_rel);
    let raw = std::fs::read_to_string(&actions_path).map_err(|err| {
        format!(
            "could not read action log `{}`: {err}",
            plan.actions_rel.display()
        )
    })?;
    let operations: Vec<test_cabinet_draw::Operation> =
        serde_json::from_str(&raw).map_err(|err| {
            format!(
                "action log `{}` is not a valid operation log: {err}",
                plan.actions_rel.display()
            )
        })?;

    // Regenerate the image from the log through the shared drawing library — the
    // same logic the in-container binary used — and write it into the produced
    // tree so it is collected and served.
    let regenerated_path = repo.join(&plan.regenerated_rel);
    if let Some(parent) = regenerated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    test_cabinet_draw::render(canvas, &operations)
        .encode_png(&regenerated_path)
        .map_err(|err| format!("could not write the regenerated image: {err}"))?;

    let mut notes: Vec<String> = Vec::new();

    // Cheat divergence: compare the regenerated frame to the model's on-disk
    // preview. A high value means the model drew outside the tool. Absent or
    // unreadable preview leaves it unmeasured rather than failing the run.
    let preview_path = repo.join(&plan.preview_rel);
    let cheat_divergence = if preview_path.is_file() {
        match score(&preview_path, &regenerated_path) {
            Ok(similarity) => Some(1.0 - similarity),
            Err(err) => {
                notes.push(format!("could not compare against the preview: {err}"));
                None
            }
        }
    } else {
        notes.push("the model left no preview image to compare".to_string());
        None
    };

    Ok(AssetFrameResult {
        index: plan.index,
        regenerated_image: plan.regenerated_rel.clone(),
        preview_image: rel_string(&plan.preview_rel),
        actions_log: rel_string(&plan.actions_rel),
        operation_count: operations.len(),
        cheat_divergence,
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    })
}

/// A validator for voxel asset-generation runs — the 3D analog of
/// [`AssetGenValidator`].
///
/// It ignores the build pipeline entirely. Instead it reads each recorded
/// operation log and replays it through the **same** voxel library the in-container
/// binary used ([`test_cabinet_voxel::render`]) to count the occupied voxels. The
/// geometry the 3D client renders is the per-part `.glb` the binary emitted; preview
/// regeneration and cheat divergence are retired, so the reviewed image is the
/// model's own preview. A voxel run has no target model — a human reviews the result
/// against the brief.
/// A static model ([`AssetKind::VoxelModel`](crate::test_case::AssetKind::VoxelModel))
/// has one target named `model`; an animated model
/// ([`AssetKind::VoxelAnimation`](crate::test_case::AssetKind::VoxelAnimation)) has
/// one per declared part. For an animated model it additionally reads the
/// model-written `rig.json`, records it as the produced rig, and reconciles it
/// against the manifest's required rig — a missing required part or joint is
/// recorded in the run-level detail, never a crash.
///
/// The six **surface-meshed** kinds (`mc`/`sn`/`dc` and their `-anim` siblings) take
/// the same shape but a different geometry path: instead of replaying the log, the
/// validator **decodes the `.glb` the binary emitted** (per model for a static kind,
/// per part for an animated one) and confirms it is a well-formed `PartMesh` (see
/// [`score_mesh_part`]). It never re-meshes; the emitted mesh plus reviewer judgment
/// of the model's preview is the scored artifact.
/// The animated meshed kinds reconcile their `rig.json` against the required
/// `[model]` exactly as the cube animated kind does.
#[derive(Debug, Clone, Default)]
pub struct VoxelGenValidator;

impl VoxelGenValidator {
    /// A new voxel validator. Like [`AssetGenValidator`] it keeps no state: every
    /// output is derived from the run's own operation log(s) and written into the
    /// run's tree.
    pub fn new() -> Self {
        Self
    }
}

/// The per-part plan the validator evaluates: where this part's recorded log and
/// preview live, and where its geometry lives.
///
/// [`Self::mesh_client_rel`] is the `PartMesh`-shaped `.glb` **every**
/// voxel-family kind emits and the 3D client renders from. A **meshed** kind also
/// reads (does not regenerate) the emitted `.glb` at [`Self::mesh_rel`] to validate
/// it; a **cube** kind replays its log only to count occupied voxels.
struct PartPlan {
    name: String,
    ops_rel: PathBuf,
    preview_rel: PathBuf,
    /// The client-facing `.glb` path (the geometry the 3D viewer loads), for
    /// every voxel-family kind — the cube kinds emit it too.
    mesh_client_rel: String,
    /// The run-relative path of the emitted `.glb` a **meshed** kind parses to
    /// validate; `None` for a cube kind (which only replays its log).
    mesh_rel: Option<PathBuf>,
}

impl Validator for VoxelGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        // A voxel run has no target model, so references — the browser-rendered
        // baselines other types score against — are unused here.
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);

        // The orchestrator only routes voxel cases here, so the tables are present;
        // guard the invariant rather than panicking. The volume is resolved for the
        // selected variant, so a half/double run is scored against the size it was
        // actually given rather than the case's base volume.
        let (Some(voxel_spec), Some(tool), Some(output)) = (
            test_case.voxel_for(variant),
            test_case.tool.as_ref(),
            test_case.output.as_ref(),
        ) else {
            return Ok(failed_load(
                "voxel validation requires [voxel], [tool], and [output]",
                None,
                None,
                proof_results,
            ));
        };

        // Validate the declared background even though core no longer renders a
        // preview from it: a malformed value is still a manifest error.
        if let Err(err) = test_cabinet_model_core::PreviewBackground::parse(&voxel_spec.background)
        {
            return Ok(failed_load(
                &format!("invalid voxel background: {err}"),
                None,
                None,
                proof_results,
            ));
        }
        let dims = test_cabinet_voxel::Dims {
            width: voxel_spec.width,
            height: voxel_spec.height,
            depth: voxel_spec.depth,
        };

        // A meshed kind (mc/sn/dc + `-anim`) reads the `.glb` its binary emitted; a
        // cube kind only replays its log to count voxels. `mesh_template` is the
        // meshed-only parse path; `client_mesh_template` is the client-facing `.glb`
        // **every** voxel kind emits (both are `{part}` templates for an animated
        // kind, a single file for a static one).
        let mesh_template = test_case.asset_kind.mesh_dest();
        let is_meshed = test_case.asset_kind.is_meshed();
        // Every voxel-family kind is routed here, so this is always `Some`.
        let client_mesh_template = test_case
            .asset_kind
            .voxel_mesh_dest()
            .expect("a voxel-family kind declares a mesh geometry path");

        // Animated models invent their own parts, so the set to score comes from the
        // PRODUCED rig (`rig.json`), not from any declared list: read it first, then
        // build one target per produced part. A static model is the single implicit
        // `model` target. A missing/unreadable `rig.json` is a recorded gap, not a
        // crash.
        let is_anim = test_case.model.is_some();
        // A skinned kind is animated (it has a `[model]` rig) but builds ONE
        // whole-body field → a single mesh/preview/log, not one per part. It still
        // reads and reconciles `rig.json` below, but its scored plan is single-file.
        let is_skinned = test_case.asset_kind.is_skinned();
        let mut run_notes: Vec<String> = Vec::new();
        let produced_rig = if is_anim {
            match read_rig(repo, is_skinned) {
                Ok(rig) => Some(rig),
                Err(detail) => {
                    run_notes.push(detail);
                    None
                }
            }
        } else {
            None
        };

        let plans: Vec<PartPlan> = if is_skinned {
            // The skinned single-file exception: one whole-body mesh at `mesh.glb`,
            // scored like a static model even though the kind is animated.
            let mesh_rel = mesh_template.map(PathBuf::from);
            vec![PartPlan {
                name: "model".to_string(),
                ops_rel: output.actions.clone(),
                preview_rel: tool.preview.clone(),
                mesh_client_rel: client_mesh_template.to_string(),
                mesh_rel,
            }]
        } else {
            match produced_rig.as_ref() {
                // A static model: one implicit `model` target.
                None if !is_anim => {
                    let mesh_rel = mesh_template.map(PathBuf::from);
                    vec![PartPlan {
                        name: "model".to_string(),
                        ops_rel: output.actions.clone(),
                        preview_rel: tool.preview.clone(),
                        mesh_client_rel: client_mesh_template.to_string(),
                        mesh_rel,
                    }]
                }
                // An animated model whose rig could not be read: nothing to score (the gap
                // is already noted); carry on with no parts.
                None => Vec::new(),
                // An animated model: one target per part the model actually produced.
                Some(rig) => rig
                    .parts
                    .iter()
                    .map(|part| {
                        let mesh_rel = mesh_template
                            .map(|t| crate::test_case::part_path(Path::new(t), &part.name));
                        let mesh_client_rel = rel_string(&crate::test_case::part_path(
                            Path::new(client_mesh_template),
                            &part.name,
                        ));
                        PartPlan {
                            name: part.name.clone(),
                            ops_rel: crate::test_case::part_path(&output.actions, &part.name),
                            preview_rel: crate::test_case::part_path(&tool.preview, &part.name),
                            mesh_client_rel,
                            mesh_rel,
                        }
                    })
                    .collect(),
            }
        };

        let mut parts = Vec::with_capacity(plans.len());
        for plan in &plans {
            // A meshed kind parses the emitted `.glb` (never re-meshing); a cube
            // kind only replays the recorded log to count voxels.
            let scored = if is_meshed {
                score_mesh_part(repo, plan)
            } else {
                score_part(repo, dims, plan)
            };
            match scored {
                Ok(part) => parts.push(part),
                // A static model with no scorable output is a failed load (mirrors
                // the sprite validator). For an animated model one bad part must not
                // sink the whole run: record it zero-scored and carry on, so a
                // missing required part is a recorded gap rather than a crash.
                Err(detail) => {
                    if is_anim {
                        parts.push(VoxelPartResult {
                            name: plan.name.clone(),
                            mesh: plan.mesh_client_rel.clone(),
                            preview_image: rel_string(&plan.preview_rel),
                            ops_log: rel_string(&plan.ops_rel),
                            operation_count: 0,
                            voxel_count: 0,
                            detail: Some(detail),
                        });
                    } else {
                        return Ok(failed_load(&detail, None, None, proof_results));
                    }
                }
            }
        }

        // Reconcile the produced rig against the required animations: each required
        // animation must be present in `rig.json` and actually animate. A gap is
        // recorded in the run-level detail — not gated.
        if let (Some(required), Some(produced)) = (test_case.model.as_ref(), produced_rig.as_ref())
        {
            reconcile_rig(required, produced, &mut run_notes);
        }

        Ok(ValidationSummary {
            // The run produced scorable voxel data: the load signal is positive.
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: Some(VoxelGenResult {
                parts,
                // The required rig (the scoring targets) for an animated model.
                model: test_case.model.clone(),
                // The full rig the model actually produced (`rig.json`).
                rig: produced_rig,
                // A skinned run deforms one mesh; the marker tells the viewer to skin
                // rather than pose per-part.
                skinned: test_case.asset_kind.is_skinned(),
                // The voxel-family kinds pose from `rig.json`, not a baked glTF.
                blender: false,
                detail: (!run_notes.is_empty()).then(|| run_notes.join("; ")),
            }),
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        })
    }
}

/// Regenerate one part's voxel data from its operation log and record the part.
///
/// Returns `Err` with a fatal reason when the operation log cannot be parsed or its
/// voxel data cannot be written — the caller maps that to a failed load (static) or
/// a zero-scored part (animated). A missing log is treated as an empty part (with a
/// note), so a model that simply never sculpted a part is recorded rather than
/// failed. Preview regeneration and cheat divergence are retired: the reviewed
/// image is the model's own rendered preview.
fn score_part(
    repo: &Path,
    dims: test_cabinet_voxel::Dims,
    plan: &PartPlan,
) -> std::result::Result<VoxelPartResult, String> {
    let ops_path = repo.join(&plan.ops_rel);
    let (operations, notes) = match std::fs::read_to_string(&ops_path) {
        Ok(raw) => {
            let operations: Vec<test_cabinet_voxel::Operation> = serde_json::from_str(&raw)
                .map_err(|err| {
                    format!(
                        "operation log `{}` is not a valid operation log: {err}",
                        plan.ops_rel.display()
                    )
                })?;
            (operations, Vec::new())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => (
            Vec::new(),
            vec!["the model recorded no operations for this part".to_string()],
        ),
        Err(err) => {
            return Err(format!(
                "could not read operation log `{}`: {err}",
                plan.ops_rel.display()
            ));
        }
    };

    let set = test_cabinet_voxel::render(&dims, &operations);

    // Replay the log only to count occupied voxels. The geometry the client renders
    // is the per-part `.glb` the binary emitted; preview regeneration and cheat
    // divergence are retired for the voxel family (the reviewed image is the model's
    // own wgpu+Mesa preview), so core writes no voxel data of its own.
    Ok(VoxelPartResult {
        name: plan.name.clone(),
        mesh: plan.mesh_client_rel.clone(),
        preview_image: rel_string(&plan.preview_rel),
        ops_log: rel_string(&plan.ops_rel),
        operation_count: operations.len(),
        voxel_count: set.occupied_count(),
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    })
}

/// Evaluate one part of a **surface-meshed** run: decode the `.glb` the binary
/// emitted and confirm it is a well-formed `PartMesh`. Unlike [`score_part`], this
/// regenerates **no** geometry — the emitted mesh is the scored artifact, so the
/// validator only reads and validates it.
///
/// Returns `Err` with a fatal reason only when the emitted mesh is present but
/// malformed (the caller maps that to a failed load for a static kind, or a
/// zero-scored part for an animated one), or when a file is unreadable for a reason
/// other than absence. A **missing** log or a **missing** mesh is a recorded gap
/// (an empty part with a note), so a model that simply never meshed a part is
/// recorded rather than failing the run — mirroring [`score_part`].
fn score_mesh_part(repo: &Path, plan: &PartPlan) -> std::result::Result<VoxelPartResult, String> {
    let mesh_rel = plan
        .mesh_rel
        .as_ref()
        .expect("a meshed part plan carries a mesh path");
    let mut notes: Vec<String> = Vec::new();

    // Read the recorded operation log only for its op count — the geometry is the
    // emitted mesh, not a replay of the log. A missing log is an empty part; a
    // present-but-unparseable log is fatal (as in the cube path).
    let ops_path = repo.join(&plan.ops_rel);
    let operation_count = match std::fs::read_to_string(&ops_path) {
        Ok(raw) => {
            let ops: Vec<serde_json::Value> = serde_json::from_str(&raw).map_err(|err| {
                format!(
                    "operation log `{}` is not a valid operation log: {err}",
                    plan.ops_rel.display()
                )
            })?;
            ops.len()
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            notes.push("the model recorded no operations for this part".to_string());
            0
        }
        Err(err) => {
            return Err(format!(
                "could not read operation log `{}`: {err}",
                plan.ops_rel.display()
            ));
        }
    };

    // Decode and well-formedness-check the emitted per-part `.glb` (the `PartMesh`
    // shape: positions/normals/colors/indices). Its vertex count is recorded in place
    // of a voxel count. A missing mesh is a recorded gap; a malformed one is fatal.
    let mesh_path = repo.join(mesh_rel);
    let vertex_count = match std::fs::read(&mesh_path) {
        Ok(bytes) => {
            let arrays = test_cabinet_model_core::glb_to_part_mesh(&bytes).map_err(|err| {
                format!(
                    "emitted mesh `{}` is not a well-formed glb PartMesh: {err}",
                    rel_string(mesh_rel)
                )
            })?;
            let mesh = test_cabinet_voxel_mesh::Mesh {
                positions: arrays.positions,
                normals: arrays.normals,
                colors: arrays.colors,
                indices: arrays.indices,
            };
            validate_mesh(&mesh)
                .map_err(|err| format!("emitted mesh `{}` {err}", rel_string(mesh_rel)))?;
            mesh.positions.len() / 3
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            notes.push("the model emitted no mesh for this part".to_string());
            0
        }
        Err(err) => {
            return Err(format!(
                "could not read emitted mesh `{}`: {err}",
                rel_string(mesh_rel)
            ));
        }
    };

    // As in the cube path, the reviewed image is the model's own rendered preview
    // and cheat divergence is retired.
    Ok(VoxelPartResult {
        name: plan.name.clone(),
        // The emitted `.glb` is what the client renders in 3D.
        mesh: plan.mesh_client_rel.clone(),
        preview_image: rel_string(&plan.preview_rel),
        ops_log: rel_string(&plan.ops_rel),
        operation_count,
        // No voxels for a mesh; the emitted mesh's vertex count stands in.
        voxel_count: vertex_count,
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    })
}

/// Confirm an emitted [`Mesh`](test_cabinet_voxel_mesh::Mesh) is a well-formed
/// `PartMesh`: parallel `positions`/`normals`/`colors` flat triple arrays of equal
/// length, a triangle-aligned `indices` array, and every index in range. Returns a
/// trailing clause (`"has …"`, `"references …"`) the caller prefixes with the mesh
/// path.
fn validate_mesh(mesh: &test_cabinet_voxel_mesh::Mesh) -> std::result::Result<(), String> {
    // Every position/normal/color float must be finite (a NaN or infinity would poison
    // the geometry the client renders).
    if let Some(bad) = mesh
        .positions
        .iter()
        .chain(mesh.normals.iter())
        .chain(mesh.colors.iter())
        .find(|f| !f.is_finite())
    {
        return Err(format!("has a non-finite vertex value ({bad})"));
    }
    if !mesh.positions.len().is_multiple_of(3) {
        return Err(format!(
            "has {} position floats, not a multiple of 3",
            mesh.positions.len()
        ));
    }
    let vertices = mesh.positions.len() / 3;
    if mesh.normals.len() != mesh.positions.len() {
        return Err(format!(
            "has {} normal floats but {} position floats",
            mesh.normals.len(),
            mesh.positions.len()
        ));
    }
    if mesh.colors.len() != mesh.positions.len() {
        return Err(format!(
            "has {} color floats but {} position floats",
            mesh.colors.len(),
            mesh.positions.len()
        ));
    }
    if !mesh.indices.len().is_multiple_of(3) {
        return Err(format!(
            "has {} indices, not a multiple of 3",
            mesh.indices.len()
        ));
    }
    if let Some(&bad) = mesh.indices.iter().find(|&&i| i as usize >= vertices) {
        return Err(format!(
            "references vertex {bad} but has only {vertices} vertices"
        ));
    }
    Ok(())
}

/// Read the model-written `rig.json` and convert it into a [`ModelSpec`] superset
/// (the full produced rig — required parts/joints plus any the model added).
fn read_rig(repo: &Path, is_skinned: bool) -> std::result::Result<ModelSpec, String> {
    let rig_path = repo.join(crate::test_case::VOXEL_RIG_DEST);
    let raw = std::fs::read_to_string(&rig_path).map_err(|err| {
        format!(
            "could not read `{}`: {err}",
            crate::test_case::VOXEL_RIG_DEST
        )
    })?;
    let invalid = |err: serde_json::Error| {
        format!(
            "`{}` is not a valid rig: {err}",
            crate::test_case::VOXEL_RIG_DEST
        )
    };
    // A skinned kind writes a bones-based rig (`SkinnedRig`), not the parts-based rig
    // every rigid voxel/mesh kind writes, so parse it accordingly — a plain `Rig` parse
    // would fail on the missing `parts` and lose the produced joints/animations. Both
    // share the same joint/animation shapes; only the skeleton differs (bones vs parts).
    if is_skinned {
        let rig: SkinnedRigDoc = serde_json::from_str(&raw).map_err(invalid)?;
        Ok(skinned_rig_to_model_spec(&rig))
    } else {
        let rig: test_cabinet_voxel::Rig = serde_json::from_str(&raw).map_err(invalid)?;
        Ok(rig_to_model_spec(&rig))
    }
}

/// Convert the voxel binary's on-disk [`Rig`](test_cabinet_voxel::Rig) into the
/// contract [`ModelSpec`] carried in the run record.
fn rig_to_model_spec(rig: &test_cabinet_voxel::Rig) -> ModelSpec {
    ModelSpec {
        parts: rig.parts.iter().map(part_to_spec).collect(),
        joints: joints_to_specs(&rig.joints),
        animations: animations_to_specs(&rig.animations),
    }
}

/// Convert one voxel [`Part`](test_cabinet_voxel::Part) into a contract [`PartSpec`].
fn part_to_spec(part: &test_cabinet_voxel::Part) -> PartSpec {
    PartSpec {
        name: part.name.clone(),
        parent: part.parent.clone(),
        pivot: part.pivot,
    }
}

/// Convert the shared joint list into [`JointSpec`]s. Identical for a rigid rig
/// (voxel/mesh, whose joints target parts) and a skinned rig (whose joints target
/// bones): both use the same [`Joint`](test_cabinet_voxel::Joint) shape, and a skinned
/// joint's target bone rides in the same `part` field.
fn joints_to_specs(joints: &[test_cabinet_voxel::Joint]) -> Vec<JointSpec> {
    joints
        .iter()
        .map(|joint| {
            let kind = match joint.kind {
                test_cabinet_voxel::JointKind::Rotation => JointKindSpec::Rotation,
                test_cabinet_voxel::JointKind::Translation => JointKindSpec::Translation,
            };
            let axis = match joint.axis {
                test_cabinet_voxel::Axis::X => AxisSpec::X,
                test_cabinet_voxel::Axis::Y => AxisSpec::Y,
                test_cabinet_voxel::Axis::Z => AxisSpec::Z,
            };
            let drive = match &joint.drive {
                test_cabinet_voxel::Drive::Caller => DriveKindSpec::Caller,
                test_cabinet_voxel::Drive::Auto => DriveKindSpec::Auto,
            };
            // Carry a compound mount through, dropping an all-zero one to `None`.
            let nonzero = |v: [f64; 3]| Some(v).filter(|a| a.iter().any(|c| *c != 0.0));
            JointSpec {
                name: joint.name.clone(),
                part: joint.part.clone(),
                kind,
                axis,
                pivot: joint.pivot,
                min: joint.min,
                max: joint.max,
                rest: joint.rest,
                offset: nonzero(joint.offset),
                orient: nonzero(joint.orient),
                drive,
            }
        })
        .collect()
}

/// Convert the shared animation list into [`AnimationSpec`]s. Identical for a rigid and
/// a skinned rig. The model's animations ride in the produced `rig.json` (the required
/// declarations, seeded with empty tracks, plus the F-curves the model authored).
fn animations_to_specs(animations: &[test_cabinet_voxel::Animation]) -> Vec<AnimationSpec> {
    animations
        .iter()
        .map(|animation| AnimationSpec {
            name: animation.name.clone(),
            period_ms: animation.period_ms,
            looping: animation.looping,
            auto_play: animation.auto_play,
            joints: animation.joints.clone(),
            tracks: animation
                .tracks
                .iter()
                .map(|track| AnimationTrackSpec {
                    joint: track.joint.clone(),
                    keyframes: track.keyframes.iter().map(keyframe_to_spec).collect(),
                })
                .collect(),
        })
        .collect()
}

/// The model-written **skinned** `rig.json` (`mc-skin`/`sn-skin`/`dc-skin`): a minimal
/// deserialize view, since `core` does not depend on the skinning crate. Its skeleton is
/// `bones` rather than `parts`; its `joints` and `animations` are the same shapes a rigid
/// rig uses, so they reuse the shared converters. Only the fields the run record needs are
/// read — the skinning weights live in the mesh, not here.
#[derive(serde::Deserialize)]
struct SkinnedRigDoc {
    #[serde(default)]
    bones: Vec<SkinnedBoneDoc>,
    #[serde(default)]
    joints: Vec<test_cabinet_voxel::Joint>,
    #[serde(default)]
    animations: Vec<test_cabinet_voxel::Animation>,
}

/// One bone of a [`SkinnedRigDoc`]: its name, parent, and head (which becomes the mapped
/// part's pivot). The bone's tail/roll/weights are irrelevant to the run-record rig.
#[derive(serde::Deserialize)]
struct SkinnedBoneDoc {
    name: String,
    #[serde(default)]
    parent: Option<String>,
    head: [f64; 3],
}

/// Convert a skinned `rig.json` into the contract [`ModelSpec`] the skinned result view
/// poses. Each bone maps to a part, its head rounded to the integer grid parts use as the
/// pivot; the skinned viewer takes its actual skeleton from the mesh, so these parts are
/// cosmetic, but they keep the spec complete and named. Joints and animations convert
/// exactly as a rigid rig's.
fn skinned_rig_to_model_spec(rig: &SkinnedRigDoc) -> ModelSpec {
    let parts = rig
        .bones
        .iter()
        .map(|bone| PartSpec {
            name: bone.name.clone(),
            parent: bone.parent.clone(),
            pivot: [
                bone.head[0].round() as i64,
                bone.head[1].round() as i64,
                bone.head[2].round() as i64,
            ],
        })
        .collect();
    ModelSpec {
        parts,
        joints: joints_to_specs(&rig.joints),
        animations: animations_to_specs(&rig.animations),
    }
}

/// Convert a voxel [`Keyframe`](test_cabinet_voxel::rig::Keyframe) into the contract
/// [`KeyframeSpec`], mapping its interpolation and carrying its Bézier handles.
fn keyframe_to_spec(kf: &test_cabinet_voxel::rig::Keyframe) -> KeyframeSpec {
    use test_cabinet_voxel::rig::Interp;
    let interp = match kf.interp {
        Interp::Constant => InterpSpec::Constant,
        Interp::Linear => InterpSpec::Linear,
        Interp::Bezier => InterpSpec::Bezier,
        Interp::EaseIn => InterpSpec::EaseIn,
        Interp::EaseOut => InterpSpec::EaseOut,
        Interp::EaseInOut => InterpSpec::EaseInOut,
    };
    KeyframeSpec {
        t_ms: kf.t_ms,
        value: kf.value,
        interp,
        out_handle: kf.out_handle,
        in_handle: kf.in_handle,
    }
}

/// Reconcile the produced rig against the required animations — the **only** contract
/// a case fixes (parts and joints are model-invented). For each required animation the
/// produced rig must carry one of the same name that actually **animates** (at least
/// one keyframed track); a missing or empty required animation is recorded in the
/// run-level detail rather than crashing the validator.
fn reconcile_rig(required: &ModelSpec, produced: &ModelSpec, notes: &mut Vec<String>) {
    for animation in &required.animations {
        let Some(produced_anim) = produced
            .animations
            .iter()
            .find(|a| a.name == animation.name)
        else {
            notes.push(format!(
                "required animation `{}` is missing from the produced rig",
                animation.name
            ));
            continue;
        };
        let animates = produced_anim.tracks.iter().any(|t| !t.keyframes.is_empty());
        if !animates {
            notes.push(format!(
                "required animation `{}` is declared but animates nothing (no keyframed \
                 tracks)",
                animation.name
            ));
        }
    }
}

// ===========================================================================
// Painted (ui / material), particle, and audio validators.
//
// Like the voxel family, none of these is regenerated: the authoritative output is
// the data the binary emits (flattened PNGs + `ui.json` / per-map PNGs +
// `material.json` / `system.json` / `clip.wav`), which the validator DECODES and
// well-formedness-checks. It never replays the operation log.
// ===========================================================================

/// A validator for the two 2D **painted** kinds (`ui`/`material`). It decodes the
/// emitted PNG(s) and parses the auto-emitted `ui.json`/`material.json`; there is no
/// regeneration and no cheat check.
#[derive(Debug, Clone, Default)]
pub struct PaintGenValidator;

impl PaintGenValidator {
    /// A new painted-asset validator. It keeps no state.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for PaintGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);

        let Some(tool) = test_case.tool.as_ref() else {
            return Ok(failed_load(
                "painted validation requires [tool]",
                None,
                None,
                proof_results,
            ));
        };

        let mut summary = ValidationSummary {
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        };

        match test_case.asset_kind {
            AssetKind::Ui => {
                let Some(canvas) = test_case.canvas.as_ref() else {
                    return Ok(failed_load(
                        "a `ui` case requires [canvas]",
                        None,
                        None,
                        summary.proofs,
                    ));
                };
                let ui_spec = test_case.ui.as_ref();
                summary.ui = Some(validate_ui(repo, canvas, tool, ui_spec));
            }
            AssetKind::Material => {
                let Some(material) = test_case.material.as_ref() else {
                    return Ok(failed_load(
                        "a `material` case requires [material]",
                        None,
                        None,
                        summary.proofs,
                    ));
                };
                summary.material = Some(validate_material(repo, material, tool));
            }
            _ => {
                return Ok(failed_load(
                    "painted validation requires a `ui` or `material` case",
                    None,
                    None,
                    summary.proofs,
                ));
            }
        }
        Ok(summary)
    }
}

/// A validator for the two **particle** kinds (`particle-2d`/`particle-3d`): parse
/// the emitted `system.json`, confirm it is well-formed and non-empty (it actually
/// emits particles), and take the rendered preview as the reviewer sees it.
#[derive(Debug, Clone, Default)]
pub struct ParticleGenValidator;

impl ParticleGenValidator {
    /// A new particle validator. It keeps no state.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for ParticleGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);
        let Some(tool) = test_case.tool.as_ref() else {
            return Ok(failed_load(
                "particle validation requires [tool]",
                None,
                None,
                proof_results,
            ));
        };
        let particle = validate_particle(repo, tool);
        Ok(ValidationSummary {
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: Some(particle),
            audio: None,
            adversarial: None,
            performance: None,
        })
    }
}

/// A validator for the three **audio** kinds (`sfx-synth`/`sfx-sample`/`music`):
/// decode the emitted PCM `clip.wav`, confirm it is well-formed, within the
/// `[audio]` format, no longer than the cap, and not silent.
#[derive(Debug, Clone, Default)]
pub struct AudioGenValidator;

impl AudioGenValidator {
    /// A new audio validator. It keeps no state.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for AudioGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);
        let (Some(audio), Some(tool)) = (test_case.audio.as_ref(), test_case.tool.as_ref()) else {
            return Ok(failed_load(
                "audio validation requires [audio] and [tool]",
                None,
                None,
                proof_results,
            ));
        };
        let result = validate_audio(repo, audio, test_case.asset_kind, tool);
        Ok(ValidationSummary {
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: Some(result),
            adversarial: None,
            performance: None,
        })
    }
}

// --- ui.json / material.json / system.json parse structs -------------------

/// Core's parse-struct for the emitted `ui.json` (element sizes, nine-slice insets,
/// atlas rectangles). Unknown fields are ignored so the binary may carry more than
/// core reads.
#[derive(serde::Deserialize)]
struct UiJson {
    #[serde(default)]
    elements: Vec<UiJsonElement>,
    #[serde(default)]
    atlas: Vec<UiJsonAtlasRect>,
}

#[derive(serde::Deserialize)]
struct UiJsonElement {
    name: String,
    #[serde(default)]
    nine_slice: Option<UiJsonNineSlice>,
}

#[derive(serde::Deserialize)]
struct UiJsonNineSlice {
    left: u32,
    right: u32,
    top: u32,
    bottom: u32,
}

#[derive(serde::Deserialize)]
struct UiJsonAtlasRect {
    width: u32,
    height: u32,
}

/// Core's parse-struct for the emitted `material.json` (per-map paths + color space,
/// tiling scale, size). Unknown fields are ignored.
#[derive(serde::Deserialize)]
struct MaterialJson {
    #[serde(default)]
    maps: Vec<MaterialJsonMap>,
    #[serde(default)]
    tiling: Option<f64>,
}

#[derive(serde::Deserialize)]
struct MaterialJsonMap {
    name: String,
    #[serde(default)]
    color_space: Option<String>,
}

/// Core's parse-struct for the emitted `system.json` (the authored particle system).
/// Only the fields the non-empty check needs are read; the rest is ignored.
#[derive(serde::Deserialize)]
struct SystemJson {
    #[serde(default)]
    emitters: Vec<SystemJsonEmitter>,
}

#[derive(serde::Deserialize)]
struct SystemJsonEmitter {
    /// The emission source, an internally-tagged `{"mode":"rate","rate":…}` or
    /// `{"mode":"burst","count":…,"atMs":…}` object (the shape `particle-core` and
    /// `@test-cabinet/particle-runtime` emit). Absent → the emitter declares no source.
    #[serde(default)]
    emission: Option<SystemJsonEmission>,
}

/// The emitter's emission source. `mode` is ignored; `rate`/`count` are read directly
/// so a positive continuous rate or a positive burst count both count as emitting.
#[derive(serde::Deserialize)]
struct SystemJsonEmission {
    /// Continuous emission rate (particles/second), present for `mode:"rate"`.
    #[serde(default)]
    rate: Option<f64>,
    /// One-shot burst count, present for `mode:"burst"`.
    #[serde(default)]
    count: Option<u32>,
}

impl SystemJsonEmitter {
    /// Whether this emitter actually emits particles (a positive rate or burst count),
    /// rather than declaring an emitter that produces nothing.
    fn emits(&self) -> bool {
        self.emission
            .as_ref()
            .is_some_and(|e| e.rate.is_some_and(|r| r > 0.0) || e.count.is_some_and(|c| c > 0))
    }
}

/// Decode and well-formedness-check a `ui` run: one element for a single-image case,
/// one per declared element for a kit. Each element's emitted PNG must decode and
/// match its declared size; `ui.json` (when present) must parse and its nine-slice
/// insets fall within each element's bounds.
fn validate_ui(
    repo: &Path,
    canvas: &crate::test_case::CanvasSpec,
    tool: &crate::test_case::ToolSpec,
    ui_spec: Option<&crate::test_case::UiSpec>,
) -> UiGenResult {
    // The element set: the implicit single element (the whole canvas) when the case
    // declares no kit, otherwise one per declared element.
    let elements: Vec<(String, u32, u32, PathBuf)> = match ui_spec {
        Some(ui) if !ui.elements.is_empty() => ui
            .elements
            .iter()
            .map(|el| {
                (
                    el.name.clone(),
                    el.width,
                    el.height,
                    crate::test_case::element_path(&tool.preview, &el.name),
                )
            })
            .collect(),
        _ => vec![(
            "canvas".to_string(),
            canvas.width,
            canvas.height,
            tool.preview.clone(),
        )],
    };

    let mut run_notes: Vec<String> = Vec::new();
    let ui_json = match std::fs::read_to_string(repo.join(crate::test_case::UI_JSON_DEST)) {
        Ok(raw) => match serde_json::from_str::<UiJson>(&raw) {
            Ok(parsed) => Some(parsed),
            Err(err) => {
                run_notes.push(format!("`ui.json` is not well-formed: {err}"));
                None
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            run_notes.push("the model emitted no `ui.json`".to_string());
            None
        }
        Err(err) => {
            run_notes.push(format!("could not read `ui.json`: {err}"));
            None
        }
    };
    // Any atlas rectangle must be non-degenerate (self-consistent).
    if let Some(json) = &ui_json
        && json.atlas.iter().any(|r| r.width == 0 || r.height == 0)
    {
        run_notes.push("`ui.json` declares a degenerate atlas rectangle".to_string());
    }

    let mut results = Vec::with_capacity(elements.len());
    for (name, decl_w, decl_h, preview_rel) in elements {
        let mut detail: Vec<String> = Vec::new();
        let (width, height) = match decode_png(&repo.join(&preview_rel)) {
            Ok(image) => {
                let (dw, dh) = (image.width as u32, image.height as u32);
                if dw != decl_w || dh != decl_h {
                    detail.push(format!(
                        "emitted PNG is {dw}x{dh} but the element declares {decl_w}x{decl_h}"
                    ));
                }
                (dw, dh)
            }
            Err(err) => {
                detail.push(format!("could not decode emitted PNG: {err}"));
                (decl_w, decl_h)
            }
        };
        // The nine-slice the model authored (from `ui.json`), validated to fall
        // within the element's declared bounds.
        let nine_slice = ui_json
            .as_ref()
            .and_then(|json| json.elements.iter().find(|e| e.name == name))
            .and_then(|e| e.nine_slice.as_ref())
            .map(|ns| NineSlice {
                left: ns.left,
                right: ns.right,
                top: ns.top,
                bottom: ns.bottom,
            });
        if let Some(ns) = &nine_slice {
            if ns.left + ns.right > decl_w {
                detail.push(format!(
                    "nine_slice left+right ({}) exceeds width {decl_w}",
                    ns.left + ns.right
                ));
            }
            if ns.top + ns.bottom > decl_h {
                detail.push(format!(
                    "nine_slice top+bottom ({}) exceeds height {decl_h}",
                    ns.top + ns.bottom
                ));
            }
        }
        results.push(UiElementResult {
            name,
            image: rel_string(&preview_rel),
            width,
            height,
            nine_slice,
            detail: (!detail.is_empty()).then(|| detail.join("; ")),
        });
    }

    UiGenResult {
        elements: results,
        detail: (!run_notes.is_empty()).then(|| run_notes.join("; ")),
    }
}

/// Decode and well-formedness-check a `material` run: each declared map's emitted PNG
/// must decode and be the declared square `size`; `base-color` must be present and
/// decode; `material.json` (when present) must parse and supplies each map's color
/// space and the tiling scale.
fn validate_material(
    repo: &Path,
    material: &crate::test_case::MaterialSpec,
    tool: &crate::test_case::ToolSpec,
) -> MaterialGenResult {
    let mut run_notes: Vec<String> = Vec::new();
    let material_json =
        match std::fs::read_to_string(repo.join(crate::test_case::MATERIAL_JSON_DEST)) {
            Ok(raw) => match serde_json::from_str::<MaterialJson>(&raw) {
                Ok(parsed) => Some(parsed),
                Err(err) => {
                    run_notes.push(format!("`material.json` is not well-formed: {err}"));
                    None
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                run_notes.push("the model emitted no `material.json`".to_string());
                None
            }
            Err(err) => {
                run_notes.push(format!("could not read `material.json`: {err}"));
                None
            }
        };

    let mut maps = Vec::with_capacity(material.maps.len());
    for map in &material.maps {
        let mut detail: Vec<String> = Vec::new();
        let preview_rel = crate::test_case::map_path(&tool.preview, map);
        match decode_png(&repo.join(&preview_rel)) {
            Ok(image) => {
                if image.width as u32 != material.size || image.height as u32 != material.size {
                    detail.push(format!(
                        "emitted PNG is {}x{} but the material declares {}x{}",
                        image.width, image.height, material.size, material.size
                    ));
                }
            }
            Err(err) => {
                detail.push(format!("could not decode emitted PNG: {err}"));
                if map == "base-color" {
                    run_notes.push("the required `base-color` map did not decode".to_string());
                }
            }
        }
        // The color space: taken from `material.json` when it tags the map, else the
        // canonical default for the channel (sRGB for color data, linear otherwise).
        let color_space = material_json
            .as_ref()
            .and_then(|json| json.maps.iter().find(|m| &m.name == map))
            .and_then(|m| m.color_space.clone())
            .unwrap_or_else(|| default_color_space(map).to_string());
        maps.push(MaterialMapResult {
            name: map.clone(),
            image: rel_string(&preview_rel),
            color_space,
            detail: (!detail.is_empty()).then(|| detail.join("; ")),
        });
    }

    MaterialGenResult {
        maps,
        size: material.size,
        tiling: material_json.and_then(|json| json.tiling),
        detail: (!run_notes.is_empty()).then(|| run_notes.join("; ")),
    }
}

/// The canonical color space for a material map channel: sRGB for the color-data
/// channels (`base-color`/`emissive`), linear for the rest.
fn default_color_space(channel: &str) -> &'static str {
    match channel {
        "base-color" | "emissive" => "srgb",
        _ => "linear",
    }
}

/// Parse and non-emptiness-check a particle run's emitted `system.json`, and record
/// the rendered preview when present.
fn validate_particle(repo: &Path, tool: &crate::test_case::ToolSpec) -> ParticleGenResult {
    let system_rel = crate::test_case::PARTICLE_SYSTEM_DEST;
    let mut notes: Vec<String> = Vec::new();
    let emitter_count = match std::fs::read_to_string(repo.join(system_rel)) {
        Ok(raw) => match serde_json::from_str::<SystemJson>(&raw) {
            Ok(system) => {
                if system.emitters.is_empty() {
                    notes.push("`system.json` declares no emitters".to_string());
                } else if !system.emitters.iter().any(SystemJsonEmitter::emits) {
                    notes.push(
                        "`system.json` declares emitters but none actually emits particles"
                            .to_string(),
                    );
                }
                system.emitters.len()
            }
            Err(err) => {
                notes.push(format!("`system.json` is not well-formed: {err}"));
                0
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            notes.push("the model emitted no `system.json`".to_string());
            0
        }
        Err(err) => {
            notes.push(format!("could not read `system.json`: {err}"));
            0
        }
    };
    let preview = {
        let path = repo.join(&tool.preview);
        path.is_file().then(|| rel_string(&tool.preview))
    };
    ParticleGenResult {
        system: system_rel.to_string(),
        preview,
        emitter_count,
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    }
}

/// Decode and check an audio run's emitted `clip.wav` against the declared `[audio]`
/// format, its duration cap, and non-silence; record the portable `clip.mid` (for a
/// `music` run) and the rendered preview when present.
fn validate_audio(
    repo: &Path,
    audio: &crate::test_case::AudioSpec,
    kind: AssetKind,
    tool: &crate::test_case::ToolSpec,
) -> AudioGenResult {
    let clip_rel = crate::test_case::AUDIO_CLIP_WAV_DEST;
    let declared_channels: u32 = if audio.channels == "stereo" { 2 } else { 1 };
    let mut notes: Vec<String> = Vec::new();
    let (sample_rate, channels, duration_ms) = match std::fs::read(repo.join(clip_rel)) {
        Ok(bytes) => match parse_wav(&bytes) {
            Ok(info) => {
                if info.sample_rate != audio.sample_rate {
                    notes.push(format!(
                        "clip sample rate {} does not match the declared {}",
                        info.sample_rate, audio.sample_rate
                    ));
                }
                if info.channels as u32 != declared_channels {
                    notes.push(format!(
                        "clip has {} channel(s) but the case declares {} ({})",
                        info.channels, declared_channels, audio.channels
                    ));
                }
                if info.duration_ms > audio.max_duration_ms {
                    notes.push(format!(
                        "clip is {} ms, longer than the {} ms cap",
                        info.duration_ms, audio.max_duration_ms
                    ));
                }
                if info.silent {
                    notes.push(
                        "clip is silent (the operations produced no audible signal)".to_string(),
                    );
                }
                (info.sample_rate, info.channels as u32, info.duration_ms)
            }
            Err(err) => {
                notes.push(format!("`clip.wav` is not a well-formed PCM WAV: {err}"));
                (0, 0, 0)
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            notes.push("the model emitted no `clip.wav`".to_string());
            (0, 0, 0)
        }
        Err(err) => {
            notes.push(format!("could not read `clip.wav`: {err}"));
            (0, 0, 0)
        }
    };
    // `music` additionally emits a portable `.mid` score; record it when present.
    let midi = if kind.emits_midi() {
        let mid = crate::test_case::AUDIO_CLIP_MID_DEST;
        if repo.join(mid).is_file() {
            Some(mid.to_string())
        } else {
            notes.push("the `music` run emitted no `clip.mid`".to_string());
            None
        }
    } else {
        None
    };
    let preview = {
        let path = repo.join(&tool.preview);
        path.is_file().then(|| rel_string(&tool.preview))
    };
    AudioGenResult {
        clip: clip_rel.to_string(),
        midi,
        preview,
        sample_rate,
        channels,
        duration_ms,
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    }
}

/// The decoded header/summary of a PCM WAV file, enough to validate an audio clip.
struct WavInfo {
    /// Channel count (1 = mono, 2 = stereo).
    channels: u16,
    /// Sample rate in Hz.
    sample_rate: u32,
    /// Clip length in milliseconds, from the data chunk size and format.
    duration_ms: u32,
    /// Whether every sample is (near) zero — a silent clip.
    silent: bool,
}

/// Parse a minimal PCM RIFF/WAVE file into a [`WavInfo`], without depending on an
/// audio crate. Walks the RIFF chunks for the `fmt ` and `data` chunks, requires
/// integer PCM (`audioFormat == 1`), and scans the samples for any audible signal.
fn parse_wav(bytes: &[u8]) -> std::result::Result<WavInfo, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("missing RIFF/WAVE header".to_string());
    }
    let read_u16 = |b: &[u8]| u16::from_le_bytes([b[0], b[1]]);
    let read_u32 = |b: &[u8]| u32::from_le_bytes([b[0], b[1], b[2], b[3]]);

    let mut fmt: Option<(u16, u16, u32, u16)> = None; // (format, channels, rate, bits)
    let mut data: Option<(usize, usize)> = None; // (start, end) of the data chunk body
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = read_u32(&bytes[pos + 4..pos + 8]) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size).min(bytes.len());
        if id == b"fmt " && body_end - body_start >= 16 {
            let b = &bytes[body_start..body_end];
            fmt = Some((
                read_u16(&b[0..2]),
                read_u16(&b[2..4]),
                read_u32(&b[4..8]),
                read_u16(&b[14..16]),
            ));
        } else if id == b"data" {
            data = Some((body_start, body_end));
        }
        // RIFF chunks are word-aligned: an odd size carries a pad byte.
        pos = body_start + size + (size & 1);
    }

    let (format, channels, sample_rate, bits) = fmt.ok_or("missing `fmt ` chunk")?;
    if format != 1 {
        return Err(format!("not integer PCM (audioFormat {format})"));
    }
    if channels == 0 || sample_rate == 0 || bits == 0 || !bits.is_multiple_of(8) {
        return Err("invalid fmt fields".to_string());
    }
    let (data_start, data_end) = data.ok_or("missing `data` chunk")?;
    let sample_bytes = (bits / 8) as usize;
    let frame_bytes = sample_bytes * channels as usize;
    let body = &bytes[data_start..data_end];
    let frames = body.len().checked_div(frame_bytes).unwrap_or(0);
    let duration_ms = ((frames as u64 * 1000) / sample_rate as u64) as u32;
    let silent = wav_is_silent(body, bits);
    Ok(WavInfo {
        channels,
        sample_rate,
        duration_ms,
        silent,
    })
}

/// Whether a PCM data chunk is (near) silent: every sample's normalized amplitude is
/// below a small threshold. Handles 8/16/24/32-bit PCM.
fn wav_is_silent(data: &[u8], bits: u16) -> bool {
    // ~ -72 dBFS: below this a clip reads as silence rather than signal.
    const THRESHOLD: f64 = 2.5e-4;
    let sample_bytes = (bits / 8) as usize;
    if sample_bytes == 0 {
        return true;
    }
    let mut peak = 0.0_f64;
    for chunk in data.chunks_exact(sample_bytes) {
        let norm = match bits {
            8 => {
                // 8-bit PCM is unsigned, centered at 128.
                (chunk[0] as f64 - 128.0) / 128.0
            }
            16 => i16::from_le_bytes([chunk[0], chunk[1]]) as f64 / 32768.0,
            24 => {
                let raw = (chunk[0] as i32) | ((chunk[1] as i32) << 8) | ((chunk[2] as i32) << 16);
                // Sign-extend the 24-bit value.
                let signed = (raw << 8) >> 8;
                signed as f64 / 8_388_608.0
            }
            32 => {
                i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f64
                    / 2_147_483_648.0
            }
            _ => 0.0,
        };
        let mag = norm.abs();
        if mag > peak {
            peak = mag;
        }
        if peak > THRESHOLD {
            return false;
        }
    }
    peak <= THRESHOLD
}

// ===========================================================================
// Blender character validator (`blender-character`).
//
// The authoritative output is the emitted `character.glb` (a skinned, animated glTF
// 2.0) the model's `build.py` exports — NEVER an operation-log replay. The validator
// decodes the glTF's JSON header to confirm a skinned mesh is present and collects the
// animation names, reconciles them against the required set, and — for provenance —
// re-runs `build.py` through the `tcab-blend` runner and compares the re-exported glTF
// to the run's. This is the emitted-file-authoritative model (like the voxel/skinned
// kinds); the provenance re-run is the Blender analogue of the sprite cheat-divergence
// signal, recorded rather than gated.
// ===========================================================================

/// A validator for the Blender character kind (`blender-character`). See the module
/// comment above.
#[derive(Debug, Clone, Default)]
pub struct BlenderGenValidator;

impl BlenderGenValidator {
    /// A new Blender validator. It keeps no state.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for BlenderGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        // A Blender character run has no target model, so references are unused here.
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);
        let kind = test_case.asset_kind;
        // A character deforms one skinned mesh; a prop/mechanism emits a static or
        // rigidly-parented glTF with no skin. A prop is static (no `[model]`); a character
        // and a mechanism reconcile the emitted glTF against required animations.
        let expect_skin = kind.blender_is_skinned();
        let animated = kind.blender_is_animated();

        let (Some(bounds), Some(tool), Some(output)) = (
            test_case.voxel_for(variant),
            test_case.tool.as_ref(),
            test_case.output.as_ref(),
        ) else {
            return Ok(failed_load(
                "Blender validation requires [voxel], [tool], and [output]",
                None,
                None,
                proof_results,
            ));
        };
        // The `[model]` table is required for the animated members and absent for a prop.
        let model = test_case.model.as_ref();
        if animated && model.is_none() {
            return Ok(failed_load(
                "an animated Blender case requires a [model] table of required animations",
                None,
                None,
                proof_results,
            ));
        }
        if let Err(err) = test_cabinet_model_core::PreviewBackground::parse(&bounds.background) {
            return Ok(failed_load(
                &format!("invalid bounding-box background: {err}"),
                None,
                None,
                proof_results,
            ));
        }

        let mesh_rel = kind
            .blender_mesh_dest()
            .unwrap_or(crate::test_case::BLENDER_MESH_DEST);
        let mesh_path = repo.join(mesh_rel);

        // Decode the emitted glTF header. A missing or malformed glTF is a failed load
        // (the run produced nothing scorable), mirroring the other emitted-data kinds.
        let summary = match read_glb_summary(&mesh_path) {
            Ok(summary) => summary,
            Err(detail) => {
                return Ok(failed_load(
                    &format!("emitted `{mesh_rel}` is not a readable glTF: {detail}"),
                    None,
                    None,
                    proof_results,
                ));
            }
        };

        let mut run_notes: Vec<String> = Vec::new();
        if summary.mesh_count == 0 {
            run_notes.push("the emitted glTF carries no mesh".to_string());
        }
        // Only a character must be skinned. A prop/mechanism deliberately carries no skin
        // (a static or rigidly-parented glTF), so a missing skin is expected there.
        if expect_skin && !summary.skins_present {
            run_notes.push("the emitted glTF carries no skin (no skeleton-bound mesh)".to_string());
        }

        // Reconcile the produced animations against the required set: each required
        // animation must be present in the emitted glTF and actually animate (carry
        // channels). A gap is recorded in the run-level detail — not gated. A static prop
        // declares no animations, so this is skipped.
        if let Some(model) = model {
            let produced: std::collections::HashSet<&str> =
                summary.animation_names.iter().map(String::as_str).collect();
            for animation in &model.animations {
                if !produced.contains(animation.name.as_str()) {
                    run_notes.push(format!(
                        "required animation `{}` is missing from the emitted glTF (or animates \
                         nothing)",
                        animation.name
                    ));
                }
            }

            // Reconcile the required **caller joints** — the game-facing procedural DOFs
            // (`turret_yaw`) — against the DOFs the model tagged into the emitted glTF's
            // node `extras` (`tcab_joint`). Each required joint must be present with the
            // right kind (rotation/translation) and axis so a game can find and drive it.
            // A missing or mis-typed DOF is a recorded contract-gap note — not gated, the
            // same pattern as the animation reconciliation above.
            for joint in model
                .joints
                .iter()
                .filter(|j| j.drive == crate::test_case::DriveKindSpec::Caller)
            {
                match summary.caller_joints.iter().find(|t| t.name == joint.name) {
                    None => run_notes.push(format!(
                        "required caller DOF `{}` is not exposed in the emitted glTF (no node \
                         carries a `tcab_joint` extras tag with that name) — a game cannot drive it",
                        joint.name
                    )),
                    Some(tagged) => {
                        let want_kind = joint_kind_str(joint.kind);
                        let want_axis = axis_str(joint.axis);
                        if tagged.kind.as_deref() != Some(want_kind) {
                            run_notes.push(format!(
                                "caller DOF `{}` is exposed as kind `{}` but the case requires `{want_kind}`",
                                joint.name,
                                tagged.kind.as_deref().unwrap_or("<unset>")
                            ));
                        }
                        if tagged.axis.as_deref() != Some(want_axis) {
                            run_notes.push(format!(
                                "caller DOF `{}` is exposed on axis `{}` but the case requires `{want_axis}`",
                                joint.name,
                                tagged.axis.as_deref().unwrap_or("<unset>")
                            ));
                        }
                    }
                }
            }
        }

        // Provenance: re-run the authored `build.py` through `tcab-blend` and compare the
        // re-exported glTF to the run's. Divergence is recorded, not gated (the Blender
        // analogue of cheat-divergence). Absent runner/Blender (e.g. a host without the
        // image) is skipped silently rather than noted.
        match rerun_provenance(repo, tool, output, mesh_rel, &summary) {
            Ok(Some(note)) => run_notes.push(note),
            Ok(None) => {}
            Err(detail) => {
                run_notes.push(format!(
                    "provenance re-run could not be performed: {detail}"
                ));
            }
        }

        // The single part points the 3D viewer at the emitted glTF; the viewer plays the
        // glTF-native animations and (for a character) skins the one mesh. Named
        // `character` for a character, `model` for a prop/mechanism.
        let part = VoxelPartResult {
            name: if expect_skin { "character" } else { "model" }.to_string(),
            mesh: rel_string(Path::new(mesh_rel)),
            preview_image: rel_string(&tool.preview),
            ops_log: rel_string(&output.actions),
            operation_count: 0,
            voxel_count: 0,
            detail: None,
        };

        Ok(ValidationSummary {
            // A positive load is a well-formed glTF with at least one mesh; a character
            // must additionally carry a skin.
            loaded: summary.mesh_count > 0 && (!expect_skin || summary.skins_present),
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: Some(VoxelGenResult {
                parts: vec![part],
                // The required animations (the scoring targets); `None` for a static prop.
                model: model.cloned(),
                // A Blender run carries its rig/animations in the glTF itself, not a
                // separate `rig.json`, so there is no parsed rig doc to surface here.
                rig: None,
                // Only a character deforms one mesh by a skeleton; a prop/mechanism is
                // rigid, so the viewer does not skin it.
                skinned: expect_skin,
                // The emitted glTF carries its own baked animations (or is static): the
                // viewer loads it with a native glTF player rather than posing from a
                // `rig.json`.
                blender: true,
                detail: (!run_notes.is_empty()).then(|| run_notes.join("; ")),
            }),
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        })
    }
}

/// A minimal decode of a glTF 2.0 container's JSON header — enough to validate a
/// Blender character run without a glTF dependency: whether it carries a skinned mesh
/// and which animations it defines. Works for both a binary `.glb` (magic + JSON chunk)
/// and a text `.gltf` (raw JSON).
struct GlbSummary {
    mesh_count: usize,
    skins_present: bool,
    /// The names of animations that actually animate (carry at least one channel).
    animation_names: Vec<String>,
    /// The runtime-drivable **caller DOFs** the model tagged into node `extras`
    /// (`tcab_joint`) — the game-facing procedural interface. Reconciled against the
    /// case's required caller joints.
    caller_joints: Vec<GltfJointTag>,
}

/// The glTF JSON header fields the validator reads. Everything else is ignored.
#[derive(serde::Deserialize)]
struct GltfHeader {
    #[serde(default)]
    meshes: Vec<serde_json::Value>,
    #[serde(default)]
    skins: Vec<serde_json::Value>,
    #[serde(default)]
    animations: Vec<GltfAnimationHeader>,
    /// The scene nodes, read only for their `extras.tcab_joint` DOF tags.
    #[serde(default)]
    nodes: Vec<GltfNodeHeader>,
}

#[derive(serde::Deserialize)]
struct GltfAnimationHeader {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    channels: Vec<serde_json::Value>,
}

/// A glTF node, read only for the `tcab_joint` DOF descriptor a Blender model bakes into
/// its `extras` (via Blender custom properties + `export_extras`).
#[derive(serde::Deserialize)]
struct GltfNodeHeader {
    #[serde(default)]
    extras: Option<GltfNodeExtras>,
}

#[derive(serde::Deserialize)]
struct GltfNodeExtras {
    #[serde(default)]
    tcab_joint: Option<GltfJointTag>,
}

/// The runtime-drivable-DOF descriptor a Blender model tags a node's `extras` with — the
/// self-contained, in-file (no sidecar, no custom extension) game-facing joint interface.
/// The validator reads the identity/kind/axis to reconcile against the required set; the
/// browser reads the same tag (plus limits) to drive the node live.
#[derive(serde::Deserialize, Clone)]
struct GltfJointTag {
    #[serde(default)]
    name: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    axis: Option<String>,
}

/// Read and summarize the glTF at `path`. Returns a human-readable error string when the
/// file is missing, is not a glTF container, or its JSON header does not parse.
fn read_glb_summary(path: &Path) -> std::result::Result<GlbSummary, String> {
    let bytes =
        std::fs::read(path).map_err(|err| format!("cannot read `{}`: {err}", path.display()))?;

    // A binary glTF begins with the magic `glTF` (0x46546C67) + version 2, then a JSON
    // chunk (type 0x4E4F534A). A text `.gltf` is raw JSON. Support both.
    const GLB_MAGIC: u32 = 0x4654_6C67;
    const JSON_CHUNK: u32 = 0x4E4F_534A;
    let json_bytes: Vec<u8> = if bytes.len() >= 12
        && u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == GLB_MAGIC
    {
        let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        if version != 2 {
            return Err(format!("unsupported glb version {version} (expected 2)"));
        }
        if bytes.len() < 20 {
            return Err("truncated glb: no JSON chunk header".to_string());
        }
        let chunk_len = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
        let chunk_type = u32::from_le_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        if chunk_type != JSON_CHUNK {
            return Err("first glb chunk is not JSON".to_string());
        }
        let end = 20usize
            .checked_add(chunk_len)
            .filter(|&end| end <= bytes.len())
            .ok_or_else(|| "glb JSON chunk length exceeds file".to_string())?;
        bytes[20..end].to_vec()
    } else {
        bytes
    };

    let header: GltfHeader = serde_json::from_slice(&json_bytes)
        .map_err(|err| format!("glTF JSON header does not parse: {err}"))?;
    let animation_names = header
        .animations
        .iter()
        .filter(|animation| !animation.channels.is_empty())
        .filter_map(|animation| animation.name.clone())
        .collect();
    // Collect the DOF tags any node carries in its `extras` (named, non-empty ones).
    let caller_joints = header
        .nodes
        .into_iter()
        .filter_map(|node| node.extras.and_then(|extras| extras.tcab_joint))
        .filter(|tag| !tag.name.trim().is_empty())
        .collect();
    Ok(GlbSummary {
        mesh_count: header.meshes.len(),
        skins_present: !header.skins.is_empty(),
        animation_names,
        caller_joints,
    })
}

/// The glTF-`extras` string form of a required joint's kind, for reconciliation against
/// the DOF a model tagged into the emitted glTF (`"rotation"` / `"translation"`).
fn joint_kind_str(kind: crate::test_case::JointKindSpec) -> &'static str {
    match kind {
        crate::test_case::JointKindSpec::Rotation => "rotation",
        crate::test_case::JointKindSpec::Translation => "translation",
    }
}

/// The glTF-`extras` string form of a required joint's axis (`"x"` / `"y"` / `"z"`).
fn axis_str(axis: crate::test_case::AxisSpec) -> &'static str {
    match axis {
        crate::test_case::AxisSpec::X => "x",
        crate::test_case::AxisSpec::Y => "y",
        crate::test_case::AxisSpec::Z => "z",
    }
}

/// Re-run the authored `build.py` through the `tcab-blend` runner in a scratch copy and
/// compare the re-exported glTF's summary to the run's. Returns `Ok(Some(note))` when the
/// re-run diverges (recorded, not gated), `Ok(None)` when it matches or the runner is not
/// available on this host (skipped silently), and `Err` when the re-run is attempted but
/// fails for an unexpected reason.
fn rerun_provenance(
    repo: &Path,
    tool: &crate::test_case::ToolSpec,
    output: &crate::test_case::OutputSpec,
    mesh_rel: &str,
    original: &GlbSummary,
) -> std::result::Result<Option<String>, String> {
    use std::process::Command;

    let scratch =
        std::env::temp_dir().join(format!("tcab-blend-provenance-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).map_err(|err| err.to_string())?;

    // The `build.py` and the seeded config are all the runner needs to rebuild.
    for rel in [
        output.actions.to_string_lossy().to_string(),
        crate::test_case::BLENDER_CONFIG_DEST.to_string(),
    ] {
        let src = repo.join(&rel);
        if src.exists() {
            let dest = scratch.join(&rel);
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&src, &dest).map_err(|err| err.to_string())?;
        }
    }

    let run = Command::new(&tool.binary).current_dir(&scratch).output();
    let outcome = match run {
        Ok(outcome) => outcome,
        // The runner is not installed on this host (e.g. validating outside the Blender
        // image): skip provenance silently rather than flag every run.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let _ = std::fs::remove_dir_all(&scratch);
            return Ok(None);
        }
        Err(err) => {
            let _ = std::fs::remove_dir_all(&scratch);
            return Err(err.to_string());
        }
    };

    let note = if !outcome.status.success() {
        Some(
            "provenance re-run of build.py failed to execute — the script may not be \
             self-contained or reproducible"
                .to_string(),
        )
    } else {
        match read_glb_summary(&scratch.join(mesh_rel)) {
            Err(_) => Some(format!(
                "provenance re-run of build.py did not reproduce {mesh_rel}"
            )),
            Ok(rebuilt) => {
                let mut original_anims = original.animation_names.clone();
                let mut rebuilt_anims = rebuilt.animation_names.clone();
                original_anims.sort();
                rebuilt_anims.sort();
                // The caller-DOF interface must reproduce too — a build.py that emits the
                // DOF tags nondeterministically is as much a provenance gap as a missing
                // animation.
                let mut original_dofs: Vec<&str> = original
                    .caller_joints
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect();
                let mut rebuilt_dofs: Vec<&str> = rebuilt
                    .caller_joints
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect();
                original_dofs.sort_unstable();
                rebuilt_dofs.sort_unstable();
                if rebuilt.mesh_count != original.mesh_count
                    || rebuilt.skins_present != original.skins_present
                    || rebuilt_anims != original_anims
                    || rebuilt_dofs != original_dofs
                {
                    Some(
                        "provenance re-run diverged from the emitted glTF — build.py may not \
                         fully author the asset it exported"
                            .to_string(),
                    )
                } else {
                    None
                }
            }
        }
    };
    let _ = std::fs::remove_dir_all(&scratch);
    Ok(note)
}

/// Dispatches validation to the validator for the case's [`TestType`]. The
/// orchestrator holds one validator, so this composes the per-type validators
/// behind the single [`Validator`] interface and keeps the run pipeline unaware
/// of the split.
#[derive(Debug, Clone)]
pub struct DispatchValidator {
    build: BuildValidator,
    asset: AssetGenValidator,
    voxel: VoxelGenValidator,
    paint: PaintGenValidator,
    particle: ParticleGenValidator,
    audio: AudioGenValidator,
    blender: BlenderGenValidator,
    adversarial: AdversarialValidator,
    performance: PerformanceValidator,
}

impl DispatchValidator {
    /// Build the dispatcher, threading the screenshot scratch directory to the
    /// end-to-end validator (the asset-generation, voxel, adversarial, and
    /// performance validators keep no scratch).
    pub fn new(screenshot_dir: impl Into<PathBuf>) -> Self {
        Self {
            build: BuildValidator::new(screenshot_dir),
            asset: AssetGenValidator::new(),
            voxel: VoxelGenValidator::new(),
            paint: PaintGenValidator::new(),
            particle: ParticleGenValidator::new(),
            audio: AudioGenValidator::new(),
            blender: BlenderGenValidator::new(),
            adversarial: AdversarialValidator::new(),
            performance: PerformanceValidator::new(),
        }
    }
}

impl Validator for DispatchValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        match test_case.test_type {
            // A full-stack run builds a program just like an end-to-end run — it
            // additionally produces its own assets, but those are build inputs, not a
            // separately-scored output — so it routes to the same build validator. A
            // game jam is the same build-and-load validation from a theme instead of
            // a spec, so it routes there too.
            TestType::EndToEnd | TestType::FullStack | TestType::GameJam => self
                .build
                .validate(test_case, variant, artifacts, references, proofs),
            // Each asset kind routes to the validator for the data it emits: the
            // voxel/mesh/skinned kinds decode `.glb` + `rig.json`; the painted
            // (`ui`/`material`) kinds decode PNG(s) + `ui.json`/`material.json`; the
            // particle kinds parse `system.json`; the audio kinds decode `clip.wav`;
            // and the 2D sprite kinds regenerate through the drawing library.
            TestType::AssetGeneration => {
                let kind = test_case.asset_kind;
                if kind.is_voxel() {
                    self.voxel
                        .validate(test_case, variant, artifacts, references, proofs)
                } else if kind.is_paint() {
                    self.paint
                        .validate(test_case, variant, artifacts, references, proofs)
                } else if kind.is_particle() {
                    self.particle
                        .validate(test_case, variant, artifacts, references, proofs)
                } else if kind.is_audio() {
                    self.audio
                        .validate(test_case, variant, artifacts, references, proofs)
                } else if kind.is_blender() {
                    self.blender
                        .validate(test_case, variant, artifacts, references, proofs)
                } else {
                    self.asset
                        .validate(test_case, variant, artifacts, references, proofs)
                }
            }
            TestType::Adversarial => self
                .adversarial
                .validate(test_case, variant, artifacts, references, proofs),
            TestType::Performance => self
                .performance
                .validate(test_case, variant, artifacts, references, proofs),
        }
    }
}

/// A run-root-relative path as a forward-slash string, matching how a
/// [`ProofResult`]'s `dest` is recorded.
fn rel_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// A validation summary for a build that never loaded, carrying whichever build
/// steps had run by the point it failed and the proof-presence results (which are
/// independent of the build).
fn failed_load(
    detail: &str,
    install: Option<StepResult>,
    build: Option<StepResult>,
    proofs: Vec<ProofResult>,
) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.to_string()),
        install,
        build,
        checks: Vec::new(),
        proofs,
        debug_scripts: Vec::new(),
        asset: None,
        voxel: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        adversarial: None,
        performance: None,
    }
}

/// One unreached [`CheckResult`] per declared check, sharing a single reason.
fn unreached(test_case: &TestCaseVersion, detail: &str) -> Vec<CheckResult> {
    test_case
        .checks
        .iter()
        .map(|check| CheckResult {
            view: check.view.clone(),
            name: check.name.clone(),
            reached: false,
            similarity: 0.0,
            detail: Some(detail.to_string()),
        })
        .collect()
}

/// Run one required build step (the manifest's `install` or `build` command) in
/// `repo`, capturing its outcome as a [`StepResult`] for the validation summary.
fn run_step(repo: &Path, command: &str) -> StepResult {
    match run_command(repo, command) {
        Ok(()) => StepResult {
            command: command.to_string(),
            succeeded: true,
            detail: None,
        },
        Err(detail) => StepResult {
            command: command.to_string(),
            succeeded: false,
            detail: Some(detail),
        },
    }
}

/// Run one build command in `repo` through a shell, returning a description of
/// any failure. The command is a manifest-declared string (for example `npm ci`
/// or `npm run build`), so it is run via `sh -c` to honor whatever form a case
/// chooses; only the produced implementation it operates on is untrusted, and
/// running its build scripts is the point.
fn run_command(repo: &Path, command: &str) -> std::result::Result<(), String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(repo)
        .output()
        .map_err(|err| format!("failed to run `{command}`: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(5).collect::<Vec<_>>().join("; ");
        Err(format!("`{command}` failed: {tail}"))
    }
}

/// A decoded image reduced to the fields the similarity score needs.
struct Image {
    width: usize,
    height: usize,
    channels: usize,
    data: Vec<u8>,
}

/// Score the similarity of a captured screenshot against a baseline in
/// `0.0..=1.0`, where `1.0` is identical.
fn score(baseline: &Path, capture: &Path) -> std::result::Result<f64, String> {
    let baseline = decode_png(baseline)?;
    let capture = decode_png(capture)?;
    Ok(image_similarity(&baseline, &capture))
}

/// Decode a PNG into raw bytes plus its dimensions and channel count.
fn decode_png(path: &Path) -> std::result::Result<Image, String> {
    let file = File::open(path).map_err(|err| format!("opening {}: {err}", path.display()))?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("decoding {}: {err}", path.display()))?;
    let mut data = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut data)
        .map_err(|err| format!("reading {}: {err}", path.display()))?;
    data.truncate(info.buffer_size());
    Ok(Image {
        width: info.width as usize,
        height: info.height as usize,
        channels: info.color_type.samples(),
        data,
    })
}

/// Mean per-channel similarity over the overlapping RGB pixels of two images.
///
/// The score is `1 - meanAbsoluteDifference / 255` across the red, green, and
/// blue channels of the top-left overlap, so identical images score `1.0` and
/// fully inverted ones score `0.0`. Alpha is ignored. A zero-overlap pair scores
/// `0.0`.
fn image_similarity(a: &Image, b: &Image) -> f64 {
    let width = a.width.min(b.width);
    let height = a.height.min(b.height);
    if width == 0 || height == 0 {
        return 0.0;
    }
    // Compare up to three channels (RGB); a grayscale image contributes its one
    // channel against the other's first channel.
    let channels = a.channels.min(b.channels).min(3);
    if channels == 0 {
        return 0.0;
    }

    let mut total_diff: u64 = 0;
    for y in 0..height {
        let a_row = y * a.width * a.channels;
        let b_row = y * b.width * b.channels;
        for x in 0..width {
            let a_px = a_row + x * a.channels;
            let b_px = b_row + x * b.channels;
            for c in 0..channels {
                let av = a.data[a_px + c] as i64;
                let bv = b.data[b_px + c] as i64;
                total_diff += (av - bv).unsigned_abs();
            }
        }
    }

    let samples = (width * height * channels) as f64;
    let mean_diff = total_diff as f64 / samples;
    1.0 - mean_diff / 255.0
}

#[cfg(test)]
#[path = "validator.test.rs"]
mod tests;
