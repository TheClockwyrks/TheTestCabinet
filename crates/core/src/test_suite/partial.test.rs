//! Tests for the partial model: a draft in any state loads, an absent key is
//! omitted rather than invented, a canonical partial file round-trips byte for
//! byte, a file that does not parse is carried as its text, and a tree converts to
//! the complete model exactly when the export rules find nothing.

use std::path::{Path, PathBuf};

use super::*;
use crate::test_suite::{
    SuiteDiagnostic, SuiteEntity, SuiteRule, SuiteVersion, VERSION_MANIFEST_FILE,
    load_suite_manifest_of, to_canonical_toml, validate, validate_tree,
};

/// The committed fixture suite folder.
fn fixture_suite() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/testdata/test-suite/carom")
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

/// A temporary suite folder holding the fixture's `suite.toml` and an empty draft
/// holding only its `draft.toml`, returned with the draft's path.
fn empty_draft() -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let suite = temporary.path().join("carom");
    let draft = suite.join("drafts/main");
    std::fs::create_dir_all(&draft).expect("the draft folder is created");
    std::fs::copy(fixture_suite().join("suite.toml"), suite.join("suite.toml"))
        .expect("the suite manifest is copied");
    std::fs::write(draft.join("draft.toml"), "").expect("the draft manifest is written");
    (temporary, draft)
}

/// A temporary copy of the fixture's exported version, as a draft of the suite.
fn fixture_draft() -> (tempfile::TempDir, PathBuf) {
    let (temporary, draft) = empty_draft();
    copy_tree(&fixture_suite().join("versions/v1.0.0"), &draft);
    (temporary, draft)
}

/// Write one file of a tree, creating its directory.
fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("the file has a parent"))
        .expect("the directory is created");
    std::fs::write(path, text).expect("the file is written");
}

/// Read the tree at `root` through the partial model.
fn load(root: &Path) -> PartialSuiteTree {
    let suite = load_suite_manifest_of(root).expect("the suite manifest loads");
    PartialSuiteTree::load(&suite, root)
}

/// Assert `found` carries an export problem with this entity and message.
#[track_caller]
fn assert_reports(found: &[SuiteDiagnostic], entity: SuiteEntity, message: &str) {
    let expected = SuiteDiagnostic::export(entity, message);
    assert!(
        found.contains(&expected),
        "{expected} is missing from {found:#?}"
    );
}

#[test]
fn a_draft_holding_only_its_draft_manifest_loads_and_reports_what_it_lacks() {
    let (_temporary, draft) = empty_draft();

    let tree = load(&draft);
    assert_eq!(tree.manifest, None);
    assert!(tree.specifications.is_empty());
    assert!(tree.test_cases.is_empty());
    assert!(tree.unparsed.is_empty(), "{:?}", tree.unparsed);

    let found = validate_tree(&draft, &tree);
    assert_eq!(
        found,
        [
            SuiteDiagnostic::export(SuiteEntity::Suite, "`version.toml` is missing"),
            SuiteDiagnostic::export(
                SuiteEntity::Suite,
                "the version declares no reference implementation"
            ),
        ]
    );
    assert!(
        found
            .iter()
            .all(|problem| problem.rule == SuiteRule::Export)
    );
    assert!(tree.complete(&draft).is_err());
}

