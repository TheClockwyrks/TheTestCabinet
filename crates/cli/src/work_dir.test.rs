//! Tests for staging-directory resolution.

use std::path::PathBuf;

use super::{DEFAULT_DIR_NAME, resolve};

#[test]
fn override_wins_over_everything() {
    let resolved = resolve(
        Some(PathBuf::from("/explicit/work")),
        Some("/env/work".into()),
        Some(PathBuf::from("/home/me")),
        PathBuf::from("/tmp"),
    );
    assert_eq!(resolved, PathBuf::from("/explicit/work"));
}

#[test]
fn env_wins_over_home_when_no_override() {
    let resolved = resolve(
        None,
        Some("/env/work".into()),
        Some(PathBuf::from("/home/me")),
        PathBuf::from("/tmp"),
    );
    assert_eq!(resolved, PathBuf::from("/env/work"));
}

#[test]
fn empty_env_is_ignored() {
    // An exported-but-empty `TCAB_WORK_DIR` must not collapse the staging path to
    // the filesystem root; it falls through to the home default.
    let resolved = resolve(
        None,
        Some("".into()),
        Some(PathBuf::from("/home/me")),
        PathBuf::from("/tmp"),
    );
    assert_eq!(resolved, PathBuf::from("/home/me").join(DEFAULT_DIR_NAME));
}

#[test]
fn falls_back_to_home_default() {
    let resolved = resolve(
        None,
        None,
        Some(PathBuf::from("/home/me")),
        PathBuf::from("/tmp"),
    );
    assert_eq!(resolved, PathBuf::from("/home/me").join(DEFAULT_DIR_NAME));
}

#[test]
fn falls_back_to_temp_without_a_home() {
    // Only when no home directory resolves does staging land under the temp
    // directory, the last resort.
    let resolved = resolve(None, None, None, PathBuf::from("/tmp"));
    assert_eq!(resolved, PathBuf::from("/tmp").join("tcab"));
}
