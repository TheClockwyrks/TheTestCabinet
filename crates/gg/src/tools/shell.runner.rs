//! The **shell seam**: the one thing in gg that actually starts a process, behind a trait.
//!
//! A gg session has exactly two inputs that are not a function of its own state — the model call
//! and the shell — and between them they account for ~all of a run's wall clock and ~all of its
//! cost. The model call has had a seam since the beginning (the
//! [client factory](crate::client::ClientFactory) every agent resolves through); this module gives
//! the shell the matching one, so a
//! [playback](https://docs.testcabinet.ai/gg/analysis/playback/) can answer a recorded session's
//! commands from its record instead of running them.
//!
//! # Why the seam is here and not at the tool
//!
//! Three call paths reach a command line — the [`shell`](super::SHELL_TOOL) tool, a
//! [responses-as-code](crate::sandbox) program's `system.shell(…)`, and the
//! [completion](crate::completion) gate's validation commands — and the only thing all three share
//! is the [`ToolContext`](super::ToolContext). So the runner travels on the context, and both
//! [`run_command`](super::run_command) and
//! [`run_command_capturing`](super::run_command_capturing) reach it from there. Splitting the seam
//! any lower (at the `shell` tool) would leave the other two paths running real commands during a
//! reconstruction; splitting it any higher would need three seams that could disagree.
//!
//! # What is on each side of it
//!
//! The runner owns **only the process**: spawn `sh -c`, drain both pipes, enforce the per-command
//! timeout, and report what happened. Everything a model actually reads — merging the two streams,
//! the [output policy](super::OffloadPolicy), gg's truncation notes, the [`ToolOutcome`] shape — is
//! on the *caller's* side, in [`shell`](super). That line is deliberate: a substituted runner
//! replaces what a command *did*, and inherits gg's presentation of it verbatim. A recorded session
//! played back through a newer gg therefore shows the newer gg's truncation footer over the
//! recorded bytes, which is the comparison a playback exists to make.
//!
//! [`ToolOutcome`]: super::ToolOutcome

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use async_trait::async_trait;
use test_cabinet_core::gg_replay::GgShellOrigin;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::ToolFailure;

/// After a timeout kill, how long to wait for the reader tasks to drain whatever was
/// already captured before giving up (a forked grandchild may hold the pipe open).
const OUTPUT_GRACE: Duration = Duration::from_millis(250);

/// One command line, as handed to whatever is going to run it.
///
/// Owned rather than borrowed because a substituted runner keeps what it was asked for — a
/// [playback](https://docs.testcabinet.ai/gg/analysis/playback/) matches the pair
/// (command, directory) against the recorded queue and reports the misses — and because the cost
/// of two allocations is nothing beside starting a process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellRequest {
    /// The command line, run as `sh -c <command>`.
    pub command: String,
    /// The directory to run it in. Already resolved: the calling agent's workspace root, or the
    /// directory a [validation command](crate::completion) declared relative to it.
    pub cwd: PathBuf,
    /// gg's per-command ceiling, after any budget clamp the caller applied.
    pub timeout: Duration,
    /// The agent whose turn issued the command, empty for a dispatch with no agent behind it.
    ///
    /// Carried because a recorded shell is keyed **per agent**: a runner given only a workspace
    /// path cannot know whose recorded commands to draw from, every shell divergence names an
    /// agent, and the [completion](crate::completion) gate's commands in particular have to be
    /// attributed to the agent whose ending they gate or they land on an unattributed queue.
    /// [`RealShellRunner`] has no use for it — a real process is a real process — so the only
    /// reader is a [playback](crate::playback)'s recorded runner.
    pub agent_id: String,
    /// **Which of gg's three command paths** this line came from: the [`shell`](super::SHELL_TOOL)
    /// tool, a [responses-as-code](crate::sandbox) program's `system.shell(…)`, or the
    /// [completion](crate::completion) gate's validation commands.
    ///
    /// Carried on the request rather than derived at the recorder, because the seam is the *only*
    /// place all three meet and by the time a command reaches it the caller is gone. It is what
    /// keeps a completion gate's command off the agent's ordinary queue — a validation command and
    /// a `shell` tool call are different inputs even when the text is identical — and it is the one
    /// field [`RealShellRunner`] ignores and a
    /// [recording](crate::replay::RecordingShellRunner) one exists for.
    pub origin: GgShellOrigin,
}

