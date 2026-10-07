//! Tests for the `read_skill` tool: it strips front matter, returns the body, lists
//! available names, and errors cleanly on an unknown or missing name.

use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::skills::SkillLibrary;
use crate::tools::ToolFailure;

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
    ReadSkillTool::new(Arc::new(SkillLibrary::loaded(dir.path())))
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

/// The skill's body *is* the result, so a successful read carries no sidecar — there is nothing
/// about it a caller could want that the text does not already hold.
#[tokio::test]
async fn a_read_skill_carries_no_sidecar() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = tool().invoke(json!({ "name": "intro" }), &ctx).await;

    assert!(outcome.ok);
    assert_eq!(outcome.data, None);
    assert_eq!(outcome.failure, None);
}

/// An unknown skill is `not-found` (the catalogue is finite and listed), while a malformed call is
/// an argument diagnostic — two different mistakes with two different fixes.
#[tokio::test]
async fn an_unknown_skill_is_not_found_and_a_malformed_call_is_not() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());

    let unknown = tool().invoke(json!({ "name": "missing" }), &ctx).await;
    assert_eq!(unknown.failure, Some(ToolFailure::NotFound));

    let malformed = tool().invoke(json!({}), &ctx).await;
    assert_eq!(malformed.failure, Some(ToolFailure::InvalidArgument));
}

/// The catalogue reaches the model through the `name` enum — the whole library, exactly — rather
/// than through prose repeating what the system prompt already lists.
#[test]
fn definition_advertises_the_available_skill_names() {
    let definition = tool().definition();
    assert_eq!(definition.name, READ_SKILL_TOOL);
    let names = definition.parameters["properties"]["name"]["enum"]
        .as_array()
        .expect("an enum of skill names");
    assert_eq!(names, &vec![json!("combat"), json!("intro")]);
}

/// A `name` that is not a string is an **argument** diagnostic, not a missing skill: the call is
/// malformed before the catalogue is consulted, so the model is told what to fix rather than which
/// skills exist.
#[tokio::test]
async fn a_read_skill_name_that_is_not_a_string_is_an_argument_error() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = tool().invoke(json!({ "name": 7 }), &ctx).await;

    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("name"), "{}", outcome.output);
}
