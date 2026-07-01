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
use crate::browser::{self, StaticServer};
use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::performance_validator::PerformanceValidator;
use crate::reference::RenderedReference;
use crate::test_case::{
    AutoPlaySpec, AxisSpec, DriveKindSpec, JointKindSpec, JointSpec, KeyframeSpec, MediaKind,
    ModelSpec, PartSpec, ProofFile, TestCaseVersion, TestType,
};
use crate::validation::{
    AssetFrameResult, AssetGenResult, CheckResult, ProofResult, StepResult, ValidationSummary,
    Validator, VoxelGenResult, VoxelPartResult,
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
        Ok(ValidationSummary {
            loaded: true,
            detail,
            install: Some(install),
            build: Some(build),
            checks,
            proofs: proof_results,
            asset: None,
            voxel: None,
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
            asset: Some(AssetGenResult {
                frames,
                // Carry the sprite-sheet frame dims and sequences (when this case
                // draws one) into the run record so the review UI can play the named
                // sequences from the per-frame images directly.
                sheet: test_case.sheet.clone(),
                detail: None,
            }),
            voxel: None,
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
/// operation log, replays it through the **same** voxel library the in-container
/// binary used ([`test_cabinet_voxel::render`]) to regenerate the voxel data
/// (`voxels.json`, what the client renders in 3D) and the isometric preview PNG,
/// and compares the PNG to the one the model left on disk (cheat divergence). A
/// voxel run has no target model: the regenerated data is what a human reviews
/// against the brief, and cheat divergence is the one recorded signal — not a gate.
/// A static model ([`AssetKind::VoxelModel`](crate::test_case::AssetKind::VoxelModel))
/// has one target named `model`; an animated model
/// ([`AssetKind::VoxelAnimation`](crate::test_case::AssetKind::VoxelAnimation)) has
/// one per declared part. For an animated model it additionally reads the
/// model-written `rig.json`, records it as the produced rig, and reconciles it
/// against the manifest's required rig — a missing required part or joint is
/// recorded in the run-level detail, never a crash.
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

/// The per-part plan the validator regenerates: where this part's recorded log and
/// preview live, and where its regenerated voxel data and image are written.
struct PartPlan {
    name: String,
    ops_rel: PathBuf,
    preview_rel: PathBuf,
    regenerated_png_rel: String,
    regenerated_voxels_rel: String,
}

impl Validator for VoxelGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        // A voxel run has no target model, so references — the browser-rendered
        // baselines other types score against — are unused here.
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        let proof_results = proof_results(proofs, repo);

        // The orchestrator only routes voxel cases here, so the tables are present;
        // guard the invariant rather than panicking.
        let (Some(voxel_spec), Some(tool), Some(output)) = (
            test_case.voxel.as_ref(),
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

        let background = match test_cabinet_voxel::PreviewBackground::parse(&voxel_spec.background)
        {
            Ok(background) => background,
            Err(err) => {
                return Ok(failed_load(
                    &format!("invalid voxel background: {err}"),
                    None,
                    None,
                    proof_results,
                ));
            }
        };
        let dims = test_cabinet_voxel::Dims {
            width: voxel_spec.width,
            height: voxel_spec.height,
            depth: voxel_spec.depth,
        };

        // One target for a static model (named `model`); one per declared part for
        // an animated model, each with its own log, preview, regenerated data, and
        // regenerated image.
        let plans: Vec<PartPlan> = match test_case.model.as_ref() {
            None => vec![PartPlan {
                name: "model".to_string(),
                ops_rel: output.actions.clone(),
                preview_rel: tool.preview.clone(),
                regenerated_png_rel: "regenerated.png".to_string(),
                regenerated_voxels_rel: "voxels.json".to_string(),
            }],
            Some(model) => model
                .parts
                .iter()
                .map(|part| PartPlan {
                    name: part.name.clone(),
                    ops_rel: crate::test_case::part_path(&output.actions, &part.name),
                    preview_rel: crate::test_case::part_path(&tool.preview, &part.name),
                    regenerated_png_rel: format!("regenerated/{}.png", part.name),
                    regenerated_voxels_rel: format!("voxels/{}.json", part.name),
                })
                .collect(),
        };

        let is_anim = test_case.model.is_some();
        let mut parts = Vec::with_capacity(plans.len());
        for plan in &plans {
            match score_part(repo, dims, background, plan) {
                Ok(part) => parts.push(part),
                // A static model with no scorable output is a failed load (mirrors
                // the sprite validator). For an animated model one bad part must not
                // sink the whole run: record it zero-scored and carry on, so a
                // missing required part is a recorded gap rather than a crash.
                Err(detail) => {
                    if is_anim {
                        parts.push(VoxelPartResult {
                            name: plan.name.clone(),
                            regenerated_voxels: plan.regenerated_voxels_rel.clone(),
                            regenerated_image: plan.regenerated_png_rel.clone(),
                            preview_image: rel_string(&plan.preview_rel),
                            ops_log: rel_string(&plan.ops_rel),
                            operation_count: 0,
                            voxel_count: 0,
                            cheat_divergence: None,
                            detail: Some(detail),
                        });
                    } else {
                        return Ok(failed_load(&detail, None, None, proof_results));
                    }
                }
            }
        }

        // For an animated model, read the produced rig and reconcile it against the
        // required rig. A missing/unreadable `rig.json`, and any required part or
        // joint absent from it, is recorded in the run-level detail — not gated.
        let mut run_notes: Vec<String> = Vec::new();
        let produced_rig = if is_anim {
            match read_rig(repo) {
                Ok(rig) => Some(rig),
                Err(detail) => {
                    run_notes.push(detail);
                    None
                }
            }
        } else {
            None
        };
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
            asset: None,
            voxel: Some(VoxelGenResult {
                parts,
                // The required rig (the scoring targets) for an animated model.
                model: test_case.model.clone(),
                // The full rig the model actually produced (`rig.json`).
                rig: produced_rig,
                detail: (!run_notes.is_empty()).then(|| run_notes.join("; ")),
            }),
            adversarial: None,
            performance: None,
        })
    }
}

