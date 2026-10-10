//! Previews over the committed fixture suite: a draft `main` copied from its
//! exported `v1.0.0`, broken one entity at a time.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;
use crate::test_engines::fixture_catalog;
use crate::test_suite::{
    SUITE_MANIFEST_FILE, SuiteVersion, load_and_validate_with, load_suite_manifest_of,
    validate_tree_with,
};

/// The committed fixture suite folder.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite/carom")
}

/// Copy a directory tree.
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination is created");
    for entry in std::fs::read_dir(from).expect("the source reads") {
        let entry = entry.expect("the entry reads");
        let target = to.join(entry.file_name());
        match entry.path().is_dir() {
            true => copy(&entry.path(), &target),
            false => {
                std::fs::copy(entry.path(), &target).expect("the file copies");
            }
        }
    }
}

/// A checkout holding the `carom` suite and a draft `main` copied from `v1.0.0`,
/// with the draft's folder.
fn draft() -> (TempDir, PathBuf) {
    let checkout = TempDir::new().expect("a temporary directory");
    let suite = checkout.path().join("carom");
    std::fs::create_dir_all(&suite).expect("the suite folder");
    std::fs::copy(
        fixture().join(SUITE_MANIFEST_FILE),
        suite.join(SUITE_MANIFEST_FILE),
    )
    .expect("the suite manifest copies");
    let draft = suite.join("drafts/main");
    copy(&fixture().join("versions/v1.0.0"), &draft);
    std::fs::write(draft.join("draft.toml"), "base = \"1.0.0\"\n").expect("the draft manifest");
    (checkout, draft)
}

/// The tree at `root` and its problems.
fn read(root: &Path) -> (PartialSuiteTree, Vec<SuiteDiagnostic>) {
    let suite = load_suite_manifest_of(root).expect("the suite manifest reads");
    let tree = PartialSuiteTree::load(&suite, root);
    let problems = validate_tree_with(root, &tree, &fixture_catalog());
    (tree, problems)
}

/// Each definition of the draft at `root`, mapped to what holds it back.
fn completeness(root: &Path) -> BTreeMap<String, Vec<SuiteDiagnostic>> {
    let (tree, problems) = read(root);
    preview_completeness_with(root, &tree, &problems, "main", &fixture_catalog())
        .into_iter()
        .map(|entry| (entry.definition, entry.problems))
        .collect()
}

/// The definitions of the draft at `root` that are incomplete.
fn incomplete(root: &Path) -> Vec<String> {
    completeness(root)
        .into_iter()
        .filter(|(_, problems)| !problems.is_empty())
        .map(|(definition, _)| definition)
        .collect()
}

/// Rewrite the file at `path`, relative to `root`, through `edit`.
fn edit(root: &Path, path: &str, edit: impl FnOnce(String) -> String) {
    let path = root.join(path);
    let text = std::fs::read_to_string(&path).expect("the file reads");
    std::fs::write(&path, edit(text)).expect("the file writes");
}

#[test]
fn every_definition_of_a_complete_draft_is_complete() {
    let (_checkout, root) = draft();
    let listed = completeness(&root);
    assert_eq!(
        listed.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "ball",
            "bounce",
            "efficiency",
            "end-to-end",
            "full-stack",
            "player-ship",
            "player-ship-walk",
            "sparks",
            "table",
            "theme",
        ]
    );
    assert!(incomplete(&root).is_empty(), "{listed:#?}");
}

#[test]
fn a_draft_with_no_reference_implementation_still_has_complete_definitions() {
    let (_checkout, root) = draft();
    std::fs::remove_dir_all(root.join("reference-implementations")).expect("removed");
    let (_, problems) = read(&root);
    assert!(
        problems
            .iter()
            .any(|problem| problem.message.contains("no reference implementation")),
        "{problems:#?}"
    );
    assert!(incomplete(&root).is_empty(), "{:#?}", completeness(&root));
}

#[test]
fn an_asset_problem_holds_back_the_definitions_referencing_that_asset_alone() {
    let (_checkout, root) = draft();
    edit(&root, "assets/ball/asset.toml", |text| {
        text.replace("files = [\"ball.vox\"]\n", "")
    });
    assert_eq!(incomplete(&root), ["ball", "end-to-end"]);
    let listed = completeness(&root);
    assert!(
        listed["ball"]
            .iter()
            .all(|problem| problem.entity == SuiteEntity::Asset("ball".to_owned())),
        "{listed:#?}"
    );
    assert!(!listed["ball"].is_empty());
}

#[test]
fn a_requirement_problem_holds_back_the_definitions_covering_its_specification() {
    let (_checkout, root) = draft();
    edit(
        &root,
        "specifications/ball-physics/spin/specification.toml",
        |text| {
            text.replace(
                "text = \"Spin MUST decay to zero over time while the ball is in motion.\"\n",
                "",
            )
        },
    );
    // `end-to-end` names `ball-spin`, `full-stack` covers every specification, and
    // `efficiency` names `ball-physics` alone.
    assert_eq!(incomplete(&root), ["end-to-end", "full-stack"]);
}

#[test]
fn a_version_manifest_problem_holds_back_every_definition() {
    let (_checkout, root) = draft();
    edit(&root, "version.toml", |text| {
        text.lines()
            .filter(|line| !line.starts_with("summary"))
            .map(|line| format!("{line}\n"))
            .collect()
    });
    let listed = completeness(&root);
    assert!(
        listed
            .values()
            .all(|problems| problems.iter().any(|p| p.entity == SuiteEntity::Suite)),
        "{listed:#?}"
    );
}

#[test]
fn a_validator_project_problem_holds_back_the_definitions_with_validators_alone() {
    let (_checkout, root) = draft();
    std::fs::remove_file(root.join("validators/vitest.config.ts")).expect("removed");
    assert_eq!(
        incomplete(&root),
        ["efficiency", "end-to-end", "full-stack"]
    );
}

