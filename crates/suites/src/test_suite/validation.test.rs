//! Tests for the suite validator, one fixture per invariant.
//!
//! Each test copies the committed fixture suite into a temporary suite
//! directory, breaks exactly one invariant, and asserts both the diagnostic's
//! message and the entity it is addressed to — a diagnostic attached to the
//! wrong entity fails the test, because the address is what an editing UI turns
//! into the field it puts the user in front of.
//!
//! A break is made by adding an entity where that is possible rather than by
//! editing one the rest of the fixture names, so a test about one invariant does
//! not drag in the diagnostics of every file that referenced what it changed.

use std::path::{Path, PathBuf};

use crate::test_engines::fixture_catalog;
use crate::test_suite::*;
use test_cabinet_contracts::layout::{
    MAX_SHOWCASE_DESCRIPTION_BYTES, MAX_SHOWCASE_MEDIA_ENTRIES, MAX_SHOWCASE_MEDIA_FILE_BYTES,
};

/// The committed fixture suite version folder.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures/test-suite/carom/versions/v1.0.0")
}

/// Copy a directory tree, so no test writes into the committed fixture.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination is created");
    for entry in std::fs::read_dir(from).expect("the source is readable") {
        let entry = entry.expect("the entry is readable");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("the file is copied");
        }
    }
}

/// The suite manifest the fixture version belongs to.
const SUITE: &str = "../../suite.toml";

/// Copy the fixture suite manifest and version into a temporary
/// `carom/suite.toml` and `carom/versions/v1.0.0/`, apply one break to the version,
/// and validate the result.
///
/// The copy keeps the fixture's own directory names, so the slug and version
/// agree with the layout unless a test is about that. A break reaches the suite
/// manifest through [`SUITE`], relative to the version.
fn broken(break_it: impl FnOnce(&Path)) -> (SuiteVersion, Vec<SuiteDiagnostic>) {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    broken_at(temporary.path().join("carom/versions/v1.0.0"), break_it)
}

/// [`broken`], with the fixture version copied to `root` instead.
fn broken_at(root: PathBuf, break_it: impl FnOnce(&Path)) -> (SuiteVersion, Vec<SuiteDiagnostic>) {
    copy_tree(&fixture(), &root);
    let suite_dir = crate::test_suite::suite_dir_of(&root).expect("the tree sits in a suite");
    std::fs::copy(fixture().join(SUITE), suite_dir.join("suite.toml"))
        .expect("the suite manifest is copied");
    break_it(&root);
    let suite = crate::test_suite::load_suite_manifest_of(&root).expect("the suite manifest loads");
    load_and_validate_with(&suite, &root, &fixture_catalog()).expect("the version loads")
}

/// The diagnostics a version with one break carries.
fn diagnostics(break_it: impl FnOnce(&Path)) -> Vec<SuiteDiagnostic> {
    broken(break_it).1
}

/// Assert that exactly one invariant failed, and that it failed the way the test
/// says it did.
#[track_caller]
fn assert_only(found: &[SuiteDiagnostic], entity: SuiteEntity, message: &str) {
    let expected = SuiteDiagnostic::export(entity, message);
    assert_eq!(found, [expected]);
}

/// Assert that this diagnostic is among the ones the pass reported.
#[track_caller]
fn assert_reports(found: &[SuiteDiagnostic], entity: SuiteEntity, message: &str) {
    let expected = SuiteDiagnostic::export(entity, message);
    assert!(
        found.contains(&expected),
        "{expected} is missing from {found:?}"
    );
}

/// Overwrite one file of the copied version, creating its directory if needed.
fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("the file has a parent"))
        .expect("the directory is created");
    std::fs::write(path, text).expect("the file is written");
}

/// Replace one fragment of one file, asserting the fragment was there.
fn replace(root: &Path, rel: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.join(rel)).expect("the file is readable");
    assert!(text.contains(from), "`{from}` is not in {rel}");
    std::fs::write(root.join(rel), text.replace(from, to)).expect("the file is written");
}

/// Append to one file of the copied version.
fn append(root: &Path, rel: &str, text: &str) {
    let existing = std::fs::read_to_string(root.join(rel)).expect("the file is readable");
    std::fs::write(root.join(rel), format!("{existing}{text}")).expect("the file is written");
}

