use std::path::{Path, PathBuf};

use super::*;

#[test]
fn a_case_version_maps_to_its_mirrored_path_beneath_the_root() {
    let cold = ColdStorage::at("/repo", "/repo/cold-storage");
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/repo/test-cases/end-to-end/easy/carom/v2.0.0")),
        Some(PathBuf::from(
            "/repo/cold-storage/test-cases/end-to-end/easy/carom/v2.0.0/validation-baseline"
        )),
    );
}

#[test]
fn a_relative_checkout_maps_relative_version_roots() {
    let cold = ColdStorage::at("", "cold-storage");
    assert_eq!(
        cold.validation_baseline_dir(Path::new("test-cases/end-to-end/easy/carom/v2.0.0")),
        Some(PathBuf::from(
            "cold-storage/test-cases/end-to-end/easy/carom/v2.0.0/validation-baseline"
        )),
    );
}

#[test]
fn a_game_jam_reached_through_the_catalog_root_folds_its_parent_step() {
    let cold = ColdStorage::at("/repo", "/repo/cold-storage");
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/repo/test-cases/../game-jams/plot-twist/v1.0.0")),
        Some(PathBuf::from(
            "/repo/cold-storage/game-jams/plot-twist/v1.0.0/validation-baseline"
        )),
    );
}

#[test]
fn an_explicit_root_replaces_the_checkout_default() {
    let cold = ColdStorage::at("/repo", "/mnt/media");
    assert_eq!(cold.root(), Path::new("/mnt/media"));
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/repo/test-cases/asset/easy/orb/v1.0.0")),
        Some(PathBuf::from(
            "/mnt/media/test-cases/asset/easy/orb/v1.0.0/validation-baseline"
        )),
    );
}

#[test]
fn a_folder_outside_the_checkout_has_no_baseline_dir() {
    let cold = ColdStorage::at("/repo", "/repo/cold-storage");
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/elsewhere/test-cases/a/b/c/v1.0.0")),
        None
    );
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/repo/../escape/v1.0.0")),
        None
    );
    assert_eq!(cold.validation_baseline_dir(Path::new("/repo")), None);
}

// nextest runs every test in its own process, so the environment each of the two
// tests below sets is theirs alone.

#[test]
fn the_checkout_default_is_the_catalog_root_parent() {
    unsafe { std::env::remove_var(COLD_STORAGE_DIR_ENV) };
    let cold = ColdStorage::for_catalog(Path::new("/repo/test-cases"));
    assert_eq!(cold.root(), Path::new("/repo/cold-storage"));
    assert_eq!(
        ColdStorage::for_catalog(Path::new("test-cases")).root(),
        Path::new("cold-storage")
    );
}

#[test]
fn the_environment_overrides_the_root() {
    unsafe { std::env::set_var(COLD_STORAGE_DIR_ENV, "/mnt/media") };
    let cold = ColdStorage::for_checkout("/repo");
    assert_eq!(cold.root(), Path::new("/mnt/media"));
    assert_eq!(
        cold.validation_baseline_dir(Path::new("/repo/test-cases/end-to-end/easy/carom/v2.0.0")),
        Some(PathBuf::from(
            "/mnt/media/test-cases/end-to-end/easy/carom/v2.0.0/validation-baseline"
        )),
    );

    unsafe { std::env::set_var(COLD_STORAGE_DIR_ENV, "") };
    assert_eq!(
        ColdStorage::for_checkout("/repo").root(),
        Path::new("/repo/cold-storage")
    );
}

#[test]
fn normalize_folds_current_and_parent_components() {
    assert_eq!(
        normalize(Path::new("a/./b/../c")),
        Some(PathBuf::from("a/c"))
    );
    assert_eq!(normalize(Path::new("../a")), None);
    assert_eq!(normalize(Path::new("/../a")), None);
}

#[test]
fn cold_storage_is_checked_out_only_when_it_holds_more_than_git_s_own_entry() {
    let checkout = tempfile::TempDir::new().unwrap();
    let root = checkout.path().join(COLD_STORAGE_DIR);
    let cold = ColdStorage::at(checkout.path(), &root);
    // No directory at all: a checkout that never had the submodule.
    assert!(!cold.is_checked_out());
    // The empty directory git leaves for a submodule it has not fetched.
    std::fs::create_dir_all(&root).unwrap();
    assert!(!cold.is_checked_out());
    // A fetch that failed part-way can leave git's own entry and nothing else.
    std::fs::write(root.join(".git"), "gitdir: ../.git/modules/cold-storage").unwrap();
    assert!(!cold.is_checked_out());
    std::fs::create_dir_all(root.join("test-cases")).unwrap();
    assert!(cold.is_checked_out());
}
