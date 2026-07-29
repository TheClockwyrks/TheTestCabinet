use super::*;

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_COMPLETION, COMPLETION_SIGNAL_EXPLICIT_CALL, COMPLETION_SIGNAL_PLAIN_TEXT,
    GgAgentConfig, GgCapabilityConfig,
};

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

/// An absent completion capability resolves to the historical defaults: a plain-text signal and no
/// validation, so an unconfigured run is unchanged.
#[test]
fn resolve_defaults_to_plain_text_ungated_when_absent() {
    let setup = CompletionSetup::resolve(&GgAgentConfig::root());
    assert_eq!(setup.signal(), CompletionSignal::PlainText);
    assert!(!setup.has_validation());
    assert!(!setup.explicit_finish(false));
}

/// An enabled capability with the explicit-call implementation resolves that signal.
#[test]
fn resolve_reads_explicit_call_signal() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        Some(COMPLETION_SIGNAL_EXPLICIT_CALL),
        json!({}),
    )));
    assert_eq!(setup.signal(), CompletionSignal::ExplicitCall);
}

/// The plain-text implementation resolves the plain-text signal explicitly.
#[test]
fn resolve_reads_plain_text_signal() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        Some(COMPLETION_SIGNAL_PLAIN_TEXT),
        json!({}),
    )));
    assert_eq!(setup.signal(), CompletionSignal::PlainText);
}

/// A present-but-disabled completion capability is the unchanged control: it records its config but
/// applies neither the signal nor the validation it would have used.
#[test]
fn disabled_capability_falls_back_to_defaults() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        false,
        Some(COMPLETION_SIGNAL_EXPLICIT_CALL),
        json!({ "validation": ["cargo test"] }),
    )));
    assert_eq!(setup.signal(), CompletionSignal::PlainText);
    assert!(!setup.has_validation());
}

/// An unrecognized implementation string falls back to the plain-text default rather than failing.
#[test]
fn unrecognized_signal_falls_back_to_plain_text() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        Some("teletype"),
        json!({}),
    )));
    assert_eq!(setup.signal(), CompletionSignal::PlainText);
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

/// `explicit_finish` is true only under an explicit-call signal AND on the tool-calling path — a
/// code-mode run always ends through its program's `finish`.
#[test]
fn explicit_finish_only_when_explicit_call_and_not_code() {
    let explicit = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        Some(COMPLETION_SIGNAL_EXPLICIT_CALL),
        json!({}),
    )));
    assert!(explicit.explicit_finish(false));
    assert!(!explicit.explicit_finish(true));

    let plain = CompletionSetup::resolve(&GgAgentConfig::root());
    assert!(!plain.explicit_finish(false));
}

/// The finish tool is named `finish` and requires a `summary`.
#[test]
fn finish_tool_definition_names_finish_and_requires_summary() {
    let definition = finish_tool_definition();
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