/// Add a specification folder nothing else in the fixture names, so an invariant
/// about a specification or a requirement can be broken on its own.
fn add_specification(root: &Path, dir: &str, id: &str, path: &str, requirements: &str) {
    write(
        root,
        &format!("specifications/{dir}/specification.toml"),
        &format!(
            "id = \"{id}\"\nname = \"Extra\"\nsummary = \"An extra specification.\"\n\
             path = \"{path}\"\n{requirements}"
        ),
    );
    write(
        root,
        &format!("specifications/{dir}/specification.md"),
        "# Extra\n",
    );
}

/// The entity one of the added specification's requirements is addressed by.
fn extra_requirement(requirement: &str) -> SuiteEntity {
    SuiteEntity::Requirement {
        specification: "extra".to_owned(),
        requirement: requirement.to_owned(),
    }
}

#[test]
fn the_committed_fixture_produces_no_diagnostics() {
    let suite = crate::test_suite::load_suite_manifest_of(&fixture()).expect("the suite loads");
    let (_, found) =
        load_and_validate_with(&suite, &fixture(), &fixture_catalog()).expect("the fixture loads");
    assert_eq!(found, []);
}

#[test]
fn a_slug_that_does_not_match_the_suite_directory_is_reported_against_the_suite() {
    let found = diagnostics(|root| replace(root, SUITE, "slug = \"carom\"", "slug = \"pool\""));
    assert_only(
        &found,
        SuiteEntity::Suite,
        "slug `pool` does not match the suite folder `carom`",
    );
}

#[test]
fn an_exported_version_that_declares_no_version_is_reported_against_the_suite() {
    let found = diagnostics(|root| replace(root, "version.toml", "version = \"1.0.0\"\n", ""));
    assert_only(
        &found,
        SuiteEntity::Suite,
        "version is not declared, and the exported version folder `v1.0.0` requires one",
    );
}

#[test]
fn a_draft_that_declares_no_version_is_not_held_to_its_folder_name() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let (_, found) = broken_at(temporary.path().join("carom/drafts/main"), |root| {
        replace(root, "version.toml", "version = \"1.0.0\"\n", "");
    });
    assert_eq!(found, []);
}

#[test]
fn a_slug_that_is_not_kebab_case_is_reported_against_the_suite() {
    let found = diagnostics(|root| replace(root, SUITE, "slug = \"carom\"", "slug = \"Carom\""));
    assert_reports(&found, SuiteEntity::Suite, "slug `Carom` is not kebab-case");
}

#[test]
fn a_version_that_does_not_match_the_version_folder_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        replace(
            root,
            "version.toml",
            "version = \"1.0.0\"",
            "version = \"1.1.0\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Suite,
        "version `1.1.0` does not match the version folder `v1.0.0`",
    );
}

#[test]
fn a_summary_carrying_a_newline_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        replace(
            root,
            "version.toml",
            "summary = \"A pool-table arcade game about angles, spin and the perfect volley.\"",
            "summary = \"\"\"\nTwo lines.\nNot one.\n\"\"\"",
        );
    });
    assert_only(&found, SuiteEntity::Suite, "summary is not a single line");
}

#[test]
fn a_declared_path_that_is_not_there_is_reported_against_the_file_that_declared_it() {
    let found = diagnostics(|root| {
        replace(
            root,
            "version.toml",
            "description = \"description.md\"",
            "description = \"missing.md\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Suite,
        "declared path `missing.md` does not exist",
    );
}

#[test]
fn a_declared_path_that_leaves_the_version_folder_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        replace(
            root,
            "version.toml",
            "changelog = \"changelog.md\"",
            "changelog = \"../changelog.md\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Suite,
        "declared path `../changelog.md` does not resolve inside the suite tree",
    );
}

#[test]
fn a_specification_id_that_is_not_kebab_case_is_reported_against_that_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "Extra_Spec", "extra.md", "");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("Extra_Spec".to_owned()),
        "specification id `Extra_Spec` is not kebab-case",
    );
}

#[test]
fn a_specification_id_declared_twice_is_reported_against_the_second_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "ball-physics", "extra.md", "");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("ball-physics".to_owned()),
        "specification id `ball-physics` is already declared by `specifications/ball-physics`",
    );
}