/// How a command's process ended, as the [runner](ShellRunner) saw it.
///
/// Four cases rather than an exit code, because the three that are not an ordinary exit are
/// presented to the model differently and one of them ([`LaunchFailed`](Self::LaunchFailed)) never
/// reaches the [output policy](super::OffloadPolicy) at all. Collapsing them into
/// `Option<i32>` — which is what the caller-facing
/// [`CommandCapture`](super::shell::CommandCapture) does — would make a timeout and a
/// signal-terminated process indistinguishable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellStatus {
    /// The process ran to completion. `code` is `None` for one a signal ended.
    Exited {
        /// Its exit status, or `None` when a signal ended it.
        code: Option<i32>,
    },
    /// The [request's](ShellRequest::timeout) ceiling expired and gg killed the process group.
    /// Whatever it had already printed is still reported.
    TimedOut,
    /// The process never started — `sh` could not be spawned. The one shell failure that is a
    /// failure *of the call* rather than a result of it, so it carries the classified failure and
    /// the message the model is told, and its streams are empty.
    LaunchFailed {
        /// How the failure is classified to a structured caller.
        failure: ToolFailure,
        /// The model-facing message.
        message: String,
    },
    /// The process started but `wait()` itself failed — rare, and reported rather than papered
    /// over as a success.
    WaitFailed {
        /// How the failure is classified to a structured caller.
        failure: ToolFailure,
        /// The model-facing message.
        message: String,
    },
}

/// What one command's process did, **before** any output policy touched it — the whole of what a
/// [`ShellRunner`] answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellExecution {
    /// How it ended.
    pub status: ShellStatus,
    /// Everything it wrote to standard output.
    pub stdout: String,
    /// Everything it wrote to standard error.
    pub stderr: String,
}

impl ShellExecution {
    /// The execution of a command that never ran at all. Distinct from one that ran and printed
    /// nothing, which is why [`LaunchFailed`](ShellStatus::LaunchFailed) exists rather than an
    /// absent exit code.
    fn never_ran(failure: ToolFailure, message: String) -> Self {
        Self {
            status: ShellStatus::LaunchFailed { failure, message },
            stdout: String::new(),
            stderr: String::new(),
        }
    }
}

/// Runs a command line and reports what the process did.
///
/// The **only** implementation in a live run is [`RealShellRunner`]; the reason the trait exists is
/// that a [playback](https://docs.testcabinet.ai/gg/analysis/playback/) substitutes one that
/// answers from a [record](test_cabinet_core::gg_replay) instead. `Debug` is required so the
/// [`ToolContext`](super::ToolContext) carrying it stays printable, which several tool errors rely
/// on.
#[async_trait]
pub trait ShellRunner: Send + Sync + std::fmt::Debug {
    /// Run `request` to completion and report what happened. Never fails: a process that could not
    /// even be started is a [`LaunchFailed`](ShellStatus::LaunchFailed) execution, so every caller
    /// has exactly one shape to handle.
    async fn run(&self, request: ShellRequest) -> ShellExecution;
}

/// The production [`ShellRunner`]: `sh -c` in the requested directory, its own process group, both
/// pipes drained concurrently with the wait, killed on the request's ceiling.
#[derive(Debug, Clone, Copy, Default)]
pub struct RealShellRunner;

/// The one [`RealShellRunner`] every [`ToolContext`](super::ToolContext) that was not handed a
/// substitute points at.
///
/// A shared singleton rather than a fresh `Arc` per context because the runner is a zero-sized
/// unit: gg builds a tool context per agent *per turn*, and there is nothing to own.
static REAL_SHELL: LazyLock<Arc<dyn ShellRunner>> = LazyLock::new(|| Arc::new(RealShellRunner));

/// The shared [`RealShellRunner`] handle — what an unsubstituted
/// [`ToolContext`](super::ToolContext) runs commands through.
pub fn real_shell() -> Arc<dyn ShellRunner> {
    Arc::clone(&REAL_SHELL)
}

