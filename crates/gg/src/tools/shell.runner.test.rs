//! Tests for the [shell seam](super): that the real runner reports what a process did without
//! interpreting it, and that a substituted one really does replace the process for every path that
//! reaches a command line.

use std::sync::Arc;
use std::time::Duration;

use test_cabinet_core::gg_replay::GgShellOrigin;

use super::{RealShellRunner, ShellRequest, ShellRunner, ShellStatus, StubShellRunner, real_shell};
use crate::tools::{OffloadPolicy, ToolContext, run_command};

/// A request for `command`, run in `cwd` on behalf of `agent`, with a generous ceiling.
fn request(command: &str, cwd: &std::path::Path, agent: &str) -> ShellRequest {
    ShellRequest {
        command: command.to_string(),
        cwd: cwd.to_path_buf(),
        timeout: Duration::from_secs(30),
        agent_id: agent.to_string(),
        origin: GgShellOrigin::Tool,
    }
}

// ---------------------------------------------------------------------------
// The real runner
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_real_runner_reports_the_exit_code_and_both_streams() {
    let dir = tempfile::tempdir().expect("tempdir");
    let execution = RealShellRunner
        .run(request(
            "printf out; printf err >&2; exit 3",
            dir.path(),
            "root",
        ))
        .await;

    assert_eq!(execution.status, ShellStatus::Exited { code: Some(3) });
    // Reported *unmerged* and untruncated: merging and truncation are the caller's policy, and a
    // runner that had already applied them could not be swapped for one answering from a record.
    assert_eq!(execution.stdout, "out");
    assert_eq!(execution.stderr, "err");
}

#[tokio::test]
async fn the_real_runner_runs_in_the_requested_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).expect("create nested");

    let execution = RealShellRunner
        .run(request("basename \"$PWD\"", &nested, "root"))
        .await;

    assert_eq!(execution.status, ShellStatus::Exited { code: Some(0) });
    assert_eq!(execution.stdout.trim(), "nested");
}

#[tokio::test]
async fn the_real_runner_reports_a_timeout_as_its_own_status() {
    let dir = tempfile::tempdir().expect("tempdir");
    let execution = RealShellRunner
        .run(ShellRequest {
            command: "printf partial; sleep 30".to_string(),
            cwd: dir.path().to_path_buf(),
            timeout: Duration::from_millis(200),
            agent_id: "root".to_string(),
            origin: GgShellOrigin::Tool,
        })
        .await;

    // A gg-side ceiling, not the command failing — which is why it is its own status rather than an
    // absent exit code, indistinguishable from the signal-terminated case.
    //
    // Nothing is asserted about the streams: after the kill the runner waits only a short grace for
    // the reader tasks (a forked grandchild can hold the write end open indefinitely), so whatever
    // the process had printed is recovered on a best-effort basis and a test that demanded it would
    // be asserting a race. That predates the seam and is unchanged by it.
    assert_eq!(execution.status, ShellStatus::TimedOut);
}

#[tokio::test]
async fn the_real_runner_reports_a_launch_failure_with_empty_streams() {
    let missing = std::path::Path::new("/nonexistent-directory-for-the-seam-test");
    let execution = RealShellRunner.run(request("true", missing, "root")).await;

    match &execution.status {
        ShellStatus::LaunchFailed { failure, message } => {
            assert_eq!(*failure, crate::tools::ToolFailure::NotFound);
            assert!(
                message.starts_with("failed to launch shell command:"),
                "unexpected launch-failure message: {message}"
            );
        }
        other => panic!("expected a launch failure, got {other:?}"),
    }
    // Nothing ran, so there is nothing it printed — the distinction from a command that ran and
    // printed nothing.
    assert!(execution.stdout.is_empty());
    assert!(execution.stderr.is_empty());
}

// ---------------------------------------------------------------------------
// The seam itself
// ---------------------------------------------------------------------------