#[test]
fn a_specification_without_its_prose_is_reported_against_that_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "extra", "extra.md", "");
        std::fs::remove_file(root.join("specifications/zz-extra/specification.md"))
            .expect("the prose is removed");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("extra".to_owned()),
        "declared path `specifications/zz-extra/specification.md` does not exist",
    );
}

#[test]
fn a_seeded_path_that_is_not_markdown_is_reported_against_that_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "extra", "extra.txt", "");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("extra".to_owned()),
        "seeded path `extra.txt` does not end in `.md`",
    );
}

#[test]
fn a_seeded_path_that_leaves_specs_is_reported_against_that_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "extra", "../extra.md", "");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("extra".to_owned()),
        "seeded path `../extra.md` does not stay within `specs/`",
    );
}

#[test]
fn a_seeded_path_declared_twice_is_reported_against_the_second_specification() {
    let found = diagnostics(|root| {
        add_specification(root, "zz-extra", "extra", "ball-physics.md", "");
    });
    assert_only(
        &found,
        SuiteEntity::Specification("extra".to_owned()),
        "seeded path `ball-physics.md` is already declared by specification `ball-physics`",
    );
}

#[test]
fn a_requirement_id_that_is_not_kebab_case_is_reported_against_that_requirement() {
    let found = diagnostics(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"Looks_Good\"\nkind = \"non-functional\"\n\
             text = \"It SHOULD look good.\"\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("Looks_Good"),
        "requirement id `Looks_Good` is not kebab-case",
    );
}

#[test]
fn a_requirement_id_declared_twice_is_reported_against_the_second_requirement() {
    let found = diagnostics(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"looks-good\"\nkind = \"non-functional\"\n\
             text = \"It SHOULD look good.\"\n\n[[requirement]]\nid = \"looks-good\"\n\
             kind = \"non-functional\"\ntext = \"It SHOULD still look good.\"\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("looks-good"),
        "requirement id `looks-good` is declared more than once",
    );
}

#[test]
fn a_functional_requirement_without_a_validator_is_reported_against_that_requirement() {
    let found = diagnostics(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"bounces\"\nkind = \"functional\"\n\
             text = \"The ball MUST bounce.\"\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("bounces"),
        "a functional requirement declares no validator",
    );
}

#[test]
fn a_non_functional_requirement_with_a_validator_is_reported_against_that_requirement() {
    let found = diagnostics(|root| {
        write(
            root,
            "validators/ball/extra.ts",
            "export default () => [];\n",
        );
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"looks-good\"\nkind = \"non-functional\"\n\
             text = \"It SHOULD look good.\"\nvalidators = [\"ball/extra.ts\"]\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("looks-good"),
        "a non-functional requirement declares a validator",
    );
}

#[test]
fn a_validator_module_that_is_not_there_is_reported_against_the_requirement_claiming_it() {
    let found = diagnostics(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"bounces\"\nkind = \"functional\"\n\
             text = \"The ball MUST bounce.\"\nvalidators = [\"ball/missing.ts\"]\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("bounces"),
        "declared path `ball/missing.ts` does not exist",
    );
}

#[test]
fn a_validator_claimed_by_two_requirements_is_reported_against_both_of_them() {
    let found = diagnostics(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"bounces\"\nkind = \"functional\"\n\
             text = \"The ball MUST bounce.\"\nvalidators = [\"ball/constant-speed.ts\"]\n",
        );
    });
    let message = "validator `ball/constant-speed.ts` is claimed by more than one requirement";
    assert_reports(
        &found,
        SuiteEntity::Requirement {
            specification: "ball-physics".to_owned(),
            requirement: "constant-speed".to_owned(),
        },
        message,
    );
    assert_reports(&found, extra_requirement("bounces"), message);
    assert_eq!(found.len(), 2);
}

#[test]
fn the_generated_debug_api_declaration_is_not_a_validator() {
    // Derived output written beside the validators, like the Vitest configuration
    // it sits next to, so no requirement claims it and none is expected to.
    let found = diagnostics(|root| {
        write(
            root,
            "validators/debug-api.ts",
            "export interface CaromDebugApi {}\n",
        );
    });
    assert_eq!(found, [], "{found:?}");
}

