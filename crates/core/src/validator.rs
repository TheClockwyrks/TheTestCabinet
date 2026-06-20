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

use crate::browser::{self, StaticServer};
use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{MediaKind, ProofFile, TestCaseVersion, TestType};
use crate::validation::{
    AssetGenResult, CheckResult, ProofResult, StepResult, ValidationSummary, Validator,
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
        })
    }
}

/// Record whether each requested proof-of-implementation artifact is present in
/// the produced tree. A proof counts as present when its `dest` exists and is a
/// non-empty file; an empty file is treated as missing, since a zero-byte capture
/// is never a usable proof.
fn proof_results(proofs: &[ProofFile], repo: &Path) -> Vec<ProofResult> {
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
/// It ignores the build pipeline entirely. Instead it reads the run's recorded
/// action log, replays it through the **same** drawing library the in-container
/// binary used ([`test_cabinet_draw::render`]) to regenerate the scored image,
/// scores that image against the seeded target (fidelity), and compares it to the
/// pixels the model left on disk (cheat divergence). Both are recorded signals,
/// not gates. The regenerated image is written into the produced tree so it is
/// collected and served alongside the action log and preview.
#[derive(Debug, Clone, Default)]
pub struct AssetGenValidator;

impl AssetGenValidator {
    /// A new asset-generation validator. It keeps no state: every output is
    /// derived from the run's own action log and written into the run's tree.
    pub fn new() -> Self {
        Self
    }
}

/// The run-root-relative path the regenerated image is written to inside the
/// produced tree. Chosen to not collide with the seeded canvas config, preview,
/// action log, or operations schema.
const REGENERATED_IMAGE: &str = "regenerated.png";

impl Validator for AssetGenValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
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

        // The action log is the authoritative output. A run that produced none —
        // or an unparseable one — has nothing to score, so it is a failed load.
        let actions_path = repo.join(&output.actions);
        let raw = match std::fs::read_to_string(&actions_path) {
            Ok(raw) => raw,
            Err(err) => {
                return Ok(failed_load(
                    &format!(
                        "could not read action log `{}`: {err}",
                        output.actions.display()
                    ),
                    None,
                    None,
                    proof_results,
                ));
            }
        };
        let operations: Vec<test_cabinet_draw::Operation> = match serde_json::from_str(&raw) {
            Ok(operations) => operations,
            Err(err) => {
                return Ok(failed_load(
                    &format!(
                        "action log `{}` is not a valid operation log: {err}",
                        output.actions.display()
                    ),
                    None,
                    None,
                    proof_results,
                ));
            }
        };

        // Regenerate the image from the log through the shared drawing library —
        // the same logic the in-container binary used — and write it into the
        // produced tree so it is collected and served.
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
        let regenerated_path = repo.join(REGENERATED_IMAGE);
        if let Err(err) =
            test_cabinet_draw::render(&canvas, &operations).encode_png(&regenerated_path)
        {
            return Ok(failed_load(
                &format!("could not write the regenerated image: {err}"),
                None,
                None,
                proof_results,
            ));
        }

        // Fidelity: score the regenerated image against the seeded target.
        let target = references
            .iter()
            .find(|reference| reference.view == "target");
        let mut notes: Vec<String> = Vec::new();
        let target_fidelity = match target {
            Some(target) if target.kind == MediaKind::Image => {
                match score(&target.media_path, &regenerated_path) {
                    Ok(similarity) => similarity,
                    Err(err) => {
                        notes.push(format!("could not score against the target: {err}"));
                        0.0
                    }
                }
            }
            Some(_) => {
                notes.push("the target reference is not an image".to_string());
                0.0
            }
            None => {
                notes.push("no target reference was provided".to_string());
                0.0
            }
        };

        // Cheat divergence: compare the regenerated image to the model's on-disk
        // preview. A high value means the model drew outside the tool. Absent or
        // unreadable preview leaves it unmeasured rather than failing the run.
        let preview_path = repo.join(&tool.preview);
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

        let target_image = target
            .map(seeded_reference_rel)
            .unwrap_or_else(|| "reference/target.png".to_string());

        Ok(ValidationSummary {
            // The run produced a scorable image: the load signal is positive.
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            asset: Some(AssetGenResult {
                regenerated_image: REGENERATED_IMAGE.to_string(),
                preview_image: rel_string(&tool.preview),
                target_image,
                actions_log: rel_string(&output.actions),
                operation_count: operations.len(),
                target_fidelity,
                cheat_divergence,
                detail: (!notes.is_empty()).then(|| notes.join("; ")),
            }),
        })
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
}

impl DispatchValidator {
    /// Build the dispatcher, threading the screenshot scratch directory to the
    /// end-to-end validator (the asset-generation validator keeps no scratch).
    pub fn new(screenshot_dir: impl Into<PathBuf>) -> Self {
        Self {
            build: BuildValidator::new(screenshot_dir),
            asset: AssetGenValidator::new(),
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
            TestType::AssetGeneration => self
                .asset
                .validate(test_case, artifacts, references, proofs),
        }
    }
}

/// The run-root-relative path a reference is seeded to: `reference/<view>.<ext>`,
/// where the extension comes from the reference's served media. Matches the
/// seeding layout so the validator can name where the seeded target lives.
fn seeded_reference_rel(reference: &RenderedReference) -> String {
    let ext = reference
        .media_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string());
    format!("reference/{}.{ext}", reference.view)
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