#[test]
fn a_bare_tool_context_runs_commands_for_real() {
    let ctx = ToolContext::new("/workspace");
    // The default has to fall this way: a context that was never told otherwise runs real
    // commands, so no caller can end up with a stubbed shell by forgetting to ask for a real one.
    assert_eq!(format!("{:?}", ctx.shell), format!("{:?}", real_shell()));
    assert!(ctx.agent_id.is_empty());
}

#[tokio::test]
async fn a_substituted_runner_replaces_the_process_entirely() {
    let dir = tempfile::tempdir().expect("tempdir");
    let stub = Arc::new(StubShellRunner::exiting(0, "answered from the stub"));
    let ctx = ToolContext::new(dir.path())
        .with_agent("agent-7")
        .with_shell(stub.clone());

    let outcome = run_command(
        "touch the-command-really-ran",
        Duration::from_secs(5),
        &OffloadPolicy::Inline,
        &ctx,
        GgShellOrigin::Tool,
    )
    .await;

    assert!(outcome.ok);
    assert!(
        outcome.output.contains("answered from the stub"),
        "the stub's output should be what the model reads: {}",
        outcome.output
    );
    // The whole point: the command did not run. A playback that left this file behind would be
    // building a tree out of side effects it claims to have stubbed.
    assert!(
        !dir.path().join("the-command-really-ran").exists(),
        "a substituted runner must not start the process"
    );
}

#[tokio::test]
async fn a_substituted_runner_is_told_the_command_the_directory_and_the_agent() {
    let dir = tempfile::tempdir().expect("tempdir");
    let stub = Arc::new(StubShellRunner::exiting(0, ""));
    let ctx = ToolContext::new(dir.path())
        .with_agent("agent-7")
        .with_shell(stub.clone());

    run_command(
        "npm run build",
        Duration::from_secs(11),
        &OffloadPolicy::Inline,
        &ctx,
        GgShellOrigin::Tool,
    )
    .await;

    let requests = stub.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].command, "npm run build");
    assert_eq!(requests[0].cwd, dir.path());
    assert_eq!(requests[0].timeout, Duration::from_secs(11));
    // The named property: the seam carries the *calling agent*. A runner given only a workspace
    // path could not know whose recorded commands to draw from, and every shell divergence has to
    // name an agent.
    assert_eq!(requests[0].agent_id, "agent-7");
}

#[tokio::test]
async fn the_callers_output_policy_still_applies_to_a_substituted_runner() {
    let dir = tempfile::tempdir().expect("tempdir");
    let stub = Arc::new(StubShellRunner::exiting(0, &"x".repeat(64 * 1024)));
    let ctx = ToolContext::new(dir.path()).with_shell(stub.clone());

    let outcome = run_command(
        "cat huge.log",
        Duration::from_secs(5),
        &OffloadPolicy::Inline,
        &ctx,
        GgShellOrigin::Tool,
    )
    .await;

    // The line the seam is drawn on: the runner owns what the process *did*, and gg's presentation
    // of it — the merge, the cap, the truncation note — stays this build of gg's, so a session
    // played back through a newer gg shows the newer gg's footer over the recorded bytes.
    assert!(
        outcome.output.contains("[output truncated to"),
        "gg's own truncation must still apply: {}",
        &outcome.output[..200.min(outcome.output.len())]
    );
}

#[test]
fn re_rooting_a_context_carries_the_agent_and_the_shell_across() {
    let stub = Arc::new(StubShellRunner::exiting(0, ""));
    let base = ToolContext::new("/workspace")
        .with_agent("agent-7")
        .with_shell(stub.clone());

    let derived = base.rooted_at("/workspace/web");

    assert_eq!(
        derived.workspace_dir,
        std::path::Path::new("/workspace/web")
    );
    // A validation command declaring a `cwd` is still that agent's command, and still runs through
    // that agent's shell. Building a fresh context for it would silently restore the real one.
    assert_eq!(derived.agent_id, "agent-7");
    assert_eq!(format!("{:?}", derived.shell), format!("{:?}", stub));
}