#[test]
fn each_missing_required_key_is_an_export_problem_on_its_entity() {
    let (_temporary, draft) = empty_draft();
    write(&draft, "version.toml", "tags = [\"arcade\"]\n");
    write(
        &draft,
        "specifications/physics/specification.toml",
        "id = \"physics\"\n\n[[requirement]]\n\n[[requirement]]\nid = \"speed\"\n",
    );
    write(
        &draft,
        "specifications/physics/specification.md",
        "# Physics\n",
    );
    write(&draft, "specifications/unnamed/specification.toml", "");
    write(&draft, "specifications/unnamed/specification.md", "");
    write(&draft, "assets/ball/asset.toml", "");
    write(&draft, "demos/bounce/demo.toml", "name = \"Bounce\"\n");
    write(
        &draft,
        "test-cases/ball.toml",
        "type = \"voxel\"\n\n[voxel]\n",
    );
    write(
        &draft,
        "showcase/showcase.toml",
        "[[media]]\nname = \"Title\"\n",
    );
    write(&draft, "showcase/showcase.md", "");

    let tree = load(&draft);
    let found = validate_tree(&draft, &tree);

    for key in ["summary", "description", "changelog"] {
        assert_reports(
            &found,
            SuiteEntity::Suite,
            &format!("`{key}` is not declared"),
        );
    }
    let physics = SuiteEntity::Specification("physics".to_owned());
    for key in ["name", "summary", "path"] {
        assert_reports(&found, physics.clone(), &format!("`{key}` is not declared"));
    }
    // A requirement with no `id` has no address of its own, so it is reported on the
    // specification declaring it, by position.
    assert_reports(
        &found,
        physics.clone(),
        "requirement 1: `id` is not declared",
    );
    assert_reports(&found, physics, "requirement 1: `kind` is not declared");
    let speed = SuiteEntity::Requirement {
        specification: "physics".to_owned(),
        requirement: "speed".to_owned(),
    };
    assert_reports(&found, speed.clone(), "`kind` is not declared");
    assert_reports(&found, speed, "`text` is not declared");
    // A specification with no `id` is addressed by its folder.
    assert_reports(
        &found,
        SuiteEntity::Specification("specifications/unnamed".to_owned()),
        "`id` is not declared",
    );
    // An asset or demonstration with no `id` is addressed by its folder name.
    for key in ["id", "name", "kind", "specification", "files"] {
        assert_reports(
            &found,
            SuiteEntity::Asset("ball".to_owned()),
            &format!("`{key}` is not declared"),
        );
    }
    assert_reports(
        &found,
        SuiteEntity::Demonstration("bounce".to_owned()),
        "`summary` is not declared",
    );
    let ball = SuiteEntity::TestCase("ball".to_owned());
    for key in ["name", "difficulty", "prompt"] {
        assert_reports(&found, ball.clone(), &format!("`{key}` is not declared"));
    }
    assert_reports(&found, ball, "`[voxel]` declares no `id`");
    assert_reports(&found, SuiteEntity::Showcase, "media 1 declares no `file`");
}

#[test]
fn a_saved_entity_omits_every_key_it_does_not_hold() {
    let manifest = PartialSpecificationManifest {
        id: Some("physics".to_owned()),
        requirements: vec![PartialRequirement {
            text: Some("The ball MUST move.".to_owned()),
            ..PartialRequirement::default()
        }],
        ..PartialSpecificationManifest::default()
    };
    assert_eq!(
        to_canonical_toml(&manifest).expect("the manifest serializes"),
        "id = \"physics\"\n\n[[requirement]]\ntext = \"The ball MUST move.\"\n"
    );
    assert_eq!(
        to_canonical_toml(&PartialTestCaseDefinition::default())
            .expect("the definition serializes"),
        ""
    );
    assert_eq!(
        to_canonical_toml(&PartialAssetManifest::default()).expect("the asset serializes"),
        ""
    );
}

#[test]
fn a_canonically_formatted_partial_file_round_trips_byte_for_byte() {
    let files: [(&str, &str); 8] = [
        (
            VERSION_MANIFEST_FILE,
            "tags = [\"arcade\"]\ndescription = \"description.md\"\n",
        ),
        (
            "specifications/physics/specification.toml",
            "name = \"Physics\"\n\n[[requirement]]\n\n[[requirement]]\nkind = \"functional\"\nvalidators = [\"ball/speed.ts\"]\n",
        ),
        (
            "debug-api.toml",
            "handle = \"__carom\"\n\n[[function]]\nname = \"state\"\n\n[[function.parameter]]\ndescription = \"The index.\"\n\n[[module]]\npath = \"debug-api/ball.toml\"\n",
        ),
        ("assets/ball/asset.toml", "kind = \"voxel\"\nfiles = []\n"),
        ("demos/bounce/demo.toml", "specification = \"physics\"\n"),
        (
            "test-cases/ball.toml",
            "type = \"end-to-end\"\nengines = [\"none\"]\n\n[workspaces]\nnone = \"workspaces/none\"\n\n[build]\n\n[toolchain]\nlint = \"npm run lint\"\n",
        ),
        (
            "test-cases/voxel.toml",
            "difficulty = \"hard\"\n\n[voxel]\nanimated = true\n",
        ),
        (
            "showcase/showcase.toml",
            "[[media]]\nfile = \"title.png\"\n\n[[media]]\n",
        ),
    ];
    let (_temporary, draft) = empty_draft();
    for (rel, text) in files {
        write(&draft, rel, text);
    }

    let tree = load(&draft);
    assert!(tree.unparsed.is_empty(), "{:#?}", tree.unparsed);
    let emitted = tree.canonical_files().expect("the tree serializes");
    for (rel, text) in files {
        let found = emitted
            .iter()
            .find(|(path, _)| path == rel)
            .unwrap_or_else(|| panic!("{rel} is not emitted"));
        assert_eq!(found.1, text, "{rel} does not round-trip");
    }
    assert_eq!(emitted.len(), files.len(), "{emitted:#?}");
}

