//! Tests for the `read_skill` tool: it strips front matter, returns the body, lists
//! available names, and errors cleanly on an unknown or missing name.

use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::skills::SkillLibrary;

/// A tool over a two-skill library (`intro`, `combat`).
fn tool() -> ReadSkillTool {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("intro.md"),
        "---\nname: intro\ndescription: getting started.\n---\nintro body text",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("combat.md"),
        "---\nname: combat\ndescription: combat design.\n---\ncombat body text",
    )
    .unwrap();
    ReadSkillTool::new(Arc::new(SkillLibrary::load(dir.path())))
}

#[tokio::test]
async fn read_skill_returns_the_stripped_body() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = tool().invoke(json!({ "name": "intro" }), &ctx).await;

    assert!(outcome.ok);
    assert_eq!(outcome.output, "intro body text");
    // The front matter never reaches the model.
    assert!(!outcome.output.contains("description:"));
    assert_eq!(outcome.summary.as_deref(), Some("read skill `intro`"));
}

#[tokio::test]
async fn read_skill_errors_on_an_unknown_name() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = tool().invoke(json!({ "name": "missing" }), &ctx).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("no skill named `missing`"));
    // The error lists what is available so the model can recover.
    assert!(outcome.output.contains("intro"));
    assert!(outcome.output.contains("combat"));
}

#[tokio::test]
async fn read_skill_errors_on_a_missing_name_argument() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = tool().invoke(json!({}), &ctx).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("name"));
}

#[test]
fn definition_advertises_the_available_skill_names() {
    let definition = tool().definition();
    assert_eq!(definition.name, READ_SKILL_TOOL);
    assert!(definition.description.contains("intro"));
    assert!(definition.description.contains("combat"));
    // The name parameter is constrained to the known skills.
    let names = definition.parameters["properties"]["name"]["enum"]
        .as_array()
        .expect("an enum of skill names");
    assert_eq!(names.len(), 2);
}
