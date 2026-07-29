use super::*;

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{CAPABILITY_COMPLETION, GgAgentConfig, GgCapabilityConfig};

use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::ToolContext;

/// A completion capability config with the given enabled flag, implementation, and params.
fn completion_cap(
    enabled: bool,
    implementation: Option<&str>,
    params: serde_json::Value,
) -> GgCapabilityConfig {
    GgCapabilityConfig {
        id: CAPABILITY_COMPLETION.to_string(),
        enabled,
        implementation: implementation.map(str::to_string),
        params,
    }
}

/// A root profile carrying exactly the given completion capability (its default capabilities are
/// irrelevant to completion resolution, which reads only the completion capability).
fn profile_with(cap: GgCapabilityConfig) -> GgAgentConfig {
    let mut profile = GgAgentConfig::root();
    profile.capabilities.push(cap);
    profile
}

/// An emitter whose telemetry is discarded — [`run_validation`] emits progress logs we do not
/// assert on here.
fn emitter() -> Emitter {
    Emitter::with_sink(None, Box::new(CollectingSink::new())).for_agent("root", None)
}

/// An absent completion capability leaves the ending ungated.
#[test]
fn resolve_leaves_the_ending_ungated_when_absent() {
    let setup = CompletionSetup::resolve(&GgAgentConfig::root());
    assert!(!setup.has_validation());
}

/// A present-but-disabled completion capability is the unchanged control: it records its config but
/// applies none of the validation it would have run.
#[test]
fn disabled_capability_gates_nothing() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        false,
        None,
        json!({ "validation": ["cargo test"] }),
    )));
    assert!(!setup.has_validation());
}

/// Each [role](EndingRole) is offered exactly its own ending calls, and each definition demands what
/// that role's verdict is made of — a change list that cannot be empty, a bounded attempt number.
#[test]
fn role_tool_definitions_carry_each_role_s_shape() {
    let standard = role_tool_definitions(EndingRole::Standard);
    assert_eq!(
        standard.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [FINISH_TOOL]
    );

    let review = role_tool_definitions(EndingRole::Review);
    assert_eq!(
        review.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [APPROVE_TOOL, REQUEST_CHANGES_TOOL]
    );
    let items = &review[1].parameters["properties"]["items"];
    assert_eq!(
        items["minItems"], 1,
        "a rejection must name at least one change"
    );

    let judge = role_tool_definitions(EndingRole::Judge { attempts: 4 });
    assert_eq!(
        judge.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [SELECT_WINNER_TOOL]
    );
    let attempt = &judge[0].parameters["properties"]["attempt"];
    assert_eq!(attempt["minimum"], 1);
    assert_eq!(
        attempt["maximum"], 4,
        "the judge may only pick among the attempts it was shown"
    );
}

/// The feedback for a text-only reply names the calls the reader actually has — never one its role
/// was not given.
#[test]
fn missing_completion_feedback_names_only_this_role_s_calls() {
    let standard = missing_completion_feedback(EndingRole::Standard);
    assert!(standard.contains(FINISH_TOOL), "{standard}");

    let review = missing_completion_feedback(EndingRole::Review);
    assert!(review.contains(APPROVE_TOOL), "{review}");
    assert!(review.contains(REQUEST_CHANGES_TOOL), "{review}");
    assert!(
        !review.contains(FINISH_TOOL),
        "a reviewer is never pointed at a `finish` it does not have: {review}"
    );
}

/// The validation param parses the object form, including a per-command `cwd`.
#[test]
fn resolve_parses_validation_object_form() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({
            "validation": [
                { "command": "cargo build", "cwd": "sub", "timeoutSecs": 30 },
                { "command": "cargo test" }
            ]
        }),
    )));
    assert!(setup.has_validation());
    let displays: Vec<String> = setup
        .validation()
        .iter()
        .map(ValidationCommand::display)
        .collect();
    assert_eq!(displays, vec!["cargo build (in sub)", "cargo test"]);
}