#[test]
fn a_validator_no_requirement_claims_is_reported_against_that_validator() {
    let found = diagnostics(|root| {
        write(
            root,
            "validators/ball/orphan.ts",
            "export default () => [];\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Validator("ball/orphan.ts".to_owned()),
        "validator `ball/orphan.ts` is claimed by no requirement",
    );
}

#[test]
fn a_definition_without_the_table_its_type_requires_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/ball.toml",
            "\n[voxel]\nid = \"ball\"\nanimated = true\n",
            "\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("ball".to_owned()),
        "a `voxel` definition carries no `[voxel]` table",
    );
}

#[test]
fn a_definition_carrying_a_second_type_table_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        append(
            root,
            "test-cases/ball.toml",
            "\n[sprite]\nid = \"player-ship\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("ball".to_owned()),
        "a `voxel` definition carries a `[sprite]` table",
    );
}

#[test]
fn an_engine_without_a_workspace_entry_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/end-to-end.toml",
            "simple-2d = \"workspaces/simple-2d-e2e\"\n",
            "",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("end-to-end".to_owned()),
        "`[workspaces]` declares no entry for engine `simple-2d`",
    );
}

#[test]
fn a_workspace_entry_for_an_undeclared_engine_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/end-to-end.toml",
            "simple-2d = \"workspaces/simple-2d-e2e\"\n",
            "simple-2d = \"workspaces/simple-2d-e2e\"\nstructured-2d = \"workspaces/none\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("end-to-end".to_owned()),
        "`[workspaces]` declares an entry for engine `structured-2d`, which the definition does \
         not declare",
    );
}

#[test]
fn an_engine_the_catalog_does_not_know_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/end-to-end.toml",
            "engines = [\"none\", \"simple-2d\"]",
            "engines = [\"none\", \"simple-2d\", \"gyroscope\"]",
        );
        replace(
            root,
            "test-cases/end-to-end.toml",
            "simple-2d = \"workspaces/simple-2d-e2e\"\n",
            "simple-2d = \"workspaces/simple-2d-e2e\"\ngyroscope = \"workspaces/none\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("end-to-end".to_owned()),
        "engine `gyroscope` is not a known engine",
    );
}

#[test]
fn a_specification_the_suite_does_not_declare_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/end-to-end.toml",
            "specifications = [\"ball-physics\", \"ball-spin\"]",
            "specifications = [\"ball-physics\", \"paddles\"]",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("end-to-end".to_owned()),
        "specification `paddles` is not declared by the suite",
    );
}

#[test]
fn an_asset_the_suite_does_not_declare_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/ball.toml",
            "id = \"ball\"",
            "id = \"cue\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("ball".to_owned()),
        "asset `cue` is not declared by the suite",
    );
}

#[test]
fn a_version_driving_an_implementation_without_a_debug_api_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        std::fs::remove_file(root.join("debug-api.toml")).expect("the root module is removed");
        std::fs::remove_dir_all(root.join("debug-api")).expect("the modules are removed");
    });
    assert_only(
        &found,
        SuiteEntity::Suite,
        "the version declares an `end-to-end` or `full-stack` test case but no debug API",
    );
}

#[test]
fn a_debug_api_no_definition_drives_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        std::fs::remove_file(root.join("test-cases/end-to-end.toml")).expect("the file is removed");
        std::fs::remove_file(root.join("test-cases/full-stack.toml")).expect("the file is removed");
    });
    assert_reports(
        &found,
        SuiteEntity::Suite,
        "the version declares a debug API but no `end-to-end` or `full-stack` test case",
    );
}

#[test]
fn a_root_module_without_a_handle_is_reported_against_that_module() {
    let found = diagnostics(|root| {
        replace(root, "debug-api.toml", "handle = \"__carom\"\n", "");
    });
    assert_only(
        &found,
        SuiteEntity::DebugApiNode("debug-api.toml".to_owned()),
        "`debug-api.toml` declares no `handle`",
    );
}

