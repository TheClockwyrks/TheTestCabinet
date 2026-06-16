//! Tests for host-path translation.

use std::path::Path;

use super::{mount_source, windows_drive_to_wsl};

#[test]
fn translates_backslash_drive_path_to_wsl() {
    assert_eq!(
        windows_drive_to_wsl(r"C:\Users\me\run").as_deref(),
        Some("/mnt/c/Users/me/run"),
    );
}

#[test]
fn translates_forward_slash_drive_path_to_wsl() {
    assert_eq!(
        windows_drive_to_wsl("D:/seeds/pong").as_deref(),
        Some("/mnt/d/seeds/pong"),
    );
}

#[test]
fn lowercases_only_the_drive_letter() {
    // The drive letter is case-insensitive on Windows and lowercase under
    // `/mnt`, but the rest of the path keeps its original case.
    assert_eq!(
        windows_drive_to_wsl(r"C:\Users\MixedCase\Run").as_deref(),
        Some("/mnt/c/Users/MixedCase/Run"),
    );
}

#[test]
fn leaves_posix_paths_unchanged() {
    // A POSIX absolute path never begins with a `<letter>:` drive, so it is not
    // a translation candidate.
    assert_eq!(windows_drive_to_wsl("/home/me/.tcab/seeds/pong"), None);
    assert_eq!(windows_drive_to_wsl("/var/folders/x/seed"), None);
}

#[test]
fn leaves_unc_and_drive_relative_paths_unchanged() {
    // UNC paths have no `<drive>:` prefix; drive-relative paths (`C:work`) have
    // no separator after the colon and thus no single WSL equivalent.
    assert_eq!(windows_drive_to_wsl(r"\\server\share\run"), None);
    assert_eq!(windows_drive_to_wsl("C:work"), None);
    assert_eq!(windows_drive_to_wsl("1:/not-a-drive"), None);
}

#[test]
fn mount_source_passes_posix_path_through() {
    assert_eq!(
        mount_source(Path::new("/home/me/.tcab/seeds/pong")).unwrap(),
        "/home/me/.tcab/seeds/pong",
    );
}

#[test]
fn mount_source_translates_drive_path() {
    assert_eq!(
        mount_source(Path::new(r"C:\Users\me\run")).unwrap(),
        "/mnt/c/Users/me/run",
    );
}
