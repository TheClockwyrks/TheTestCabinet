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

/// Walk a tree the way a caller that cannot establish what the host seeded does — the
/// default, which floors nothing it is unsure of.
fn walked(root: &Path) -> Walk {
    walk(root, RootSeeding::default())
}

/// Walk a tree produced by a run whose engine seeded its own documentation at the root.
fn walked_with_engine_docs(root: &Path) -> Walk {
    walk(root, RootSeeding { engine_docs: true })
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
    let walk = walked(root.path());
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
    assert!(!walked(root.path()).gitignore_applied);
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
    let walk = walked(root.path());
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
            paths(&walked(root.path())),
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
    assert_eq!(paths(&walked(root.path())), vec!["a.ts", "m/b.ts", "z.ts"]);
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
    let walk = walked(root.path());
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
    assert_eq!(paths(&walked(root.path())), vec!["src/a.ts"]);
}

/// The engine's documentation is seeded to the run root by The Test Cabinet, so it is not the
/// model's writing — and it is markdown, large enough to move a size figure on its own.
#[test]
fn the_seeded_engine_documentation_is_floored_and_counted() {
    let root = tree(&[
        ("src/game.ts", "export const a = 1;\n"),
        ("engine/overview.md", "# the engine\n\nA frame loop.\n"),
        ("engine/api/frame.md", "# frame\n"),
    ]);
    let walk = walked_with_engine_docs(root.path());
    assert_eq!(paths(&walk), vec!["src/game.ts"]);
    assert_eq!(
        walk.skipped_files, 2,
        "the floor counts what it removes, so the provenance strip stays honest"
    );
    assert!(walk.skipped_bytes > 0);
}

/// The regression the anchoring exists to prevent. `src/engine/` is exactly the directory a
/// build writing its own frame loop creates; flooring the name `engine` at any depth would
/// delete the model's best work from every figure on the page.
#[test]
fn a_models_own_engine_directory_is_still_measured() {
    let root = tree(&[
        ("src/engine/loop.ts", "export const tick = () => {};\n"),
        ("src/engine/input.ts", "export const read = () => {};\n"),
        ("engine/frame.md", "# frame\n"),
    ]);
    let walk = walked_with_engine_docs(root.path());
    assert_eq!(
        paths(&walk),
        vec!["src/engine/input.ts", "src/engine/loop.ts"],
        "only the tree's own first segment is root-anchored"
    );
    assert_eq!(walk.skipped_files, 1);
}

/// A root-level *file* whose name happens to start with a floored directory's name is not a
/// directory, so it is kept: the check reads `dirs`, which is empty for a root-level file.
#[test]
fn a_root_level_engine_file_is_kept() {
    let root = tree(&[("engine.ts", "export const engine = 1;\n")]);
    assert_eq!(paths(&walked(root.path())), vec!["engine.ts"]);
}

/// `.vendor/` is floored **wholesale**, not child by child. All three of its children are
/// host-written — the vendored engine runtime, the case's vendored packages and the
/// host-written validation media — and a fourth added later must stay out of the authored set
/// without a second edit to the floor.
#[test]
fn the_hosts_own_tcab_directory_is_floored_wholesale() {
    let root = tree(&[
        ("src/game.ts", "export const a = 1;\n"),
        (
            ".vendor/engine/@clockwyrks/simple-2d/dist/index.js",
            "export const e = 1;\n",
        ),
        (
            ".vendor/engine/@clockwyrks/simple-2d/readme.md",
            "# simple-2d\n",
        ),
        (".vendor/packages/whatever.tgz", "not really a tarball\n"),
        (".vendor/validation/x.png.txt", "not really an image\n"),
    ]);
    let walk = walked(root.path());
    assert_eq!(paths(&walk), vec!["src/game.ts"]);
    assert_eq!(
        walk.skipped_files, 4,
        "every child of the host's own directory is removed, and counted"
    );
}

/// Until the root-anchored list existed, the engine runtime was dropped only because it
/// happens to ship under a directory called `dist`. This proves the rule rather than the
/// coincidence: a runtime shipped anywhere else is floored just the same.
#[test]
fn the_engine_runtime_is_floored_by_rule_and_not_by_its_dist_directory() {
    let root = tree(&[
        ("src/game.ts", "export const a = 1;\n"),
        (
            ".vendor/engine/@clockwyrks/simple-2d/lib/index.js",
            "export const e = 1;\n",
        ),
    ]);
    assert_eq!(paths(&walked(root.path())), vec!["src/game.ts"]);
}

/// The host's root directory is derived from the core crate's own path constants, so a
/// directory The Test Cabinet writes into a run cannot enter the authored set by being renamed
/// on one side only.
#[test]
fn the_root_floor_is_derived_from_the_hosts_own_path_constants() {
    for seeded in [
        test_cabinet_core::test_case::TCAB_ENGINE_DIR,
        test_cabinet_core::test_case::TCAB_VENDOR_DIR,
    ] {
        let first = seeded.split('/').next().expect("a first path segment");
        assert_eq!(
            first, HOST_ROOT_DIR,
            "`{seeded}` is host-written and its root `{first}` must be floored"
        );
    }
}

/// The defect the conditional exists to prevent, and the reason `engine` is not simply a
/// second entry beside `.vendor`.
///
/// A `none`-engine run seeds no documentation at the root at all — `vendor_engine` copies it
/// only for an engine that has a package to copy it from — so a top-level `engine/` on such a
/// run is, by construction, the model's own. So is one on a case that seeds a skeleton there
/// and tells the build to fill it in: for such a case the directory holds the whole
/// submission, and flooring it would report a finished build as an empty tree.
#[test]
fn a_root_engine_directory_is_kept_when_the_run_seeded_none() {
    let root = tree(&[
        ("src/main.ts", "export const a = 1;\n"),
        ("engine/loop.ts", "export const tick = () => {};\n"),
        ("engine/input.ts", "export const read = () => {};\n"),
        ("engine/src/lib.rs", "pub fn step() {}\n"),
    ]);
    let walk = walked(root.path());
    assert_eq!(
        paths(&walk),
        vec![
            "engine/input.ts",
            "engine/loop.ts",
            "engine/src/lib.rs",
            "src/main.ts",
        ],
        "nothing seeded `engine/`, so every line of it is the model's work"
    );
    assert_eq!(walk.skipped_files, 0);
}

/// The host's own directory needs no permission from the caller: `.vendor/` is a namespace The
/// Test Cabinet owns, so it is floored at the root of every tree, whatever the run seeded.
#[test]
fn the_hosts_own_directory_is_floored_whatever_the_run_seeded() {
    let root = tree(&[
        ("src/game.ts", "export const a = 1;\n"),
        (".vendor/packages/whatever.tgz", "not really a tarball\n"),
    ]);
    for walk in [walked(root.path()), walked_with_engine_docs(root.path())] {
        assert_eq!(paths(&walk), vec!["src/game.ts"]);
        assert_eq!(walk.skipped_files, 1);
    }
}