#[async_trait]
impl ShellRunner for RealShellRunner {
    async fn run(&self, request: ShellRequest) -> ShellExecution {
        let ShellRequest {
            command,
            cwd,
            timeout,
            ..
        } = request;

        let mut command_builder = Command::new("sh");
        command_builder
            .arg("-c")
            .arg(&command)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Reap the child if we drop it (e.g. on an early return).
            .kill_on_drop(true);
        // Put the command in its own process group so a timeout kill reaches the whole
        // tree — `sh` may fork the command into a grandchild that would otherwise survive
        // (and hold the output pipe open) when only `sh` is killed.
        #[cfg(unix)]
        command_builder.process_group(0);

        let mut child = match command_builder.spawn() {
            Ok(child) => child,
            Err(err) => {
                return ShellExecution::never_ran(
                    ToolFailure::from_io(&err),
                    format!("failed to launch shell command: {err}"),
                );
            }
        };

        // Drain both pipes concurrently with the wait so a command that fills a pipe
        // buffer cannot deadlock, and partial output survives a timeout kill.
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let out_task = tokio::spawn(async move { read_stream(&mut stdout).await });
        let err_task = tokio::spawn(async move { read_stream(&mut stderr).await });

        let waited = tokio::time::timeout(timeout, child.wait()).await;

        let timed_out = waited.is_err();
        if timed_out {
            // The command overran its budget; signal a kill so it cannot wedge the run.
            // We do not `.await` the kill (or the reader tasks unboundedly): a forked
            // grandchild can keep the pipe's write end open past the kill, so we bound the
            // final output collection with a short grace below rather than block on it.
            let _ = child.start_kill();
        }

        // Collect the captured output. On a clean exit the pipes are already closed, so the
        // readers finish immediately; on a timeout a lingering grandchild might hold a pipe
        // open, so we wait only a short grace for whatever was captured and then move on.
        let collect = async {
            let stdout = out_task.await.unwrap_or_default();
            let stderr = err_task.await.unwrap_or_default();
            (stdout, stderr)
        };
        let (stdout, stderr) = if timed_out {
            tokio::time::timeout(OUTPUT_GRACE, collect)
                .await
                .unwrap_or_default()
        } else {
            collect.await
        };

        let status = match waited {
            Ok(Ok(status)) => ShellStatus::Exited {
                code: status.code(),
            },
            // `child.wait()` itself failed (rare): report it rather than pretend success.
            Ok(Err(err)) => ShellStatus::WaitFailed {
                failure: ToolFailure::from_io(&err),
                message: format!("waiting on shell command: {err}"),
            },
            Err(_) => ShellStatus::TimedOut,
        };

        ShellExecution {
            status,
            stdout,
            stderr,
        }
    }
}

/// Read a captured pipe to EOF as lossy UTF-8 (build output is not guaranteed valid
/// UTF-8). A `None` handle (unexpected) reads as empty.
async fn read_stream<R>(reader: &mut Option<R>) -> String
where
    R: AsyncReadExt + Unpin,
{
    let Some(reader) = reader.as_mut() else {
        return String::new();
    };
    let mut buf = Vec::new();
    // A read error mid-stream still yields whatever was captured before it.
    let _ = reader.read_to_end(&mut buf).await;
    String::from_utf8_lossy(&buf).into_owned()
}

/// A [`ShellRunner`] that starts nothing: it records every [request](ShellRequest) it is handed and
/// answers each with the same canned [execution](ShellExecution).
///
/// The test double for the seam itself, kept beside the trait rather than in one test file because
/// three of gg's modules need it — the seam is only meaningful if the `shell` tool, a
/// [responses-as-code](crate::sandbox) program and the [completion](crate::completion) gate all
/// reach it, and proving that means substituting it from each of their tests. It is also the shape
/// a playback's recorded runner takes, minus the queue: record what was asked, answer without
/// touching the machine.
#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct StubShellRunner {
    /// Every request handed to [`run`](ShellRunner::run), in order.
    requests: Arc<std::sync::Mutex<Vec<ShellRequest>>>,
    /// What every one of them is answered with.
    answer: ShellExecution,
}

#[cfg(test)]
impl StubShellRunner {
    /// A stub answering every command with exit `code` and `stdout`, and nothing on stderr.
    pub(crate) fn exiting(code: i32, stdout: &str) -> Self {
        Self {
            requests: Arc::new(std::sync::Mutex::new(Vec::new())),
            answer: ShellExecution {
                status: ShellStatus::Exited { code: Some(code) },
                stdout: stdout.to_string(),
                stderr: String::new(),
            },
        }
    }

    /// Every request it has been handed, in order.
    pub(crate) fn requests(&self) -> Vec<ShellRequest> {
        self.requests.lock().expect("stub shell lock").clone()
    }
}

#[cfg(test)]
#[async_trait]
impl ShellRunner for StubShellRunner {
    async fn run(&self, request: ShellRequest) -> ShellExecution {
        self.requests.lock().expect("stub shell lock").push(request);
        self.answer.clone()
    }
}

#[cfg(test)]
#[path = "shell.runner.test.rs"]
mod tests;
