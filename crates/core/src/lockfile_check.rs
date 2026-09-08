//! Verifying a dependency install against the tree's lockfile.
//!
//! npm treats a platform-specific optional dependency it could not fetch as one
//! that does not apply to the host: a registry blip while resolving
//! `@rolldown/binding-linux-arm64-gnu` leaves it out of `node_modules`, and `npm ci`
//! still exits zero. The tree then looks installed and fails minutes later — in the
//! build, or in a test run — with an error that reads as the model's fault. This
//! module is the check that catches it: after an install, every package the
//! lockfile declares for the host has to be on disk.
//!
//! The check is one Node script, [`LOCKFILE_CHECK_SCRIPT`], embedded here so the
//! host and the run container run the very same rules. It reads
//! `package-lock.json` from its working directory and decides what npm would have
//! placed the way npm's own tree builder does: the packages the lockfile's
//! dependency graph reaches from the project and its workspaces, leaving out the
//! classes the install command omits, an optional package whose `os`/`cpu`/`libc`
//! or `engines.node` the host fails, every package that requires such a package
//! unconditionally, and everything reachable only through one of those. It then
//! reports the paths among them that are not directories. The host side runs it
//! with `node` from the tree ([`check_tree`]); the in-container side runs the same
//! script through the runtime's exec and hands what it printed to
//! [`parse_report`].
//!
//! A tree that cannot be checked — no lockfile, an unreadable one, a lockfile
//! version with no `packages` map, or no `node` to run the script with — is
//! reported as [not checked](LockfileCheck::NotChecked) with the reason, never as a
//! failure. The check exists to catch a silently dropped package, and a tree it
//! cannot see into is accepted as it stands.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;

/// The lockfile check, verbatim. Run with `node --input-type=module -e <script> --
/// <install command>` from the tree being checked; it prints one JSON object on
/// stdout (see [`parse_report`]) and exits zero whether or not the tree checked.
pub const LOCKFILE_CHECK_SCRIPT: &str = include_str!("lockfile_check.mjs");

/// How long the check may take on the host. It stats one directory per lockfile
/// entry, so a real run is well under a second; the cap exists so a wedged `node`
/// cannot hold the install open.
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// What verifying a tree against its lockfile found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockfileCheck {
    /// The lockfile was read and every package the install should have placed was
    /// looked for. `missing` is the sorted list of package paths (relative to the
    /// tree, forward slashed) that the install did not leave on disk. Empty means
    /// the install is complete.
    Checked { missing: Vec<String> },
    /// The tree could not be checked, and why. Accepted as it stands: the check
    /// learned nothing, and nothing is a fact about the install.
    NotChecked { reason: String },
}

impl LockfileCheck {
    /// The packages the check found absent, or none when the tree could not be
    /// checked.
    pub fn missing(&self) -> &[String] {
        match self {
            Self::Checked { missing } => missing,
            Self::NotChecked { .. } => &[],
        }
    }

    /// Whether the check found a declared package absent. `false` for a tree that
    /// could not be checked.
    pub fn found_missing(&self) -> bool {
        !self.missing().is_empty()
    }
}

/// The one JSON object the script prints.
#[derive(Debug, Deserialize)]
struct Report {
    checked: bool,
    #[serde(default)]
    missing: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Interpret what the script printed on stdout.
///
/// Anything that is not the script's one JSON object — an empty stdout, a crash
/// trace, a `node` that printed its own error — reads as *not checked* with the
/// text as the reason, so a check that could not run never turns into a verdict.
pub fn parse_report(stdout: &str) -> LockfileCheck {
    let text = stdout.trim();
    if text.is_empty() {
        return LockfileCheck::NotChecked {
            reason: "the lockfile check printed nothing".to_string(),
        };
    }
    // The object is the last line the script writes, and the only line it writes
    // on stdout; anything before it is a tool that shared the stream.
    let line = text.lines().last().unwrap_or(text).trim();
    match serde_json::from_str::<Report>(line) {
        Ok(Report {
            checked: true,
            missing,
            ..
        }) => LockfileCheck::Checked { missing },
        Ok(Report { reason, .. }) => LockfileCheck::NotChecked {
            reason: reason.unwrap_or_else(|| "the lockfile check gave no reason".to_string()),
        },
        Err(err) => LockfileCheck::NotChecked {
            reason: format!(
                "the lockfile check printed something other than its report ({err}): {line}"
            ),
        },
    }
}

/// Run the lockfile check over `tree` on the host with the `node` on `PATH`.
///
/// `install_command` is the case's install command as declared — a compound shell
/// line is fine — and only its flags are read, to leave out the dependency classes
/// the command itself omits. The script is handed to `node` inline rather than
/// written into the tree, so a checked tree is never left carrying a file of the
/// host's.
pub async fn check_tree(tree: &Path, install_command: &str) -> LockfileCheck {
    let child = tokio::process::Command::new("node")
        .arg("--input-type=module")
        .arg("-e")
        .arg(LOCKFILE_CHECK_SCRIPT)
        .arg("--")
        .arg(install_command)
        .current_dir(tree)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let child = match child {
        Ok(child) => child,
        Err(err) => {
            return LockfileCheck::NotChecked {
                reason: format!("could not start `node` for the lockfile check: {err}"),
            };
        }
    };
    let output = match tokio::time::timeout(CHECK_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return LockfileCheck::NotChecked {
                reason: format!("the lockfile check could not be run: {err}"),
            };
        }
        Err(_) => {
            return LockfileCheck::NotChecked {
                reason: format!(
                    "the lockfile check did not finish within {} seconds",
                    CHECK_TIMEOUT.as_secs()
                ),
            };
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return LockfileCheck::NotChecked {
            reason: format!(
                "the lockfile check exited {}: {}",
                output
                    .status
                    .code()
                    .map_or_else(|| "on a signal".to_string(), |code| code.to_string()),
                stderr.trim().lines().last().unwrap_or_default(),
            ),
        };
    }
    parse_report(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
#[path = "lockfile_check.test.rs"]
mod tests;
