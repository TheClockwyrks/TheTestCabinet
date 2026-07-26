use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext, ToolFailure};

/// The [`ShellData`] an outcome carries, or a failure naming what it carried instead.
fn shell_data(outcome: &ToolOutcome) -> &ShellData {
    match outcome.data.as_ref() {
        Some(ToolData::Shell(data)) => data,
        other => panic!("expected shell data, got {other:?}"),
    }
}

/// Invoke the shell tool against a fresh temp workspace.
async fn run(args: serde_json::Value) -> (ToolOutcome, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let outcome = ShellTool::new().invoke(args, &ctx).await;
    (outcome, dir)
}

/// A successful command reports `ok`, its exit code, and its stdout.
#[tokio::test]
async fn runs_command_and_reports_success_and_output() {
    let (outcome, _dir) = run(json!({ "command": "echo hello world" })).await;

    assert!(outcome.ok);
    assert!(outcome.output.contains("exit code: 0"));
    assert!(outcome.output.contains("hello world"));
    assert_eq!(outcome.summary.as_deref(), Some("exited 0"));
}

/// A non-zero exit is reported as a failure with the code preserved.
#[tokio::test]
async fn nonzero_exit_is_reported_as_failure() {
    let (outcome, _dir) = run(json!({ "command": "exit 3" })).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("exit code: 3"));
    assert_eq!(outcome.summary.as_deref(), Some("exited 3"));
}

/// stderr is captured and merged into the output.
#[tokio::test]
async fn captures_stderr() {
    let (outcome, _dir) = run(json!({ "command": "echo oops 1>&2" })).await;

    assert!(outcome.ok);
    assert!(outcome.output.contains("oops"));
}

/// The command runs with its cwd set to the workspace root.
#[tokio::test]
async fn runs_in_the_workspace_directory() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
    let ctx = ToolContext::new(dir.path());

    let outcome = ShellTool::new()
        .invoke(json!({ "command": "ls" }), &ctx)
        .await;

    assert!(outcome.ok);
    assert!(outcome.output.contains("marker.txt"));
}

/// A command that overruns its timeout is killed and reported as a failure.
#[tokio::test]
async fn enforces_timeout_and_kills_hung_command() {
    // A 0.2s budget against a 30s sleep: the tool must return promptly, not hang.
    let (outcome, _dir) = run(json!({ "command": "sleep 30", "timeout_secs": 0.2 })).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("timed out"));
}

/// A missing `command` argument is a well-formed error, not a panic.
#[tokio::test]
async fn missing_command_argument_is_an_error() {
    let (outcome, _dir) = run(json!({})).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("command"));
}

/// A non-positive timeout is rejected before running anything.
#[tokio::test]
async fn non_positive_timeout_is_rejected() {
    let (outcome, _dir) = run(json!({ "command": "echo hi", "timeout_secs": 0 })).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("timeout_secs"));
}

/// Output beyond the cap is truncated with a note; the tail (which holds the useful
/// final lines) is kept.
#[tokio::test]
async fn truncates_very_long_output() {
    // Emit well over the 16 KiB cap, ending with a recognizable sentinel line.
    let command =
        "for i in $(seq 1 5000); do echo 'padding-line-of-text'; done; echo SENTINEL_TAIL";
    let (outcome, _dir) = run(json!({ "command": command })).await;

    assert!(outcome.ok);
    assert!(outcome.output.contains("[output truncated"));
    assert!(outcome.output.contains("SENTINEL_TAIL"));
}

// ---------------------------------------------------------------------------
// The structured sidecar
// ---------------------------------------------------------------------------

/// A completed command reports its exit code, its own output (without gg's `exit code:` header)
/// and whether the cap cut it — the facts the prose states, as values.
#[tokio::test]
async fn shell_reports_the_exit_code_and_whether_it_truncated() {
    let (outcome, _dir) = run(json!({ "command": "echo hello world" })).await;

    let data = shell_data(&outcome);
    assert_eq!(data.exit_code, Some(0));
    assert_eq!(data.body, "hello world\n");
    assert!(!data.truncated);
    assert!(
        !data.body.contains("exit code"),
        "the body is the process's output, not gg's rendering of it: {}",
        data.body
    );
}

/// A non-zero exit is a *result*, not a failed call: the facts come back and nothing is classified
/// as a failure, so a caller can branch on the code instead of on `ok`.
#[tokio::test]
async fn a_non_zero_exit_is_reported_as_data_not_as_a_classified_failure() {
    let (outcome, _dir) = run(json!({ "command": "echo nope 1>&2; exit 3" })).await;

    assert!(!outcome.ok);
    assert_eq!(outcome.failure, None);
    let data = shell_data(&outcome);
    assert_eq!(data.exit_code, Some(3));
    assert_eq!(data.body, "nope\n");
}

/// Truncation is reported as a flag, not only as a bracketed note in the prose.
#[tokio::test]
async fn truncation_is_reported_in_the_sidecar() {
    let command =
        "for i in $(seq 1 5000); do echo 'padding-line-of-text'; done; echo SENTINEL_TAIL";
    let (outcome, _dir) = run(json!({ "command": command })).await;

    let data = shell_data(&outcome);
    assert!(data.truncated);
    assert!(data.body.len() <= MAX_OUTPUT_BYTES);
    assert!(data.body.ends_with("SENTINEL_TAIL\n"));
}

/// A timeout is gg's own ceiling, so it is classified as one — and carries no shell data, because
/// there is no exit code to report.
#[tokio::test]
async fn a_timeout_is_classified_as_a_limit() {
    let (outcome, _dir) = run(json!({ "command": "sleep 30", "timeout_secs": 0.2 })).await;

    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert_eq!(outcome.data, None);
}

/// Argument diagnostics are classified as bad arguments, whichever one was wrong.
#[tokio::test]
async fn argument_diagnostics_are_classified_as_invalid_arguments() {
    for args in [
        json!({}),
        json!({ "command": 7 }),
        json!({ "command": "echo hi", "timeout_secs": 0 }),
        json!({ "command": "echo hi", "timeout_secs": "soon" }),
    ] {
        let (outcome, _dir) = run(args.clone()).await;
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{args} should be an argument diagnostic"
        );
    }
}

/// The definition advertises the tool's name and required `command` parameter.
#[test]
fn definition_shape() {
    let def = ShellTool::new().definition();
    assert_eq!(def.name, "shell");
    assert_eq!(def.parameters["required"], json!(["command"]));
    assert_eq!(
        def.parameters["properties"]["command"]["type"],
        json!("string")
    );
}