#[test]
fn a_definition_that_does_not_parse_is_listed_incomplete() {
    let (_checkout, root) = draft();
    std::fs::write(root.join("test-cases/broken.toml"), "name = \n").expect("written");
    let listed = completeness(&root);
    assert!(!listed["broken"].is_empty(), "{listed:#?}");
    assert!(listed["ball"].is_empty());
}

#[test]
fn an_asset_definition_previews_with_its_asset_and_the_specification_describing_it() {
    let (_checkout, root) = draft();
    let (tree, _) = read(&root);
    let preview = preview_tree(&tree, &["ball".to_owned()], "main");

    let manifest = preview.manifest.clone().expect("the version manifest");
    assert_eq!(manifest.version.as_deref(), Some("0.0.0-preview.main"));
    assert!(manifest.experimental);
    let slugs = |cases: &[crate::test_suite::PartialTestCaseFile]| {
        cases
            .iter()
            .map(|case| case.slug.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(slugs(&preview.test_cases), ["ball"]);
    assert_eq!(
        preview
            .assets
            .iter()
            .map(|asset| asset.dir.as_str())
            .collect::<Vec<_>>(),
        ["assets/ball"]
    );
    assert_eq!(
        preview
            .flat_specifications()
            .iter()
            .map(|folder| folder.identity())
            .collect::<Vec<_>>(),
        ["assets"]
    );
    assert!(preview.debug_api.is_none());
    assert!(preview.demos.is_empty() && preview.showcase.is_none());
    assert!(preview.trees.validators.is_empty());
    assert!(preview.trees.reference_implementations.is_empty());
    assert!(preview.trees.workspaces.is_empty());

    assert_eq!(
        preview_files(&root, &preview),
        [
            "assets/ball/ball.vox",
            "changelog.md",
            "description.md",
            "prompts/voxel.hbs",
            "specifications/assets/specification.md",
        ]
    );
}

#[test]
fn a_code_producing_definition_previews_with_the_debug_api_its_validators_and_workspaces() {
    let (_checkout, root) = draft();
    let (tree, _) = read(&root);
    let preview = preview_tree(&tree, &["full-stack".to_owned()], "main");

    assert!(preview.debug_api.is_some());
    assert!(preview.assets.is_empty());
    assert_eq!(preview.flat_specifications().len(), 3);
    assert_eq!(
        preview.trees.workspaces.keys().collect::<Vec<_>>(),
        ["none", "simple-2d-e2e"]
    );
    assert!(
        preview
            .trees
            .validators
            .contains(&"validators/vitest.config.ts".to_owned())
    );
    assert!(
        preview
            .trees
            .validators
            .contains(&"validators/ball/spin-decay.test.ts".to_owned())
    );

    let files = preview_files(&root, &preview);
    for expected in [
        "prompts/full-stack.hbs",
        "workspaces/none/package.json",
        "workspaces/simple-2d-e2e/package.json",
        "specifications/ball-physics/specification.md",
        "specifications/ball-physics/spin/specification.md",
        "validators/ball/constant-speed.ts",
    ] {
        assert!(
            files.contains(&expected.to_owned()),
            "{expected}: {files:#?}"
        );
    }
    assert!(
        !files
            .iter()
            .any(|file| file.starts_with("reference-implementations/")
                || file.starts_with("showcase/")
                || file.starts_with("demos/")
                || file.starts_with("assets/")
                || file.ends_with("/specification.toml")),
        "{files:#?}"
    );

    let preview = preview_tree(&tree, &["end-to-end".to_owned()], "main");
    assert_eq!(preview.assets.len(), 7, "every asset for end-to-end");
}

#[test]
fn a_written_preview_validates_where_the_backend_reads_it() {
    let (checkout, root) = draft();
    std::fs::remove_dir_all(root.join("reference-implementations")).expect("removed");
    let (tree, problems) = read(&root);
    let complete: Vec<String> =
        preview_completeness_with(&root, &tree, &problems, "main", &fixture_catalog())
            .into_iter()
            .filter(DefinitionCompleteness::is_complete)
            .map(|entry| entry.definition)
            .collect();
    let preview = preview_tree(&tree, &complete, "main");
    assert!(
        validate_tree_with(&root, &preview, &fixture_catalog())
            .iter()
            .any(|problem| problem.message.contains("no reference implementation")),
        "an exported version is still held to declaring one"
    );
    let version: SuiteVersion = preview
        .complete_preview_with(&root, &fixture_catalog())
        .expect("the preview converts to the complete model");

    let suite_dir = checkout.path().join(".previews/carom");
    let written = suite_dir.join(preview_folder("main"));
    std::fs::create_dir_all(&written).expect("the preview folder");
    std::fs::copy(
        root.join("../../suite.toml"),
        suite_dir.join(SUITE_MANIFEST_FILE),
    )
    .expect("the suite manifest copies");
    version.save(&written).expect("the model writes");
    for file in preview_files(&root, &preview) {
        let target = written.join(&file);
        std::fs::create_dir_all(target.parent().expect("a parent")).expect("the parent");
        std::fs::copy(root.join(&file), target).expect("the file copies");
    }

    let suite = load_suite_manifest_of(&written).expect("the copy beside the preview reads");
    let (loaded, diagnostics) =
        load_and_validate_with(&suite, &written, &fixture_catalog()).expect("the preview reads");
    assert_eq!(diagnostics, Vec::new());
    assert_eq!(
        loaded.manifest.version.as_deref(),
        Some("0.0.0-preview.main")
    );
    assert!(loaded.manifest.experimental);
    assert_eq!(loaded.test_cases.len(), complete.len());
}
