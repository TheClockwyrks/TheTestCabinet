//! run shell commands in the workspace
//!
//! One function, and it is the widest one this SDK has: everything a command line can do, a program
//! can do through it. A non-zero exit is a *result* rather than a failure, because deciding whether
//! a build or a test run passed is the single most common thing a program does with it.

use crate::bindings::test_cabinet::gg::shell;
use crate::error::ToolError;
use crate::types::ShellOutput;
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &["shell"];

crate::meta::directory_of!("system");

/// Run a command with `sh -c` in the workspace directory and hand back its merged stdout and stderr.
///
/// A non-zero exit is NOT a failure — read `exit_code` on the result; only a process that could not
/// be launched, or one the timeout killed, is an `Err`.
///
/// This run may **offload** shell output — the `shell` tool's own description says which mode is in
/// force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the two
/// files the command's full stdout and stderr were written to. Under `adaptive` (the default), a
/// command that **succeeded** returns no output at all, only that note; one that **failed** returns
/// the tail. Grep the named files instead of re-running the command.
///
/// # Arguments
///
/// * `command` — The command line, run by `sh -c` with your workspace as its working directory.
/// * `timeout_secs` — How long to let it run, in seconds, before killing it. `None` takes gg's
///   default of 120, which is clamped to whatever is left of the run's wall-clock budget.
///
/// # Errors
///
/// `LimitExceeded` when the timeout killed the process, and `IoError` when it could not be launched.
pub fn shell(command: &str, timeout_secs: Option<f64>) -> Result<ShellOutput, ToolError> {
    wire::lift(shell::shell(command, timeout_secs)).map(wire::shell_output)
}
