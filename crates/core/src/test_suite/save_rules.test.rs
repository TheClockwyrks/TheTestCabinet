//! Tests for the save rules, over the committed fixture with one rule broken at a
//! time.

use std::path::PathBuf;

use super::*;
use crate::test_suite::{
    PartialDebugApiFunction, PartialRequirement, SuiteRule, SuiteVersion, load_suite_manifest_of,
};

/// The fixture version, read through the partial model.
fn fixture() -> PartialSuiteTree {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/testdata/test-suite/carom/versions/v1.0.0");
    let suite = load_suite_manifest_of(&root).expect("the suite manifest loads");
    PartialSuiteTree::from(SuiteVersion::load(&suite, &root).expect("the fixture loads"))
}

/// Assert exactly one save problem was found, and what it says.
#[track_caller]
fn assert_only(tree: &PartialSuiteTree, entity: SuiteEntity, message: &str) {
    let found = save_problems(tree);
    assert_eq!(found, [SuiteDiagnostic::save(entity, message)]);
    assert!(found.iter().all(|problem| problem.rule == SuiteRule::Save));
}

#[test]
fn the_committed_fixture_breaks_no_save_rule() {
    assert_eq!(save_problems(&fixture()), []);
}

#[test]
fn a_specification_id_that_is_not_kebab_case_breaks_a_save_rule() {
    let mut tree = fixture();
    tree.specifications[0].manifest.id = Some("Assets".to_owned());
    assert_only(
        &tree,
        SuiteEntity::Specification("Assets".to_owned()),
        "specification id `Assets` is not kebab-case",
    );
}

#[test]
fn a_requirement_id_repeated_within_its_file_breaks_a_save_rule() {
    let mut tree = fixture();
    let requirements = &mut tree.specifications[1].manifest.requirements;
    requirements.push(PartialRequirement {
        id: requirements[0].id.clone(),
        ..PartialRequirement::default()
    });
    assert_only(
        &tree,
        SuiteEntity::Requirement {
            specification: "ball-physics".to_owned(),
            requirement: "constant-speed".to_owned(),
        },
        "requirement id `constant-speed` is declared more than once",
    );
}

#[test]
fn a_function_name_repeated_within_its_module_breaks_a_save_rule() {
    let mut tree = fixture();
    let module = tree
        .debug_api
        .as_mut()
        .and_then(|debug_api| debug_api.modules.get_mut("debug-api/ball.toml"))
        .expect("the fixture declares the ball module");
    module.functions.push(PartialDebugApiFunction {
        name: Some("state".to_owned()),
        ..PartialDebugApiFunction::default()
    });
    assert_only(
        &tree,
        SuiteEntity::DebugApiNode("debug-api/ball.toml#state".to_owned()),
        "function name `state` is declared more than once",
    );
}

#[test]
fn an_incomplete_entity_breaks_no_save_rule() {
    let mut tree = fixture();
    tree.specifications[0].manifest = Default::default();
    tree.assets[0].manifest = Default::default();
    tree.test_cases[0].definition = Default::default();
    assert_eq!(save_problems(&tree), []);
}

#[test]
fn a_path_resolving_outside_the_tree_breaks_a_save_rule() {
    let mut tree = fixture();
    tree.test_cases[0].definition.prompt = Some("../../../etc/passwd".to_owned());
    assert_only(
        &tree,
        SuiteEntity::TestCase("ball".to_owned()),
        "declared path `../../../etc/passwd` in `the definition` resolves outside the suite tree",
    );
}

#[test]
fn a_validator_path_climbing_out_of_validators_but_not_the_tree_is_left_to_export() {
    let mut tree = fixture();
    tree.specifications[1].manifest.requirements[0].validators = vec!["../prompts/x.ts".to_owned()];
    assert_eq!(save_problems(&tree), []);
    tree.specifications[1].manifest.requirements[0].validators = vec!["../../x.ts".to_owned()];
    assert_eq!(save_problems(&tree).len(), 1);
}

#[test]
fn escaping_is_decided_segment_by_segment() {
    assert!(!escapes("", "description.md"));
    assert!(!escapes("", "a/../b.md"));
    assert!(escapes("", "../b.md"));
    assert!(escapes("", "/etc/passwd"));
    assert!(escapes("", "C:/Windows"));
    assert!(!escapes("assets/ball", "../other/file.png"));
    assert!(escapes("assets/ball", "../../../file.png"));
    assert!(!escapes("", ""));
}

#[test]
fn kebab_case_is_lower_case_words_joined_by_single_hyphens() {
    for id in ["ball", "ball-physics", "v2-rules"] {
        assert!(is_kebab_case(id), "{id}");
    }
    for id in [
        "",
        "Ball",
        "ball_physics",
        "-ball",
        "ball-",
        "ball--physics",
    ] {
        assert!(!is_kebab_case(id), "{id}");
    }
}
