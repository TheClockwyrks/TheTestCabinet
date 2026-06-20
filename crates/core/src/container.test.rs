//! Tests for container runtime helpers.

use super::*;

#[test]
fn parent_dir_returns_the_directory_of_a_nested_path() {
    assert_eq!(
        parent_dir("/home/node/.codex/auth.json"),
        Some("/home/node/.codex"),
    );
    assert_eq!(parent_dir("/home/node/.claude.json"), Some("/home/node"));
}

#[test]
fn parent_dir_is_none_for_a_root_level_file() {
    // A file directly under the filesystem root has no directory to create.
    assert_eq!(parent_dir("/auth.json"), None);
    assert_eq!(parent_dir("auth.json"), None);
}
