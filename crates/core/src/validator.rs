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
use crate::test_case::TestCaseVersion;
use crate::validation::{CheckResult, StepResult, ValidationSummary, Validator};

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
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        if !repo.join("package.json").is_file() {
            return Ok(failed_load(
                "no package.json found in the produced implementation",
                None,
                None,
            ));
        }

        // The two required build steps run in order and are each reported in the
        // summary. Install runs first; if it fails the build step is never
        // reached, so it stays `None`.
        let install = run_step(repo, &test_case.build.install);
        if !install.succeeded {
            let detail = install.detail.clone().unwrap_or_default();
            return Ok(failed_load(&detail, Some(install), None));
        }
        let build = run_step(repo, &test_case.build.build);
        if !build.succeeded {
            let detail = build.detail.clone().unwrap_or_default();
            return Ok(failed_load(&detail, Some(install), Some(build)));
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
        })
    }
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

        match score(&baseline.image_path, &capture) {
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

/// A validation summary for a build that never loaded, carrying whichever build
/// steps had run by the point it failed.
fn failed_load(
    detail: &str,
    install: Option<StepResult>,
    build: Option<StepResult>,
) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.to_string()),
        install,
        build,
        checks: Vec::new(),
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
