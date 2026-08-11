//! Run shell commands in the workspace.
//!
//! One function, and the way a program reaches everything gg has no tool for: a build, a test run,
//! `git`, `curl`, a package manager. The workspace is the working directory.
//!
//! A non-zero exit is a *result* rather than a failure, because deciding whether a build or a test
//! run passed is the single most common thing a program does with one.

use crate::bindings::test_cabinet::gg::shell;
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &["shell"];


/// Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.
///
/// A non-zero exit is not a failure: read [`exit_code`](ShellOutput::exit_code) on the result. Only a
/// process that could not be launched, or one the timeout killed, is an `Err`.
///
/// This run may **offload** shell output — the `shell` tool's own description says which mode is in
/// force. Under `offload`, [`output`](ShellOutput::output) holds only the tail that fits and ends
/// with a note naming the two files the command's full stdout and stderr were written to. Under
/// `adaptive`, the default, a command that succeeded returns no output at all, only that note, and
/// one that failed returns the tail. Grepping the named files is cheaper than re-running the command.
///
/// # Arguments
///
/// * `command` — The command line, run by `sh -c` with the workspace as its working directory.
/// * `timeout_secs` — How long to let it run, in seconds, before killing it. `None` takes gg's
///   default of 120, clamped to whatever is left of the run's wall-clock budget.
///
/// # Returns
///
/// What the process reported when it finished — its exit status, and however much of its merged
/// output this run's offload mode leaves in the program's hands.
///
/// # Errors
///
/// `LimitExceeded` when the timeout killed the process, and `IoError` when it could not be launched.
#[doc(alias = "ggop:shell.shell")]
pub fn run(command: &str, timeout_secs: Option<f64>) -> Result<ShellOutput, ToolError> {
    wire::lift(shell::shell(command, timeout_secs)).map(wire::shell_output)
}

/// What a command reported when it finished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellOutput {
    /// The process's exit status; `None` when a signal killed it. Zero means success.
    pub exit_code: Option<i32>,
    /// Merged stdout then stderr, tail-truncated at 16 KiB.
    ///
    /// Under a run that offloads shell output the ceiling is the configured line or character one,
    /// and a note naming the files holding the whole of it follows. Under the default `adaptive` mode
    /// a command that succeeded returns just that note.
    pub output: String,
    /// Whether the cap cut [`output`](Self::output), dropping the head and keeping the tail.
    pub truncated: bool,
}