#[test]
fn a_complete_tree_emits_the_same_bytes_through_either_model() {
    let root = fixture_suite().join("versions/v1.0.0");
    let suite = load_suite_manifest_of(&root).expect("the suite manifest loads");
    let complete = SuiteVersion::load(&suite, &root).expect("the fixture loads");

    let through_complete = complete
        .canonical_files()
        .expect("the complete model serializes");
    let through_partial = PartialSuiteTree::from(complete.clone())
        .canonical_files()
        .expect("the partial model serializes");
    let read_partial = PartialSuiteTree::load(&suite, &root)
        .canonical_files()
        .expect("the read partial model serializes");

    let sorted = |mut files: Vec<(String, String)>| {
        files.sort();
        files
    };
    assert_eq!(sorted(through_partial), sorted(through_complete.clone()));
    assert_eq!(sorted(read_partial), sorted(through_complete.clone()));
    for (rel, text) in through_complete {
        let on_disk = std::fs::read_to_string(root.join(&rel)).expect("the file is readable");
        assert_eq!(text, on_disk, "{rel} is not canonical on disk");
    }
}

#[test]
fn an_unparseable_version_manifest_is_carried_as_its_text_while_the_rest_loads() {
    let (_temporary, draft) = fixture_draft();
    let broken = "summary = \"Carom\"\ndescription = [\n";
    write(&draft, VERSION_MANIFEST_FILE, broken);

    let tree = load(&draft);
    assert_eq!(tree.manifest, None);
    assert_eq!(tree.unparsed.len(), 1, "{:#?}", tree.unparsed);
    let file = &tree.unparsed[0];
    assert_eq!(file.path, VERSION_MANIFEST_FILE);
    assert_eq!(file.entity, SuiteEntity::Suite);
    assert_eq!(file.text, broken);
    assert_eq!(file.line, Some(3));
    assert_eq!(file.column, Some(1));
    // The rest of the draft is there.
    assert_eq!(tree.test_cases.len(), 10);
    assert_eq!(tree.flat_specifications().len(), 3);

    let found = validate_tree(&draft, &tree);
    let parse = found
        .iter()
        .find(|problem| problem.location.is_some())
        .expect("the parse failure is a problem");
    assert_eq!(parse.entity, SuiteEntity::Suite);
    assert_eq!(parse.rule, SuiteRule::Export);
    let location = parse.location.as_ref().expect("the problem is located");
    assert_eq!(
        (location.path.as_str(), location.line, location.column),
        (VERSION_MANIFEST_FILE, Some(3), Some(1))
    );
    // Not also reported as missing: the file is there, it just does not parse.
    assert!(
        !found
            .iter()
            .any(|problem| problem.message == "`version.toml` is missing"),
        "{found:#?}"
    );
    // A save of the model never writes over the file it could not read.
    let emitted = tree.canonical_files().expect("the tree serializes");
    assert!(!emitted.iter().any(|(rel, _)| rel == VERSION_MANIFEST_FILE));
}

#[test]
fn an_unparseable_entity_file_is_carried_on_its_entity() {
    let (_temporary, draft) = fixture_draft();
    let broken = "name = \"Ball\"\nkind = \"not-a-kind\"\n";
    write(&draft, "assets/ball/asset.toml", broken);

    let tree = load(&draft);
    let file = tree
        .unparsed
        .iter()
        .find(|file| file.path == "assets/ball/asset.toml")
        .expect("the asset is unparsed");
    assert_eq!(file.entity, SuiteEntity::Asset("ball".to_owned()));
    assert_eq!(file.text, broken);
    assert_eq!(file.line, Some(2));
    assert!(tree.manifest.is_some());
    assert!(
        !tree.assets.iter().any(|asset| asset.dir == "assets/ball"),
        "the unparsed asset is not in the model"
    );
}

