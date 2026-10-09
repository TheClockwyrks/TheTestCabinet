use super::*;

use tempfile::TempDir;

/// Write a file, creating parent directories.
fn write(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the parent is created");
    std::fs::write(path, contents).expect("the file is written");
}

/// A version folder holding a manifest and a nested file.
fn version() -> TempDir {
    let dir = TempDir::new().expect("a temporary directory");
    write(&dir.path().join("test-case.toml"), "slug = \"alpha\"\n");
    write(&dir.path().join("specs/game.md"), "# Game\n");
    dir
}

#[test]
fn the_digest_is_sha256_hex_and_stable_across_reads() {
    let dir = version();
    let first = digest_version(dir.path(), &[]).expect("digest");
    assert_eq!(first.len(), 64);
    assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(first, digest_version(dir.path(), &[]).expect("digest"));
}

#[test]
fn the_digest_is_independent_of_where_the_folder_lives() {
    let a = version();
    let b = version();
    assert_eq!(
        digest_version(a.path(), &[]).expect("digest"),
        digest_version(b.path(), &[]).expect("digest")
    );
}

#[test]
fn editing_renaming_adding_or_removing_a_file_moves_the_digest() {
    let dir = version();
    let before = digest_version(dir.path(), &[]).expect("digest");

    write(&dir.path().join("specs/game.md"), "# Game!\n");
    let edited = digest_version(dir.path(), &[]).expect("digest");
    assert_ne!(before, edited);

    std::fs::rename(
        dir.path().join("specs/game.md"),
        dir.path().join("specs/rules.md"),
    )
    .expect("rename");
    let renamed = digest_version(dir.path(), &[]).expect("digest");
    assert_ne!(edited, renamed);

    write(&dir.path().join("extra.txt"), "");
    let added = digest_version(dir.path(), &[]).expect("digest");
    assert_ne!(renamed, added);

    std::fs::remove_file(dir.path().join("extra.txt")).expect("remove");
    assert_eq!(renamed, digest_version(dir.path(), &[]).expect("digest"));
}

#[test]
fn moving_bytes_between_a_path_and_its_contents_moves_the_digest() {
    let a = TempDir::new().expect("a temporary directory");
    write(&a.path().join("ab"), "c");
    let b = TempDir::new().expect("a temporary directory");
    write(&b.path().join("a"), "bc");
    assert_ne!(
        digest_version(a.path(), &[]).expect("digest"),
        digest_version(b.path(), &[]).expect("digest")
    );
}

#[test]
fn hidden_entries_are_skipped_except_the_dotfiles_a_case_ships() {
    let dir = version();
    let before = digest_version(dir.path(), &[]).expect("digest");

    write(&dir.path().join(".DS_Store"), "noise");
    write(&dir.path().join(".git/HEAD"), "ref");
    assert_eq!(before, digest_version(dir.path(), &[]).expect("digest"));

    write(&dir.path().join(".gitignore"), "node_modules\n");
    assert_ne!(before, digest_version(dir.path(), &[]).expect("digest"));
}

#[cfg(unix)]
#[test]
fn a_symlink_contributes_its_target() {
    let dir = version();
    std::os::unix::fs::symlink("specs", dir.path().join("link")).expect("symlink");
    let first = digest_version(dir.path(), &[]).expect("digest");
    std::fs::remove_file(dir.path().join("link")).expect("remove");
    std::os::unix::fs::symlink("elsewhere", dir.path().join("link")).expect("symlink");
    assert_ne!(first, digest_version(dir.path(), &[]).expect("digest"));
}

#[test]
fn a_suite_manifest_outside_the_version_folder_is_covered() {
    let suite = TempDir::new().expect("a temporary directory");
    let manifest = suite.path().join("suite.toml");
    write(&manifest, "name = \"Carom\"\n");
    write(
        &suite.path().join("versions/v1.0.0/description.md"),
        "One\n",
    );
    write(
        &suite.path().join("versions/v1.1.0/description.md"),
        "Two\n",
    );
    let v1 = suite.path().join("versions/v1.0.0");
    let v2 = suite.path().join("versions/v1.1.0");

    let before = (
        suite_version_digest(&v1, &manifest).expect("digest"),
        suite_version_digest(&v2, &manifest).expect("digest"),
    );
    write(&manifest, "name = \"Carom Deluxe\"\n");
    let after = (
        suite_version_digest(&v1, &manifest).expect("digest"),
        suite_version_digest(&v2, &manifest).expect("digest"),
    );
    assert_ne!(before.0, after.0, "every version of the suite moves");
    assert_ne!(before.1, after.1, "every version of the suite moves");
}

#[test]
fn the_reference_builds_lockfile_is_covered_whether_or_not_it_exists() {
    let checkout = TempDir::new().expect("a temporary directory");
    let folder = checkout
        .path()
        .join("test-cases/end-to-end/easy/alpha/v1.0.0");
    write(&folder.join("test-case.toml"), "slug = \"alpha\"\n");

    let absent = authored_version_digest(&folder, checkout.path()).expect("digest");
    let lock = checkout
        .path()
        .join("test-cases")
        .join(REFERENCE_LOCK_FILENAME);
    write(&lock, "{}");
    let present = authored_version_digest(&folder, checkout.path()).expect("digest");
    assert_ne!(absent, present);
    write(&lock, "{\"prod\":{}}");
    assert_ne!(
        present,
        authored_version_digest(&folder, checkout.path()).expect("digest")
    );
}