/// Regenerate one part's voxel data and preview and measure its cheat divergence.
///
/// Returns `Err` with a fatal reason when the operation log cannot be parsed or its
/// outputs cannot be written — the caller maps that to a failed load (static) or a
/// zero-scored part (animated). A missing log is treated as an empty part (with a
/// note), and a missing preview leaves the divergence unmeasured (a note), so a
/// model that simply never sculpted a part is recorded rather than failed.
fn score_part(
    repo: &Path,
    dims: test_cabinet_voxel::Dims,
    background: test_cabinet_voxel::PreviewBackground,
    plan: &PartPlan,
) -> std::result::Result<VoxelPartResult, String> {
    let ops_path = repo.join(&plan.ops_rel);
    let (operations, mut notes) = match std::fs::read_to_string(&ops_path) {
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

    // Write the regenerated voxel data (what the 3D client renders) into the tree.
    let voxels_path = repo.join(&plan.regenerated_voxels_rel);
    if let Some(parent) = voxels_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    std::fs::write(&voxels_path, format!("{}\n", set.to_voxels_json()))
        .map_err(|err| format!("could not write the regenerated voxel data: {err}"))?;

    // Regenerate the isometric preview from the same rasterizer the binary used and
    // write it into the produced tree so it is collected and served.
    let regenerated_path = repo.join(&plan.regenerated_png_rel);
    if let Some(parent) = regenerated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    let png_bytes =
        test_cabinet_voxel::rasterize(&set, &test_cabinet_voxel::Camera::PREVIEW, background);
    std::fs::write(&regenerated_path, &png_bytes)
        .map_err(|err| format!("could not write the regenerated image: {err}"))?;

    // Cheat divergence: compare the regenerated preview to the model's on-disk one.
    // A high value means the model wrote pixels the tool would not. Absent or
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

    Ok(VoxelPartResult {
        name: plan.name.clone(),
        regenerated_voxels: plan.regenerated_voxels_rel.clone(),
        regenerated_image: plan.regenerated_png_rel.clone(),
        preview_image: rel_string(&plan.preview_rel),
        ops_log: rel_string(&plan.ops_rel),
        operation_count: operations.len(),
        voxel_count: set.occupied_count(),
        cheat_divergence,
        detail: (!notes.is_empty()).then(|| notes.join("; ")),
    })
}

/// Read the model-written `rig.json` and convert it into a [`ModelSpec`] superset
/// (the full produced rig — required parts/joints plus any the model added).
fn read_rig(repo: &Path) -> std::result::Result<ModelSpec, String> {
    let rig_path = repo.join(crate::test_case::VOXEL_RIG_DEST);
    let raw = std::fs::read_to_string(&rig_path).map_err(|err| {
        format!(
            "could not read `{}`: {err}",
            crate::test_case::VOXEL_RIG_DEST
        )
    })?;
    let rig: test_cabinet_voxel::Rig = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "`{}` is not a valid rig: {err}",
            crate::test_case::VOXEL_RIG_DEST
        )
    })?;
    Ok(rig_to_model_spec(&rig))
}

