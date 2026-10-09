//! The browser requirement's rule, the workspace walk, and the toolchain itself.

use std::ffi::OsStr;
use std::path::Path;

use super::*;

#[test]
fn only_one_requires_the_browser() {
    assert!(required_by(Some(OsStr::new("1"))));
    for value in ["", "0", "true", "yes", " 1", "1 "] {
        assert!(!required_by(Some(OsStr::new(value))), "{value:?}");
    }
    assert!(!required_by(None));
}

#[test]
fn a_missing_toolchain_skips_where_it_is_optional() {
    skip_or_fail(false, "nothing is installed");
}

#[test]
#[should_panic(
    expected = "TCAB_REQUIRE_BROWSER=1 requires the browser toolchain, and nothing is installed"
)]
fn a_missing_toolchain_fails_where_it_is_required() {
    skip_or_fail(true, "nothing is installed");
}

/// Make each of `directories` under `root`, and write each of `files` empty.
fn tree(root: &Path, directories: &[&str], files: &[&str]) {
    for directory in directories {
        std::fs::create_dir_all(root.join(directory)).expect("the directory is made");
    }
    for file in files {
        std::fs::write(root.join(file), "{}").expect("the file is written");
    }
}

#[test]
fn the_workspace_is_the_repository_root_above_a_crate() {
    let root = tempfile::tempdir().expect("a temporary directory");
    tree(
        root.path(),
        &[".git", "node_modules", "crates/core/src"],
        &["package.json"],
    );
    assert_eq!(
        workspace_node_modules(&root.path().join("crates/core")),
        Some(
            root.path()
                .join("node_modules")
                .canonicalize()
                .expect("canonical")
        )
    );
}

#[test]
fn the_nearest_workspace_wins() {
    let root = tempfile::tempdir().expect("a temporary directory");
    tree(
        root.path(),
        &[".git", "node_modules", "crates/core/node_modules"],
        &["package.json", "crates/core/package.json"],
    );
    assert_eq!(
        workspace_node_modules(&root.path().join("crates/core")),
        Some(
            root.path()
                .join("crates/core/node_modules")
                .canonicalize()
                .expect("canonical")
        )
    );
}

#[test]
fn a_package_json_without_an_install_is_passed_over() {
    let root = tempfile::tempdir().expect("a temporary directory");
    tree(
        root.path(),
        &[".git", "node_modules", "crates/core"],
        &["package.json", "crates/core/package.json"],
    );
    assert_eq!(
        workspace_node_modules(&root.path().join("crates/core")),
        Some(
            root.path()
                .join("node_modules")
                .canonicalize()
                .expect("canonical")
        )
    );
}

#[test]
fn the_walk_stops_at_the_repository_root() {
    // A submodule's `.git` is a file. The superrepo around it has an installed
    // workspace, and that workspace is not the submodule's.
    let root = tempfile::tempdir().expect("a temporary directory");
    tree(
        root.path(),
        &[".git", "node_modules", "tcab/crates/core"],
        &["package.json", "tcab/.git"],
    );
    assert_eq!(
        workspace_node_modules(&root.path().join("tcab/crates/core")),
        None
    );
}

#[test]
fn a_workspace_lacking_a_package_names_it() {
    if !node_available() {
        skip_without_browser("no `node` on PATH");
        return;
    }
    let root = tempfile::tempdir().expect("a temporary directory");
    tree(
        root.path(),
        &[".git", "node_modules/vitest"],
        &["package.json", "node_modules/vitest/package.json"],
    );
    let missing = browser_workspace(root.path(), &["vitest", "@vitest/browser-playwright"])
        .expect_err("the workspace lacks two packages");
    assert!(
        missing.contains("has no @vitest/browser-playwright, playwright installed"),
        "{missing}"
    );
}

/// The canary for the browser requirement: the repository's own workspace has
/// Playwright installed and its Chromium renders a page. In the Rust gate job,
/// which requires the browser, this is what fails when the CI image loses the
/// browser or the job loses the workspace install.
#[test]
fn the_repository_workspace_launches_chromium() {
    match browser_workspace(Path::new(env!("CARGO_MANIFEST_DIR")), &["playwright"]) {
        Ok(modules) => assert!(modules.join("playwright/package.json").is_file()),
        Err(missing) => skip_without_browser(&missing),
    }
}
