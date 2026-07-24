use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};

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