/// A bare string is shorthand for a command in gg's working directory.
#[test]
fn resolve_parses_validation_string_shorthand() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({ "validation": ["make check"] }),
    )));
    assert_eq!(
        setup
            .validation()
            .iter()
            .map(ValidationCommand::display)
            .collect::<Vec<_>>(),
        vec!["make check".to_string()],
    );
}

/// Malformed validation entries (no usable command) are dropped rather than failing the whole run.
#[test]
fn resolve_drops_malformed_validation_entries() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({
            "validation": [
                "",
                { "cwd": "sub" },
                42,
                { "command": "  " },
                { "command": "cargo test" }
            ]
        }),
    )));
    assert_eq!(
        setup
            .validation()
            .iter()
            .map(ValidationCommand::display)
            .collect::<Vec<_>>(),
        vec!["cargo test".to_string()],
    );
}

/// The finish tool is named `finish` and requires a `summary`.
#[test]
fn finish_tool_definition_names_finish_and_requires_summary() {
    let definition = &role_tool_definitions(EndingRole::Standard)[0];
    assert_eq!(definition.name, FINISH_TOOL);
    assert_eq!(
        definition.parameters["required"],
        json!(["summary"]),
        "the finish tool requires a summary",
    );
}

/// Validation passes when every command exits 0, so completion is allowed (`None`).
#[tokio::test]
async fn run_validation_passes_when_all_commands_succeed() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![
        ValidationCommand::from_value(&json!("true")).unwrap(),
        ValidationCommand::from_value(&json!({ "command": "exit 0" })).unwrap(),
    ];
    assert!(
        run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter())
            .await
            .is_none()
    );
}

/// The first failing command rejects completion, and its feedback names the command and carries its
/// output.
#[tokio::test]
async fn run_validation_reports_first_failure() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![
        ValidationCommand::from_value(&json!("echo building")).unwrap(),
        ValidationCommand::from_value(&json!("echo boom && exit 1")).unwrap(),
        // Never reached — the batch is fail-fast.
        ValidationCommand::from_value(&json!("echo unreached")).unwrap(),
    ];
    let feedback = run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter())
        .await
        .expect("a failing command rejects the completion");
    assert!(
        feedback.contains("Completion attempt rejected"),
        "{feedback}"
    );
    assert!(
        feedback.contains("echo boom"),
        "names the failing command: {feedback}"
    );
    assert!(
        feedback.contains("boom"),
        "carries the command output: {feedback}"
    );
    assert!(
        !feedback.contains("unreached"),
        "stops at the first failure: {feedback}"
    );
}

/// A command with no `cwd` runs in gg's working directory (the passed context's workspace).
#[tokio::test]
async fn run_validation_defaults_cwd_to_workspace() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![ValidationCommand::from_value(&json!("test -f marker.txt")).unwrap()];
    assert!(
        run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter())
            .await
            .is_none()
    );
}

/// A relative `cwd` is resolved against gg's working directory, so the command runs in the subdir.
#[tokio::test]
async fn run_validation_runs_in_declared_cwd() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(sub.join("inner.txt"), "x").unwrap();
    let ctx = ToolContext::new(dir.path());

    // In the workspace root the marker is absent (fails); in `sub` it is present (passes).
    let at_root = vec![ValidationCommand::from_value(&json!("test -f inner.txt")).unwrap()];
    assert!(
        run_validation(&at_root, &ctx, &OffloadPolicy::Inline, &emitter())
            .await
            .is_some()
    );

    let in_sub = vec![
        ValidationCommand::from_value(&json!({ "command": "test -f inner.txt", "cwd": "sub" }))
            .unwrap(),
    ];
    assert!(
        run_validation(&in_sub, &ctx, &OffloadPolicy::Inline, &emitter())
            .await
            .is_none()
    );
}
