//! Deploying a static build to Cloudflare Pages, and the command seam that runs
//! `wrangler`.
//!
//! The CLI's `tcab publish-reference` and `tcab capture-baselines` deploy a
//! reference build through [`deploy_pages_build`]; the publisher service holds its
//! own copy of the release it executes (`crates/publisher`). Both scrub a leaked
//! provider key from the built tree before it leaves the host.

use std::borrow::Cow;
use std::path::Path;

use crate::error::{Error, Result};
use crate::redact::SecretScrubber;

/// The captured result of running an external command.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    /// Whether the process exited successfully.
    pub success: bool,
    /// Captured standard output.
    pub stdout: String,
    /// Captured standard error.
    pub stderr: String,
}

impl CommandOutput {
    /// Human-readable diagnostics for a failed command, drawn from *both*
    /// streams.
    ///
    /// The publish tools disagree about where failure output goes: `git` and
    /// `gh` write to stderr, but `wrangler` prints most of its diagnostics to
    /// stdout — so a stderr-only message renders empty exactly when a deploy
    /// fails and the operator most needs to see why. Surface whatever each
    /// stream carried, labelling them only when both are non-empty, and say so
    /// explicitly when a failing command produced nothing at all.
    fn failure_details(&self) -> String {
        let stdout = self.stdout.trim();
        let stderr = self.stderr.trim();
        match (stderr.is_empty(), stdout.is_empty()) {
            (true, true) => "(no output captured)".to_string(),
            (false, true) => stderr.to_string(),
            (true, false) => stdout.to_string(),
            (false, false) => format!("{stderr}\n{stdout}"),
        }
    }
}