#[test]
fn a_module_file_declaring_a_handle_is_reported_against_that_module() {
    let found = diagnostics(|root| {
        replace(
            root,
            "debug-api/ball.toml",
            "description = \"The live ball.\"\n",
            "handle = \"__ball\"\ndescription = \"The live ball.\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::DebugApiNode("debug-api/ball.toml".to_owned()),
        "a module file under `debug-api/` declares a `handle`",
    );
}

#[test]
fn a_module_file_no_parent_references_is_reported_against_that_module() {
    let found = diagnostics(|root| {
        write(
            root,
            "debug-api/orphan.toml",
            "description = \"Nobody's module.\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::DebugApiNode("debug-api/orphan.toml".to_owned()),
        "the module file `debug-api/orphan.toml` is referenced by no parent",
    );
}

#[test]
fn a_module_file_two_parents_reference_is_reported_against_it_and_both_parents() {
    let found = diagnostics(|root| {
        append(
            root,
            "debug-api.toml",
            "\n[[module]]\nname = \"spin\"\npath = \"debug-api/ball/spin.toml\"\n\
             description = \"Ball spin.\"\n",
        );
    });
    let message = "the module file `debug-api/ball/spin.toml` is referenced by more than one \
                   parent";
    assert_reports(
        &found,
        SuiteEntity::DebugApiNode("debug-api/ball/spin.toml".to_owned()),
        message,
    );
    // Each reference is equally the reason the file sits in two places, and each
    // is edited on the module declaring it.
    assert_reports(
        &found,
        SuiteEntity::DebugApiNode("debug-api.toml".to_owned()),
        message,
    );
    assert_reports(
        &found,
        SuiteEntity::DebugApiNode("debug-api/ball.toml".to_owned()),
        message,
    );
    assert_eq!(found.len(), 3, "{found:?}");
}

#[test]
fn a_module_reference_to_a_file_that_is_not_there_is_reported_against_the_parent() {
    let found = diagnostics(|root| {
        replace(
            root,
            "debug-api.toml",
            "path = \"debug-api/ball.toml\"",
            "path = \"debug-api/cue.toml\"",
        );
    });
    assert_reports(
        &found,
        SuiteEntity::DebugApiNode("debug-api.toml".to_owned()),
        "declared path `debug-api/cue.toml` does not exist",
    );
}

#[test]
fn a_function_name_declared_twice_is_reported_against_that_function() {
    let found = diagnostics(|root| {
        append(
            root,
            "debug-api/ball.toml",
            "\n[[function]]\nname = \"state\"\nkind = \"query\"\n\
             signature = \"state(): BallState\"\ndescription = \"Reports it again.\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::DebugApiNode("debug-api/ball.toml#state".to_owned()),
        "function name `state` is declared more than once",
    );
}

/// Write an asset folder nothing else in the fixture names.
fn add_asset(root: &Path, dir: &str, body: &str) {
    write(root, &format!("assets/{dir}/asset.toml"), body);
    write(root, &format!("assets/{dir}/cue.png"), "cue\n");
}

#[test]
fn an_asset_id_that_is_not_its_folder_name_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz-extra",
            "id = \"cue\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"assets\"\nfiles = [\"cue.png\"]\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("cue".to_owned()),
        "asset id `cue` does not match its folder `assets/zz-extra`",
    );
}

#[test]
fn an_asset_id_that_is_not_kebab_case_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz_extra",
            "id = \"zz_extra\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"assets\"\nfiles = [\"cue.png\"]\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("zz_extra".to_owned()),
        "asset id `zz_extra` is not kebab-case",
    );
}

#[test]
fn an_asset_id_declared_twice_is_reported_against_the_second_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "ball",
            "id = \"ball\"\nname = \"Ball\"\nkind = \"voxel\"\n\
             specification = \"assets\"\nfiles = [\"cue.png\"]\n",
        );
        add_asset(
            root,
            "zz-ball",
            "id = \"ball\"\nname = \"Ball\"\nkind = \"voxel\"\n\
             specification = \"assets\"\nfiles = [\"cue.png\"]\n",
        );
    });
    assert_reports(
        &found,
        SuiteEntity::Asset("ball".to_owned()),
        "asset id `ball` is already declared by `assets/ball`",
    );
}

