//! Tests for the canonical TOML emitter: the rules the
//! [module overview](super::super#the-canonical-form) states, one test each.

use super::*;
use crate::test_suite::model::{
    BuildCommands, DebugApiFunction, DebugApiFunctionKind, DebugApiModule, DebugApiParameter,
    SpecificationManifest, SuiteDifficulty, SuiteRequirement, SuiteRequirementKind,
    SuiteTestCaseDefinition, SuiteTestCaseType, ToolchainCommands, VersionManifest, VoxelCase,
};
use std::collections::BTreeMap;

/// A manifest with everything required filled in, so a test can vary the one key
/// it is about.
fn manifest() -> VersionManifest {
    VersionManifest {
        version: Some("1.0.0".to_owned()),
        tags: Vec::new(),
        summary: "One short line.".to_owned(),
        description: "description.md".to_owned(),
        changelog: "changelog.md".to_owned(),
        experimental: false,
    }
}

/// A functional requirement claiming `validators`.
fn requirement(validators: Vec<String>) -> SuiteRequirement {
    SuiteRequirement {
        id: "constant-speed".to_owned(),
        kind: SuiteRequirementKind::Functional,
        text: "The ball MUST travel at a constant speed.".to_owned(),
        validators,
    }
}

/// An `end-to-end` definition carrying all three of the shared tables.
fn definition() -> SuiteTestCaseDefinition {
    SuiteTestCaseDefinition {
        name: "Carom, end to end".to_owned(),
        test_type: SuiteTestCaseType::EndToEnd,
        difficulty: SuiteDifficulty::Easy,
        engines: vec!["none".to_owned(), "simple-2d".to_owned()],
        specifications: None,
        prompt: "prompts/end-to-end.hbs".to_owned(),
        max_runtime_hours: 1.0,
        experimental: false,
        init: Some("npm ci && npx playwright install chromium".to_owned()),
        sprite: None,
        voxel: None,
        blender: None,
        particle: None,
        music: None,
        audio_fx: None,
        workspaces: Some(BTreeMap::from([
            ("simple-2d".to_owned(), "workspaces/simple-2d".to_owned()),
            ("none".to_owned(), "workspaces/none".to_owned()),
        ])),
        build: Some(BuildCommands {
            install: "npm ci".to_owned(),
            build: "npm run build".to_owned(),
        }),
        toolchain: Some(ToolchainCommands {
            typecheck: "npm run typecheck".to_owned(),
            lint: None,
            format: None,
            test: None,
        }),
    }
}

#[test]
fn keys_follow_struct_declaration_order() {
    let emitted = to_canonical_toml(&manifest()).expect("the manifest serializes");
    let keys: Vec<&str> = emitted
        .lines()
        .filter_map(|line| line.split_once(" = "))
        .map(|(key, _)| key)
        .collect();
    assert_eq!(keys, vec!["version", "summary", "description", "changelog"]);
}

#[test]
fn scalars_precede_tables_and_tables_follow_declaration_order() {
    let emitted = to_canonical_toml(&definition()).expect("the definition serializes");
    let first_table = emitted
        .find("\n[workspaces]")
        .expect("a table header is emitted");
    let scalars = &emitted[..first_table];
    assert!(scalars.contains("name = \"Carom, end to end\""));
    assert!(scalars.contains("prompt = \"prompts/end-to-end.hbs\""));
    let headers: Vec<&str> = emitted
        .lines()
        .filter(|line| line.starts_with('['))
        .collect();
    assert_eq!(headers, vec!["[workspaces]", "[build]", "[toolchain]"]);
}

#[test]
fn a_map_valued_table_is_keyed_in_sorted_order() {
    let emitted = to_canonical_toml(&definition()).expect("the definition serializes");
    let workspaces = emitted
        .split("[workspaces]\n")
        .nth(1)
        .and_then(|rest| rest.split("\n\n").next())
        .expect("the workspace table is emitted");
    assert_eq!(
        workspaces,
        "none = \"workspaces/none\"\nsimple-2d = \"workspaces/simple-2d\""
    );
}

#[test]
fn repeated_tables_emit_in_model_order() {
    let manifest = SpecificationManifest {
        id: "ball-physics".to_owned(),
        name: "Ball Physics".to_owned(),
        summary: "One short line.".to_owned(),
        path: "ball-physics.md".to_owned(),
        requirements: vec![
            requirement(vec!["ball/a.ts".to_owned()]),
            SuiteRequirement {
                id: "cushion".to_owned(),
                ..requirement(vec!["ball/b.ts".to_owned()])
            },
        ],
    };
    let emitted = to_canonical_toml(&manifest).expect("the specification serializes");
    let first = emitted
        .find("id = \"constant-speed\"")
        .expect("the first id");
    let second = emitted.find("id = \"cushion\"").expect("the second id");
    assert!(first < second, "model order is emission order");
    assert_eq!(emitted.matches("[[requirement]]").count(), 2);
}

#[test]
fn an_array_within_the_column_budget_is_inline() {
    // 83 characters puts the emitted line at exactly the budget:
    // `validators = ["…"]` is the path plus seventeen.
    let path = format!("ball/{}.ts", "a".repeat(75));
    assert_eq!(path.len(), 83);
    let emitted =
        to_canonical_toml(&requirement(vec![path.clone()])).expect("the requirement serializes");
    let line = format!("validators = [\"{path}\"]");
    assert_eq!(line.chars().count(), MAX_LINE_COLUMNS);
    assert!(emitted.contains(&line), "emitted:\n{emitted}");
}