/// Convert the voxel binary's on-disk [`Rig`](test_cabinet_voxel::Rig) into the
/// contract [`ModelSpec`] carried in the run record.
fn rig_to_model_spec(rig: &test_cabinet_voxel::Rig) -> ModelSpec {
    let parts = rig
        .parts
        .iter()
        .map(|part| PartSpec {
            name: part.name.clone(),
            parent: part.parent.clone(),
            pivot: part.pivot,
        })
        .collect();
    let joints = rig
        .joints
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
            let (drive, auto) = match &joint.drive {
                test_cabinet_voxel::Drive::Caller => (DriveKindSpec::Caller, None),
                test_cabinet_voxel::Drive::AutoPlay {
                    keyframes,
                    period_ms,
                    r#loop,
                } => (
                    DriveKindSpec::Auto,
                    Some(AutoPlaySpec {
                        keyframes: keyframes
                            .iter()
                            .map(|k| KeyframeSpec {
                                t_ms: k.t_ms,
                                value: k.value,
                            })
                            .collect(),
                        period_ms: *period_ms,
                        looping: *r#loop,
                    }),
                ),
            };
            JointSpec {
                name: joint.name.clone(),
                part: joint.part.clone(),
                kind,
                axis,
                pivot: joint.pivot,
                min: joint.min,
                max: joint.max,
                rest: joint.rest,
                drive,
                auto,
            }
        })
        .collect();
    // Animations are authored playback aids carried only on the case's declared
    // model spec, never produced into `rig.json`, so the rig reconstructed here has
    // none.
    ModelSpec {
        parts,
        joints,
        animations: Vec::new(),
    }
}

/// Reconcile the produced rig against the required one, noting any required part or
/// joint the model did not produce. These are the game-facing contract's scoring
/// targets, so a missing one is recorded (in the run-level detail) rather than
/// crashing the validator.
fn reconcile_rig(required: &ModelSpec, produced: &ModelSpec, notes: &mut Vec<String>) {
    for part in &required.parts {
        if !produced.parts.iter().any(|p| p.name == part.name) {
            notes.push(format!(
                "required part `{}` is missing from the produced rig",
                part.name
            ));
        }
    }
    for joint in &required.joints {
        if !produced.joints.iter().any(|j| j.name == joint.name) {
            notes.push(format!(
                "required joint `{}` is missing from the produced rig",
                joint.name
            ));
        }
    }
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
            adversarial: AdversarialValidator::new(),
            performance: PerformanceValidator::new(),
        }
    }
}

impl Validator for DispatchValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        match test_case.test_type {
            TestType::EndToEnd => self
                .build
                .validate(test_case, artifacts, references, proofs),
            // The two 2D sprite kinds regenerate through the drawing library; the
            // two 3D voxel kinds regenerate through the voxel library.
            TestType::AssetGeneration => {
                if test_case.asset_kind.is_voxel() {
                    self.voxel
                        .validate(test_case, artifacts, references, proofs)
                } else {
                    self.asset
                        .validate(test_case, artifacts, references, proofs)
                }
            }
            TestType::Adversarial => self
                .adversarial
                .validate(test_case, artifacts, references, proofs),
            TestType::Performance => self
                .performance
                .validate(test_case, artifacts, references, proofs),
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
        asset: None,
        voxel: None,
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