#[test]
fn an_asset_declaring_no_files_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz-extra",
            "id = \"zz-extra\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"assets\"\nfiles = []\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("zz-extra".to_owned()),
        "the asset declares no files",
    );
}

#[test]
fn an_asset_file_that_is_not_there_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz-extra",
            "id = \"zz-extra\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"assets\"\nfiles = [\"missing.png\"]\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("zz-extra".to_owned()),
        "declared path `missing.png` does not exist",
    );
}

#[test]
fn an_asset_specification_the_suite_does_not_declare_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz-extra",
            "id = \"zz-extra\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"cues\"\nfiles = [\"cue.png\"]\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("zz-extra".to_owned()),
        "specification `cues` is not declared by the suite",
    );
}

#[test]
fn an_asset_specification_with_a_functional_requirement_is_reported_against_that_asset() {
    let found = diagnostics(|root| {
        add_asset(
            root,
            "zz-extra",
            "id = \"zz-extra\"\nname = \"Cue\"\nkind = \"sprite\"\n\
             specification = \"ball-physics\"\nfiles = [\"cue.png\"]\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Asset("zz-extra".to_owned()),
        "specification `ball-physics` declares a functional requirement, and an asset \
         specification declares none",
    );
}

#[test]
fn a_demonstration_id_that_is_not_its_folder_name_is_reported_against_that_demonstration() {
    let found = diagnostics(|root| {
        write(
            root,
            "demos/zz-extra/demo.toml",
            "id = \"cue-strike\"\nname = \"Cue Strike\"\nsummary = \"One strike.\"\n\
             specification = \"ball-physics\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Demonstration("cue-strike".to_owned()),
        "demonstration id `cue-strike` does not match its folder `demos/zz-extra`",
    );
}

#[test]
fn a_demonstration_specification_the_suite_does_not_declare_is_reported_against_it() {
    let found = diagnostics(|root| {
        write(
            root,
            "demos/zz-extra/demo.toml",
            "id = \"zz-extra\"\nname = \"Cue Strike\"\nsummary = \"One strike.\"\n\
             specification = \"cues\"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Demonstration("zz-extra".to_owned()),
        "specification `cues` is not declared by the suite",
    );
}

#[test]
fn a_showcase_description_over_the_cap_is_reported_against_the_showcase() {
    let found = diagnostics(|root| {
        let prose = "x".repeat(MAX_SHOWCASE_DESCRIPTION_BYTES + 1);
        write(root, "showcase/showcase.md", &prose);
    });
    assert_only(
        &found,
        SuiteEntity::Showcase,
        &format!("the showcase description exceeds {MAX_SHOWCASE_DESCRIPTION_BYTES} bytes"),
    );
}

#[test]
fn a_carousel_over_the_cap_is_reported_against_the_showcase() {
    let entries = MAX_SHOWCASE_MEDIA_ENTRIES + 1;
    let found = diagnostics(move |root| {
        let carousel =
            "[[media]]\nfile = \"title.png\"\nname = \"Title screen\"\n\n".repeat(entries);
        write(root, "showcase/showcase.toml", &carousel);
    });
    assert_only(
        &found,
        SuiteEntity::Showcase,
        &format!(
            "the showcase carousel declares {entries} entries, more than the \
             {MAX_SHOWCASE_MEDIA_ENTRIES} allowed"
        ),
    );
}

#[test]
fn a_media_entry_naming_a_path_is_reported_against_the_showcase() {
    let found = diagnostics(|root| {
        replace(
            root,
            "showcase/showcase.toml",
            "file = \"title.png\"",
            "file = \"stills/title.png\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Showcase,
        "media file `stills/title.png` is not a bare file name",
    );
}

#[test]
fn a_media_file_that_is_not_in_the_directory_is_reported_against_the_showcase() {
    let found = diagnostics(|root| {
        replace(
            root,
            "showcase/showcase.toml",
            "file = \"title.png\"",
            "file = \"missing.png\"",
        );
    });
    assert_only(
        &found,
        SuiteEntity::Showcase,
        "media file `missing.png` is not present in the showcase directory",
    );
}

#[test]
fn a_media_file_over_the_cap_is_reported_against_the_showcase() {
    let found = diagnostics(|root| {
        let oversized = vec![0_u8; MAX_SHOWCASE_MEDIA_FILE_BYTES as usize + 1];
        std::fs::write(root.join("showcase/title.png"), oversized).expect("the file is written");
    });
    assert_only(
        &found,
        SuiteEntity::Showcase,
        &format!("media file `title.png` exceeds {MAX_SHOWCASE_MEDIA_FILE_BYTES} bytes"),
    );
}

#[test]
fn a_version_without_a_reference_implementation_is_reported_against_the_suite() {
    let found = diagnostics(|root| {
        std::fs::remove_dir_all(root.join("reference-implementations"))
            .expect("the reference implementations are removed");
    });
    assert_only(
        &found,
        SuiteEntity::Suite,
        "the version declares no reference implementation",
    );
}

#[test]
fn a_reference_implementation_for_an_undeclared_engine_is_reported_against_it() {
    let found = diagnostics(|root| {
        write(
            root,
            "reference-implementations/structured-2d/index.html",
            "<!doctype html>\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::ReferenceImplementation("structured-2d".to_owned()),
        "`structured-2d` is not an engine the version's test case definitions declare",
    );
}

#[test]
fn several_unrelated_failures_are_reported_in_one_pass() {
    let (_, found) = broken(|root| {
        replace(root, SUITE, "slug = \"carom\"", "slug = \"pool\"");
        write(
            root,
            "validators/ball/orphan.ts",
            "export default () => [];\n",
        );
        replace(
            root,
            "showcase/showcase.toml",
            "file = \"volley.png\"",
            "file = \"missing.png\"",
        );
    });
    assert_reports(
        &found,
        SuiteEntity::Suite,
        "slug `pool` does not match the suite folder `carom`",
    );
    assert_reports(
        &found,
        SuiteEntity::Validator("ball/orphan.ts".to_owned()),
        "validator `ball/orphan.ts` is claimed by no requirement",
    );
    assert_reports(
        &found,
        SuiteEntity::Showcase,
        "media file `missing.png` is not present in the showcase directory",
    );
    assert_eq!(found.len(), 3);
}

#[test]
fn a_broken_requirement_leaves_the_rest_of_the_version_intact() {
    let (version, found) = broken(|root| {
        add_specification(
            root,
            "zz-extra",
            "extra",
            "extra.md",
            "\n[[requirement]]\nid = \"bounces\"\nkind = \"functional\"\n\
             text = \"The ball MUST bounce.\"\n",
        );
    });
    assert_only(
        &found,
        extra_requirement("bounces"),
        "a functional requirement declares no validator",
    );
    assert_eq!(version.test_cases.len(), 10);
    assert_eq!(version.assets.len(), 7);
    assert_eq!(version.demos.len(), 1);
    assert!(version.debug_api.is_some());
    assert!(version.showcase.is_some());
}

#[test]
fn a_file_that_does_not_parse_is_a_diagnostic_for_that_file_alone() {
    let (version, found) = broken(|root| {
        write(root, "test-cases/ball.toml", "type = ");
    });
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].entity, SuiteEntity::TestCase("ball".to_owned()));
    assert!(
        found[0]
            .message
            .starts_with("`test-cases/ball.toml` does not parse:"),
        "{}",
        found[0].message
    );
    assert_eq!(version.test_cases.len(), 9);
    assert_eq!(version.assets.len(), 7);
    assert!(version.debug_api.is_some());
}

#[test]
fn a_specification_that_does_not_parse_is_reported_against_that_specification() {
    let (version, found) = broken(|root| {
        add_specification(root, "zz-extra", "extra", "extra.md", "");
        write(root, "specifications/zz-extra/specification.toml", "id = ");
    });
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].entity,
        SuiteEntity::Specification("specifications/zz-extra".to_owned())
    );
    assert_eq!(version.specifications.len(), 2);
}

#[test]
fn a_blank_init_is_reported_against_that_definition() {
    let found = diagnostics(|root| {
        replace(
            root,
            "test-cases/end-to-end.toml",
            "init = \"npm ci && npx playwright install chromium\"\n",
            "init = \"  \"\n",
        );
    });
    assert_only(
        &found,
        SuiteEntity::TestCase("end-to-end".to_owned()),
        "`init` must not be empty when declared",
    );
}