#[test]
fn an_array_over_the_column_budget_is_one_entry_per_line() {
    // One character more than the test above, which is one column over budget.
    let path = format!("ball/{}.ts", "a".repeat(76));
    let emitted =
        to_canonical_toml(&requirement(vec![path.clone()])).expect("the requirement serializes");
    assert!(
        emitted.contains(&format!("validators = [\n  \"{path}\",\n]\n")),
        "emitted:\n{emitted}"
    );
}

#[test]
fn strings_are_basic_quoted_escaping_only_what_toml_requires() {
    let quoted = VersionManifest {
        summary: "A \"quoted\" line\twith a \\ and a \n break.".to_owned(),
        ..manifest()
    };
    let emitted = to_canonical_toml(&quoted).expect("the manifest serializes");
    assert!(
        emitted.contains(r#"summary = "A \"quoted\" line\twith a \\ and a \n break.""#),
        "emitted:\n{emitted}"
    );
    let parsed: VersionManifest = toml::from_str(&emitted).expect("the emitted TOML parses");
    assert_eq!(parsed, quoted);
}

#[test]
fn nested_tables_are_full_dotted_headers_with_unindented_keys() {
    let module = DebugApiModule {
        handle: Some("__carom".to_owned()),
        description: "The Carom debug surface.".to_owned(),
        functions: vec![DebugApiFunction {
            name: "state".to_owned(),
            kind: DebugApiFunctionKind::Query,
            signature: "state(index: number): BallState".to_owned(),
            description: "Reports the live ball state.".to_owned(),
            parameters: vec![DebugApiParameter {
                name: "index".to_owned(),
                description: "Zero-based ball index.".to_owned(),
            }],
        }],
        modules: Vec::new(),
    };
    let emitted = to_canonical_toml(&module).expect("the module serializes");
    assert!(
        emitted.contains("\n[[function.parameter]]\nname = \"index\"\n"),
        "emitted:\n{emitted}"
    );
}

#[test]
fn a_key_at_its_documented_default_is_omitted() {
    let emitted = to_canonical_toml(&definition()).expect("the definition serializes");
    assert!(!emitted.contains("max_runtime_hours"));
    assert!(!emitted.contains("experimental"));
    assert!(!emitted.contains("specifications"));
    let with_values = SuiteTestCaseDefinition {
        max_runtime_hours: 1.5,
        experimental: true,
        specifications: Some(Vec::new()),
        ..definition()
    };
    let emitted = to_canonical_toml(&with_values).expect("the definition serializes");
    assert!(emitted.contains("max_runtime_hours = 1.5"));
    assert!(emitted.contains("experimental = true"));
    assert!(emitted.contains("specifications = []"));
}

#[test]
fn an_optional_type_table_is_emitted_under_the_name_its_type_declares() {
    let definition = SuiteTestCaseDefinition {
        test_type: SuiteTestCaseType::Voxel,
        engines: Vec::new(),
        workspaces: None,
        build: None,
        toolchain: None,
        voxel: Some(VoxelCase {
            id: "player-ship".to_owned(),
            animated: true,
        }),
        ..definition()
    };
    let emitted = to_canonical_toml(&definition).expect("the definition serializes");
    assert!(emitted.contains("type = \"voxel\""));
    assert!(
        emitted.ends_with("\n[voxel]\nid = \"player-ship\"\nanimated = true\n"),
        "emitted:\n{emitted}"
    );
}

#[test]
fn emitting_a_reparsed_model_reproduces_the_same_bytes() {
    let emitted = to_canonical_toml(&definition()).expect("the definition serializes");
    let parsed: SuiteTestCaseDefinition =
        toml::from_str(&emitted).expect("the emitted TOML parses");
    let again = to_canonical_toml(&parsed).expect("the reparsed definition serializes");
    assert_eq!(emitted, again);
}

#[test]
fn init_is_a_scalar_emitted_after_experimental_and_omitted_when_absent() {
    let with_init = SuiteTestCaseDefinition {
        experimental: true,
        ..definition()
    };
    let emitted = to_canonical_toml(&with_init).expect("the definition serializes");
    let keys: Vec<&str> = emitted
        .split("\n[")
        .next()
        .expect("the scalars precede the tables")
        .lines()
        .filter_map(|line| line.split_once(" = "))
        .map(|(key, _)| key)
        .collect();
    assert_eq!(
        keys,
        vec![
            "name",
            "type",
            "difficulty",
            "engines",
            "prompt",
            "experimental",
            "init"
        ]
    );
    assert!(
        emitted.contains("init = \"npm ci && npx playwright install chromium\"\n"),
        "emitted:\n{emitted}"
    );
    let reparsed: SuiteTestCaseDefinition = toml::from_str(&emitted).expect("the TOML parses");
    assert_eq!(reparsed.init, with_init.init);

    let without = SuiteTestCaseDefinition {
        init: None,
        ..definition()
    };
    let emitted = to_canonical_toml(&without).expect("the definition serializes");
    assert!(!emitted.contains("init"), "emitted:\n{emitted}");
}