#[test]
fn an_overlay_is_read_in_place_of_the_file_it_names() {
    let (_temporary, draft) = fixture_draft();
    write(&draft, VERSION_MANIFEST_FILE, "summary = [\n");
    let suite = load_suite_manifest_of(&draft).expect("the suite manifest loads");
    let overlay = std::collections::BTreeMap::from([(
        VERSION_MANIFEST_FILE.to_owned(),
        b"summary = \"Repaired\"\n".to_vec(),
    )]);

    let tree = PartialSuiteTree::load_overlaid(&suite, &draft, &overlay);

    assert!(tree.unparsed.is_empty(), "{:#?}", tree.unparsed);
    assert_eq!(
        tree.manifest
            .and_then(|manifest| manifest.summary)
            .as_deref(),
        Some("Repaired")
    );
}

#[test]
fn a_staged_tree_lists_the_files_it_creates_and_leaves_out_the_ones_it_removes() {
    let (_temporary, draft) = fixture_draft();
    let suite = load_suite_manifest_of(&draft).expect("the suite manifest loads");
    let before = PartialSuiteTree::load(&suite, &draft);
    let removed = before.flat_specifications()[0].dir.clone();
    let mut staged = std::collections::BTreeMap::from([(
        "specifications/friction/specification.toml".to_owned(),
        Some(b"id = \"Not_Kebab\"\n".to_vec()),
    )]);
    staged.insert(format!("{removed}/specification.toml"), None);

    let tree = PartialSuiteTree::load_staged(&suite, &draft, &staged);

    let dirs: Vec<&str> = tree
        .flat_specifications()
        .iter()
        .map(|folder| folder.dir.as_str())
        .collect();
    assert!(dirs.contains(&"specifications/friction"), "{dirs:?}");
    assert!(!dirs.contains(&removed.as_str()), "{dirs:?}");
    assert!(
        crate::test_suite::save_problems(&tree)
            .iter()
            .any(|problem| problem.message.contains("Not_Kebab"))
    );
}

/// One change made to a copied tree before it is read.
type Break = Box<dyn Fn(&Path)>;

/// Every state the conversion is checked against: the complete fixture, and the
/// fixture with one thing wrong with it.
fn conversion_cases() -> Vec<(&'static str, Break)> {
    vec![
        ("the complete fixture", Box::new(|_: &Path| {})),
        (
            "a missing required key",
            Box::new(|root: &Path| {
                let path = root.join("demos/ball-bounce/demo.toml");
                let text = std::fs::read_to_string(&path).expect("the demo is readable");
                let kept: Vec<&str> = text
                    .lines()
                    .filter(|line| !line.starts_with("summary"))
                    .collect();
                std::fs::write(path, format!("{}\n", kept.join("\n"))).expect("written");
            }),
        ),
        (
            "an unresolved reference",
            Box::new(|root: &Path| {
                write(
                    root,
                    "demos/extra/demo.toml",
                    "id = \"extra\"\nname = \"Extra\"\nsummary = \"Extra.\"\nspecification = \"nowhere\"\n",
                );
            }),
        ),
        (
            "a file that does not parse",
            Box::new(|root: &Path| write(root, "test-cases/ball.toml", "name = \n")),
        ),
        (
            "a missing version manifest",
            Box::new(|root: &Path| {
                std::fs::remove_file(root.join(VERSION_MANIFEST_FILE)).expect("removed");
            }),
        ),
    ]
}

#[test]
fn a_tree_converts_to_the_complete_model_exactly_when_the_export_rules_find_nothing() {
    for (name, break_it) in conversion_cases() {
        let (_temporary, draft) = fixture_draft();
        break_it(&draft);
        let tree = load(&draft);
        let problems = validate_tree(&draft, &tree);

        match tree.complete(&draft) {
            Ok(complete) => {
                assert!(problems.is_empty(), "{name}: converted with {problems:#?}");
                // Core's validator agrees with the conversion: the complete model it
                // produced breaks no invariant.
                assert_eq!(validate(&draft, &complete), [], "{name}");
                let suite = load_suite_manifest_of(&draft).expect("the suite loads");
                let read = SuiteVersion::load(&suite, &draft).expect("the complete read loads");
                assert_eq!(
                    complete, read,
                    "{name}: the conversion disagrees with the read"
                );
            }
            Err(refused) => {
                assert!(!problems.is_empty(), "{name}: refused with no problems");
                assert_eq!(refused, problems, "{name}");
            }
        }
    }
}

#[test]
fn only_the_complete_fixture_converts() {
    let converted: Vec<&str> = conversion_cases()
        .into_iter()
        .filter_map(|(name, break_it)| {
            let (_temporary, draft) = fixture_draft();
            break_it(&draft);
            load(&draft).complete(&draft).is_ok().then_some(name)
        })
        .collect();
    assert_eq!(converted, ["the complete fixture"]);
}
