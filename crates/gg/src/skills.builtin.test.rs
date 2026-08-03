//! Tests for the skills gg ships — one per family of its own functions.

use serde_json::json;

use super::*;
use crate::model::ToolDefinition;

/// A `read_file` definition, as the registry would build one.
fn read_file() -> ToolDefinition {
    ToolDefinition::new(
        "read_file",
        "Read a file from the workspace.",
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The path to read." },
                "limit": { "type": "integer", "description": "How many lines." }
            },
            "required": ["path"]
        }),
    )
}

/// The names of the skills produced for an agent offering `offered`, in native tool-calling mode.
fn native(offered: &[&str], params: serde_json::Value) -> Vec<Skill> {
    let names: Vec<String> = offered.iter().map(|name| (*name).to_string()).collect();
    builtin_skills(
        &names,
        &[read_file()],
        EndingRole::Standard,
        /* library */ false,
        /* code_mode */ false,
        &params,
    )
}

#[test]
fn a_family_with_nothing_bound_is_not_offered() {
    let skills = native(&["read_file"], json!({}));
    let names: Vec<&str> = skills.iter().map(Skill::name).collect();
    // The one family this agent has anything from, and no others: a skill that described a tool the
    // agent lacks is the one thing a catalogue must never do.
    assert_eq!(names, vec!["gg-filesystem"]);
}

#[test]
fn an_agent_with_nothing_at_all_gets_no_built_ins() {
    assert!(native(&[], json!({})).is_empty());
}

#[test]
fn the_native_body_is_built_from_the_live_tool_definitions() {
    let skills = native(&["read_file"], json!({}));
    let body = skills[0].body();
    assert!(body.contains("`read_file`"), "{body}");
    assert!(body.contains("Read a file from the workspace."), "{body}");
    // The parameters come from the schema the model is really held to, required-ness included.
    assert!(
        body.contains("`path` (string) — The path to read."),
        "{body}"
    );
    assert!(body.contains("`limit` (integer, optional)"), "{body}");
    // Native mode has no programs to bind code into, so a built-in carries none.
    assert_eq!(skills[0].code(), None);
    assert_eq!(skills[0].on_use(), None);
}

#[test]
fn a_native_skill_only_lists_the_tools_the_agent_really_has() {
    // `write_file` is in the filesystem family but is not offered here, so it must not appear.
    let body = native(&["read_file"], json!({}))[0].body().to_string();
    assert!(!body.contains("write_file"), "{body}");
}

#[test]
fn the_code_arm_carries_an_on_use_script_and_no_body() {
    let skills = builtin_skills(
        &["read_file".to_string()],
        &[read_file()],
        EndingRole::Standard,
        /* library */ false,
        /* code_mode */ true,
        &json!({}),
    );
    let fs = skills
        .iter()
        .find(|skill| skill.name() == "gg-filesystem")
        .expect("the filesystem family is offered");
    assert_eq!(fs.body(), "");
    assert_eq!(fs.code(), None, "a built-in exposes no importable code");
    let script = fs.on_use().expect("the code arm carries a script");
    assert!(script.contains("view.openDocsView(name)"), "{script}");
    assert!(script.contains("\"readFile\""), "{script}");
    // `list` documents itself and is on every object; eleven identical blocks would be eleven too
    // many.
    assert!(!script.contains("\"list\""), "{script}");
}

#[test]
fn the_code_arm_offers_the_carve_out_families_a_native_run_has_no_tools_for() {
    let skills = builtin_skills(
        &[],
        &[],
        EndingRole::Standard,
        /* library */ true,
        /* code_mode */ true,
        &json!({}),
    );
    let names: Vec<&str> = skills.iter().map(Skill::name).collect();
    // `view` and `harness` are bound to every program whatever a run enables; `programs` follows the
    // library flag.
    assert!(names.contains(&"gg-views"), "{names:?}");
    assert!(names.contains(&"gg-session"), "{names:?}");
    assert!(names.contains(&"gg-programs"), "{names:?}");
}

#[test]
fn the_program_library_family_follows_the_library_flag() {
    let without = builtin_skills(
        &[],
        &[],
        EndingRole::Standard,
        /* library */ false,
        /* code_mode */ true,
        &json!({}),
    );
    assert!(!without.iter().any(|skill| skill.name() == "gg-programs"));
}

#[test]
fn a_reviewers_session_skill_documents_the_reviewers_ending() {
    let skills = builtin_skills(&[], &[], EndingRole::Review, false, true, &json!({}));
    let session = skills
        .iter()
        .find(|skill| skill.name() == "gg-session")
        .expect("every role has an ending");
    let script = session.on_use().expect("a script");
    // A reviewer has no `finish`, so its skill must not open a view of one.
    assert!(script.contains("\"approve\""), "{script}");
    assert!(!script.contains("\"finish\""), "{script}");
}

#[test]
fn a_switched_off_family_is_withheld() {
    let skills = native(
        &["read_file"],
        json!({ "builtIns": { "gg-filesystem": false } }),
    );
    assert!(skills.is_empty());
}

#[test]
fn a_toggle_set_that_switches_nothing_off_offers_everything() {
    let skills = native(
        &["read_file"],
        json!({ "builtIns": { "gg-filesystem": true } }),
    );
    assert_eq!(skills.len(), 1);
}

#[test]
fn a_params_object_of_the_wrong_shape_is_ignored_rather_than_obeyed() {
    // In line with how gg reads every other capability value it cannot make sense of.
    let skills = native(&["read_file"], json!({ "builtIns": "gg-filesystem" }));
    assert_eq!(skills.len(), 1);
}
