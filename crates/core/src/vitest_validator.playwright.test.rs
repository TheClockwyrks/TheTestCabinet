//! Which Playwright the runner names to the validators: the package the browser
//! driver resolves, found the way Node finds it, so a baked driver's own install and a
//! repository checkout's hoisted one are both found.

use std::fs;
use std::path::Path;

use super::*;

/// Write `<dir>/node_modules/playwright/package.json` under `root`.
fn install_playwright(root: &Path, dir: &str) -> PathBuf {
    let package = root.join(dir).join("node_modules").join("playwright");
    fs::create_dir_all(&package).unwrap();
    fs::write(package.join("package.json"), r#"{"name":"playwright"}"#).unwrap();
    package
}

/// Write an empty driver script at `rel` under `root`.
fn driver(root: &Path, rel: &str) -> PathBuf {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "").unwrap();
    path
}

#[test]
fn a_baked_driver_names_the_package_installed_beside_it() {
    let root = tempfile::tempdir().unwrap();
    let package = install_playwright(root.path(), "opt/browser-driver");
    let script = driver(root.path(), "opt/browser-driver/driver.mjs");
    assert_eq!(playwright_beside(&script), Some(package));
}

#[test]
fn a_checkout_names_the_workspace_package_hoisted_to_its_root() {
    let root = tempfile::tempdir().unwrap();
    let package = install_playwright(root.path(), "");
    let script = driver(root.path(), "packages/browser-driver/driver.mjs");
    assert_eq!(playwright_beside(&script), Some(package));
}

#[test]
fn the_nearest_package_wins_as_node_resolves_it() {
    let root = tempfile::tempdir().unwrap();
    install_playwright(root.path(), "");
    let nearest = install_playwright(root.path(), "packages/browser-driver");
    let script = driver(root.path(), "packages/browser-driver/driver.mjs");
    assert_eq!(playwright_beside(&script), Some(nearest));
}

#[test]
fn a_directory_without_a_package_json_is_not_a_package() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("node_modules/playwright")).unwrap();
    let script = driver(root.path(), "driver.mjs");
    // The ancestors above the temp dir belong to the host, so the assertion is only
    // that the empty directory beside the script is never the answer.
    assert_ne!(
        playwright_beside(&script),
        Some(root.path().join("node_modules/playwright")),
    );
}

// Sound because nextest runs each test in its own process, so a variable set here
// cannot leak into a test running beside this one.

#[test]
fn the_runner_names_the_package_its_browser_driver_resolves() {
    let root = tempfile::tempdir().unwrap();
    let package = install_playwright(root.path(), "opt/browser-driver");
    let script = driver(root.path(), "opt/browser-driver/driver.mjs");
    unsafe {
        std::env::remove_var(PLAYWRIGHT_ENV);
        std::env::set_var("TCAB_BROWSER_DRIVER", &script);
    }
    assert_eq!(runner_playwright(), Some(package));
}

#[test]
fn an_explicit_package_in_the_runners_environment_wins() {
    let root = tempfile::tempdir().unwrap();
    install_playwright(root.path(), "opt/browser-driver");
    let script = driver(root.path(), "opt/browser-driver/driver.mjs");
    unsafe {
        std::env::set_var(PLAYWRIGHT_ENV, "/elsewhere/playwright");
        std::env::set_var("TCAB_BROWSER_DRIVER", &script);
    }
    assert_eq!(
        runner_playwright(),
        Some(PathBuf::from("/elsewhere/playwright")),
    );
}

#[test]
fn a_runner_without_a_browser_driver_names_no_package() {
    let root = tempfile::tempdir().unwrap();
    unsafe {
        std::env::remove_var(PLAYWRIGHT_ENV);
        std::env::set_var("TCAB_BROWSER_DRIVER", root.path().join("missing.mjs"));
    }
    assert_eq!(runner_playwright(), None);
}