/// Runs external commands (`gh`, `git`, `wrangler`, ...) on behalf of a
/// publisher.
///
/// Abstracting process execution behind a trait keeps the publish orchestration
/// testable without touching the network, a real GitHub, or Cloudflare.
#[async_trait::async_trait]
pub trait CommandRunner: Send + Sync {
    /// Run `program` with `args`, optionally in `cwd`, and capture its output.
    async fn run(&self, program: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput>;
}

/// A [`CommandRunner`] that executes commands as real subprocesses.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemCommandRunner;

#[async_trait::async_trait]
impl CommandRunner for SystemCommandRunner {
    async fn run(&self, program: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput> {
        let mut command = tokio::process::Command::new(program);
        command.args(args);
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        let output = command
            .output()
            .await
            .map_err(|err| Error::Publish(format!("failed to run `{program}`: {err}")))?;
        Ok(CommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Deploy an already-built static `build_dir` to a Cloudflare Pages `project`
/// under `branch`, returning the served URL `wrangler` reports.
///
/// The Cloudflare-egress step behind a case variant's authored *reference
/// implementation* (`tcab publish-reference`, branch = `<slug>-<version>-<variant>`).
/// The publisher deploys a finished run's *playable build* the same way from its
/// own copy (`crates/publisher`, branch = the run id): both must scrub secrets
/// before the tree leaves the operator's host, and both must learn the deployed
/// URL from what wrangler reports.
///
/// The steps, in order:
///
/// 1. **Redact.** `scrub_build_dir` rewrites any leaked provider API key out of
///    every text file under `build_dir` in place, so a key the model (or an
///    author) left in a source file cannot ship to the public site through a
///    built asset.
/// 2. **Deploy.** `wrangler pages deploy <build_dir> --project-name <project>
///    --branch <branch>` is run through `runner` (a [`SystemCommandRunner`] in
///    production, a mock in tests). A non-zero exit is surfaced with whatever
///    wrangler wrote to *either* stream, since it prints most diagnostics to
///    stdout.
/// 3. **Read the URL back.** The deployed host is parsed out of wrangler's output
///    ([`parse_wrangler_url`]) rather than constructed: Cloudflare sanitizes and
///    truncates long branch-alias subdomains, so `https://<branch>.<project>.pages.dev`
///    is *not* a reliable address. The URL wrangler reports is the only truth.
pub async fn deploy_pages_build(
    runner: &impl CommandRunner,
    build_dir: &Path,
    pages_project: &str,
    branch: &str,
) -> Result<String> {
    scrub_build_dir(build_dir)?;
    let dir = build_dir
        .to_str()
        .ok_or_else(|| Error::Publish("build directory path is not valid UTF-8".to_string()))?;
    let branch_arg = format!("--branch={branch}");
    let output = runner
        .run(
            "wrangler",
            &[
                "pages",
                "deploy",
                dir,
                "--project-name",
                pages_project,
                &branch_arg,
            ],
            None,
        )
        .await?;
    if !output.success {
        return Err(Error::Publish(format!(
            "`wrangler pages deploy` failed: {}",
            output.failure_details()
        )));
    }
    parse_wrangler_url(&output.stdout)
        .or_else(|| parse_wrangler_url(&output.stderr))
        .ok_or_else(|| {
            Error::Publish(
                "could not find a deployment URL in `wrangler pages deploy` output".to_string(),
            )
        })
}

/// Extract the deployment URL `wrangler pages deploy` reports from its output.
///
/// Wrangler prints a line containing the deployment URL — for example
/// `✨ Deployment complete! Take a peek over at https://abc123.test-cabinet-runs.pages.dev`.
/// The host is sanitized/truncated by Cloudflare, so the reported URL is the only
/// reliable source; this scans for the first `https://…pages.dev` token. Returns
/// the URL with surrounding punctuation trimmed, or `None` when none is found.
pub fn parse_wrangler_url(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|token| {
        // A token may carry leading framing (an emoji, a quote) before the URL;
        // start at the scheme and trim trailing sentence punctuation.
        let start = token.find("https://")?;
        let url = token[start..].trim_end_matches(['.', ',', ')', '"', '\'']);
        if url.contains("pages.dev") {
            Some(url.to_string())
        } else {
            None
        }
    })
}

/// Redact any leaked provider API key from every text file under an
/// already-built static `build_dir` before it is deployed to the public
/// Cloudflare Pages site.
///
/// This is the Cloudflare-egress half of the publish-time secret scrub, mirroring
/// the publisher's GitHub seam: it runs on the
/// operator host, so the scrubber matches the exact key values from the
/// environment as well as any `sk-…`-shaped token. A built tree has no
/// `.gitignore` staging to lean on, so it is walked in full; binary, symlinked,
/// and unreadable entries are skipped (a key is pasted as text). Rewritten files
/// are logged.
fn scrub_build_dir(build_dir: &Path) -> Result<()> {
    let scrubber = SecretScrubber::from_host_env();
    let mut redacted = Vec::new();
    scrub_dir_recursive(build_dir, &scrubber, &mut redacted)?;
    if !redacted.is_empty() {
        tracing::warn!(
            files = ?redacted,
            "redacted leaked API key(s) from a run's playable build before deploying it publicly"
        );
    }
    Ok(())
}

/// Recursively scrub every readable UTF-8 file under `dir` in place, appending
/// the path of each file actually rewritten to `redacted`. Directories are
/// descended; symlinks are not followed (so a link cannot redirect the walk out
/// of the build tree), and non-UTF-8 or unreadable files are left untouched.
fn scrub_dir_recursive(
    dir: &Path,
    scrubber: &SecretScrubber,
    redacted: &mut Vec<String>,
) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| Error::Publish(format!("reading build directory {}: {e}", dir.display())))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| Error::Publish(format!("reading a build directory entry: {e}")))?;
        let path = entry.path();
        // `file_type` does not follow symlinks, so a symlink is neither a file
        // nor a directory here and falls through untouched.
        let file_type = entry
            .file_type()
            .map_err(|e| Error::Publish(format!("inspecting {}: {e}", path.display())))?;
        if file_type.is_dir() {
            scrub_dir_recursive(&path, scrubber, redacted)?;
        } else if file_type.is_file() {
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Cow::Owned(scrubbed) = scrubber.scrub(&contents) {
                std::fs::write(&path, scrubbed).map_err(|e| {
                    Error::Publish(format!(
                        "rewriting {} to redact a secret: {e}",
                        path.display()
                    ))
                })?;
                redacted.push(path.display().to_string());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
