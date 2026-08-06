//! Tests for the walk: what the ignore files decide, what the floor removes, and the sort
//! that makes every cap deterministic.

use std::fs;
use std::path::Path;

use super::*;

/// Lay a tree out from `(path, contents)` pairs, creating parents as needed.
fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
    let root = tempfile::tempdir().expect("a temp dir");
    for (path, contents) in files {
        write(root.path(), path, contents);
    }
    root
}

fn write(root: &Path, path: &str, contents: &str) {
    let full = root.join(path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("a parent directory");
    }
    fs::write(full, contents).expect("a written file");
}

fn paths(walk: &Walk) -> Vec<&str> {
    walk.files.iter().map(|file| file.path.as_str()).collect()
}

/// The tree's own `.gitignore` decides what is measured — not a hardcoded list of output
/// directory names, which would be both too narrow and unnecessary.
#[test]
fn the_walk_honours_the_trees_own_gitignore() {
    let root = tree(&[
        (".gitignore", "generated/\n*.bak\n"),
        ("src/main.ts", "export const a = 1;\n"),
        ("generated/huge.ts", "export const b = 2;\n"),
        ("src/main.ts.bak", "old\n"),
    ]);
    let walk = walk(root.path());
    assert_eq!(paths(&walk), vec![".gitignore", "src/main.ts"]);
    assert!(
        walk.gitignore_applied,
        "an ignore file was in play and the result must say so"
    );
}

/// A tree with no ignore file says so, because an implausibly small measurement is only
/// explicable when the reader knows whether the model's own rules shrank it.
#[test]
fn a_tree_with_no_ignore_file_records_that() {
    let root = tree(&[("index.ts", "export const a = 1;\n")]);
    assert!(!walk(root.path()).gitignore_applied);
}

/// The floor removes dependency trees, build output and lockfiles — and **counts** every
/// one, rather than dropping them silently.
#[test]
fn the_floor_removes_vendor_and_build_trees_and_counts_them() {
    let root = tree(&[
        ("src/game.ts", "export const a = 1;\n"),
        ("node_modules/three/index.js", "module.exports = {};\n"),
        ("dist/bundle.js", "console.log(1);\n"),
        ("package-lock.json", "{}\n"),
        ("src/vendor.min.js", "!function(){}();\n"),
    ]);
    let walk = walk(root.path());
    assert_eq!(paths(&walk), vec!["src/game.ts"]);
    assert_eq!(
        walk.skipped_files, 4,
        "everything the floor removes must be counted"
    );
    assert!(walk.skipped_bytes > 0);
}

/// The build-output names come from the validator's own list, so the two cannot diverge:
/// a directory the validator will serve a build out of is build output by definition.
#[test]
fn the_build_output_names_are_the_validators_own() {
    for directory in test_cabinet_core::validator::BUILD_OUTPUTS {
        let root = tree(&[
            ("src/a.ts", "export const a = 1;\n"),
            (&format!("{directory}/a.js"), "1;\n"),
        ]);
        assert_eq!(
            paths(&walk(root.path())),
            vec!["src/a.ts"],
            "`{directory}/` must be floored"
        );
    }
}

/// Files come back sorted. This is what makes *which* files a cap drops a function of the
/// tree rather than of directory order.
#[test]
fn files_come_back_in_sorted_order() {
    let root = tree(&[
        ("z.ts", "export const z = 1;\n"),
        ("a.ts", "export const a = 1;\n"),
        ("m/b.ts", "export const b = 1;\n"),
    ]);
    assert_eq!(paths(&walk(root.path())), vec!["a.ts", "m/b.ts", "z.ts"]);
}

/// The roles the front ends and the graph key off.
#[test]
fn each_file_is_given_the_role_its_extension_implies() {
    let root = tree(&[
        ("index.html", "<html></html>\n"),
        ("Cargo.toml", "[package]\nname = \"a\"\n"),
        ("package.json", "{}\n"),
        ("readme.md", "# a\n"),
        ("src/a.tsx", "export const a = 1;\n"),
        ("src/b.rs", "pub fn b() {}\n"),
    ]);
    let walk = walk(root.path());
    let roles: Vec<(&str, FileRole)> = walk
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.role))
        .collect();
    assert_eq!(
        roles,
        vec![
            ("Cargo.toml", FileRole::Manifest),
            ("index.html", FileRole::Html),
            ("package.json", FileRole::Manifest),
            ("readme.md", FileRole::Data),
            ("src/a.tsx", FileRole::Source(CodeLanguage::TypeScript)),
            ("src/b.rs", FileRole::Source(CodeLanguage::Rust)),
        ]
    );
}

/// gg's session-capture journal lives in a dotdir, and the walk never sees it. The seed-time
/// `.git/info/exclude` entry is the mechanism the design leans on; skipping hidden entries
/// is the belt to its braces, and either alone is sufficient.
#[test]
fn the_session_journal_can_never_pollute_an_analysis() {
    let root = tree(&[
        ("src/a.ts", "export const a = 1;\n"),
        (".gg/replay.ndjson", "{\"kind\":\"model_io\"}\n"),
    ]);
    assert_eq!(paths(&walk(root.path())), vec!["src/a.ts"]);
}
