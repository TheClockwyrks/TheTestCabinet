//! What a test needs to drive a real browser, and what it does when that is missing.
//!
//! Some of core's tests run a real toolchain rather than a stand-in for one: the
//! lockfile check's script under the host's `node`, and a validator project under
//! the npm workspace's Vitest and Playwright, in the Chromium that Playwright
//! launches. A developer's machine can lack any of those. Such a test then says
//! what is missing and skips, so the rest of the suite still runs.
//!
//! Where the toolchain is meant to be present, a skip is a defect. A test that
//! skips there reports a pass it did not earn, and so does every gate run after
//! it. `TCAB_REQUIRE_BROWSER=1` names such a place. With it set, a missing
//! toolchain fails the test (it panics) instead of skipping it. The Rust gate job
//! is to set it once it runs in the CI image that carries Node and Chromium
//! (`ci/images/rust-browser.Dockerfile`), which waits on `ciImageTag` pinning an
//! image run that built that image; until then it sets nothing and these tests
//! skip in CI. See the Testing section of `development/building.md`.
//!
//! The npm workspace is the one in the test's own repository: the nearest
//! ancestor of the crate's manifest directory that holds a `package.json` and a
//! `node_modules`. The walk stops at the repository's root, so it never finds a
//! workspace that belongs to a repository this one is checked out inside.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The variable that turns a missing browser toolchain from a skip into a failure.
pub const REQUIRE_BROWSER: &str = "TCAB_REQUIRE_BROWSER";

/// Whether this process requires the browser toolchain, read from
/// [`REQUIRE_BROWSER`].
pub fn browser_required() -> bool {
    required_by(std::env::var_os(REQUIRE_BROWSER).as_deref())
}

/// Whether a value of [`REQUIRE_BROWSER`] requires the toolchain. Only `1`
/// does. An unset or empty variable, `0` or any other value is a machine where
/// the toolchain is optional.
pub fn required_by(value: Option<&OsStr>) -> bool {
    value == Some(OsStr::new("1"))
}

/// Skip the calling test because `missing` names what the toolchain lacks, or
/// fail it when [`REQUIRE_BROWSER`] requires the toolchain.
///
/// The caller returns right after this call. It returns only when the test is to
/// skip:
///
/// ```ignore
/// if !node_available() {
///     test_browser::skip_without_browser("no `node` on PATH");
///     return;
/// }
/// ```
#[track_caller]
pub fn skip_without_browser(missing: &str) {
    skip_or_fail(browser_required(), missing);
}

/// [`skip_without_browser`] with the requirement given rather than read.
#[track_caller]
pub fn skip_or_fail(required: bool, missing: &str) {
    if required {
        panic!(
            "{REQUIRE_BROWSER}=1 requires the browser toolchain, and {missing}. \
             This environment is meant to carry Node, the npm workspace and \
             Playwright's Chromium (see ci/images/rust-browser.Dockerfile)."
        );
    }
    eprintln!("skipped: {missing}");
}

/// Whether the host has a `node` on its PATH.
pub fn node_available() -> bool {
    which::which("node").is_ok()
}

/// The `node_modules` of the npm workspace that `start` sits in, a crate's
/// `CARGO_MANIFEST_DIR` as a rule.
///
/// The workspace is the nearest of `start` and its ancestors that holds both a
/// `package.json` and a `node_modules` directory. The walk ends at the first
/// directory holding a `.git` entry (a directory in a checkout, a file in a
/// submodule or a worktree), which is the root of the repository `start` is in,
/// so a superrepo's workspace is never taken for this repository's.
pub fn workspace_node_modules(start: &Path) -> Option<PathBuf> {
    for directory in start.ancestors() {
        let modules = directory.join("node_modules");
        if directory.join("package.json").is_file() && modules.is_dir() {
            return modules.canonicalize().ok();
        }
        if directory.join(".git").exists() {
            return None;
        }
    }
    None
}

/// The `node_modules` of the workspace `start` sits in, when that workspace has
/// every package in `packages` installed and its Playwright launches Chromium.
/// Otherwise it is what is missing, worded for [`skip_without_browser`].
///
/// Each package is named by its directory under `node_modules`, `vitest` or
/// `@vitest/browser-playwright`, and counts as installed when its
/// `package.json` is there. `playwright` is checked whether or not it is listed,
/// since the launch goes through it.
pub fn browser_workspace(start: &Path, packages: &[&str]) -> Result<PathBuf, String> {
    if !node_available() {
        return Err("no `node` on PATH".to_string());
    }
    let Some(modules) = workspace_node_modules(start) else {
        return Err(format!(
            "no npm workspace with a node_modules above {} (run `npm ci` at the repository root)",
            start.display()
        ));
    };
    let mut wanted = packages.to_vec();
    if !wanted.contains(&"playwright") {
        wanted.push("playwright");
    }
    let absent: Vec<&str> = wanted
        .into_iter()
        .filter(|package| !modules.join(package).join("package.json").is_file())
        .collect();
    if !absent.is_empty() {
        return Err(format!(
            "{} has no {} installed (run `npm ci` at the repository root)",
            modules.display(),
            absent.join(", ")
        ));
    }
    chromium_launches(&modules)?;
    Ok(modules)
}

/// Whether the workspace's Playwright starts Chromium headless and renders a
/// page in it, the way Vitest's Playwright provider launches it. `npm ci`
/// installs Playwright without downloading a browser, so the packages alone do
/// not say a browser test can run.
pub fn chromium_launches(node_modules: &Path) -> Result<(), String> {
    const LAUNCH: &str = "\
        const { chromium } = require('playwright');\n\
        (async () => {\n\
          const browser = await chromium.launch({ headless: true });\n\
          try {\n\
            const page = await browser.newPage();\n\
            await page.setContent('<p id=\"probe\">rendered</p>');\n\
            const text = await page.textContent('#probe');\n\
            if (text !== 'rendered') throw new Error(`the probe page read ${text}`);\n\
          } finally {\n\
            await browser.close();\n\
          }\n\
        })().catch((error) => { console.error(error.message); process.exit(1); });\n";
    let workspace = node_modules.parent().unwrap_or(node_modules);
    let output = Command::new("node")
        .args(["-e", LAUNCH])
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("`node` could not be started: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let reason = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Playwright's Chromium does not launch from {} ({}). \
         Install it with scripts/ci/install-playwright-chromium.sh",
        workspace.display(),
        reason.lines().next().unwrap_or("no message").trim()
    ))
}

#[cfg(test)]
#[path = "test_browser.test.rs"]
mod tests;
