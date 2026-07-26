//! The `shell` tool: run a command in the run container, rooted at the workspace.
//!
//! gg runs inside the run container, so the shell tool executes on the **local**
//! shell (`sh -c`) with its working directory set to the invocation's workspace
//! root. It captures the command's combined output (stdout then stderr), truncates it
//! to a cap so a chatty build can't flood the model's context or the telemetry
//! stream, and enforces a per-command timeout so a hung command can never wedge the
//! run. The tool is contributed only when the
//! [`shell`](test_cabinet_core::gg::CAPABILITY_SHELL) capability is enabled.

use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::{
    ArgumentError, ShellData, Tool, ToolContext, ToolData, ToolFailure, ToolOutcome, required_str,
};
use crate::model::ToolDefinition;

/// The tool's name, matched during dispatch and offered to the model.
const TOOL_NAME: &str = "shell";
/// Default per-command timeout (seconds) when a call does not specify one.
const DEFAULT_TIMEOUT_SECS: f64 = 120.0;
/// Ceiling on the captured output handed back to the model, in bytes. Output beyond
/// this is dropped with a truncation note so a noisy command cannot flood context.
const MAX_OUTPUT_BYTES: usize = 16 * 1024;
/// After a timeout kill, how long to wait for the reader tasks to drain whatever was
/// already captured before giving up (a forked grandchild may hold the pipe open).
const OUTPUT_GRACE: Duration = Duration::from_millis(250);

/// Runs a shell command in the workspace via `sh -c`.
#[derive(Default)]
pub struct ShellTool;

impl ShellTool {
    /// Construct the shell tool.
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        TOOL_NAME
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            TOOL_NAME,
            "Run a shell command with `sh -c` in the workspace directory. Returns the \
             merged stdout+stderr (truncated if very long) and the exit code. Use it to \
             build, run, and inspect the project.",
            json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command line to run via `sh -c`."
                    },
                    "timeout_secs": {
                        "type": "number",
                        "description": "Optional per-command timeout in seconds \
                            (default 120). The command is killed if it exceeds this."
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let command = match required_str(&args, "command", TOOL_NAME) {
            Ok(command) => command,
            Err(error) => return error.into(),
        };

        let timeout = match parse_timeout(&args) {
            Ok(timeout) => timeout,
            Err(error) => return error.into(),
        };

        run_command(&command, timeout, ctx).await
    }
}

/// Parse the optional `timeout_secs` argument into a [`Duration`], defaulting to
/// [`DEFAULT_TIMEOUT_SECS`]. A present-but-non-positive or non-numeric value is an
/// [invalid-argument](ToolFailure::InvalidArgument) error the model can correct.
fn parse_timeout(args: &Value) -> Result<Duration, ArgumentError> {
    match args.get("timeout_secs") {
        None | Some(Value::Null) => Ok(Duration::from_secs_f64(DEFAULT_TIMEOUT_SECS)),
        Some(value) => {
            let secs = value.as_f64().ok_or_else(|| {
                ArgumentError(format!(
                    "`{TOOL_NAME}`: argument `timeout_secs` must be a number"
                ))
            })?;
            if !secs.is_finite() || secs <= 0.0 {
                return Err(ArgumentError(format!(
                    "`{TOOL_NAME}`: argument `timeout_secs` must be a positive number"
                )));
            }
            Ok(Duration::from_secs_f64(secs))
        }
    }
}

/// Spawn `command` under `sh -c` in the workspace, enforce `timeout`, and turn the
/// result into a [`ToolOutcome`]. `ok` is true only for a clean exit (status `0`).
async fn run_command(command: &str, timeout: Duration, ctx: &ToolContext) -> ToolOutcome {
    let mut command_builder = Command::new("sh");
    command_builder
        .arg("-c")
        .arg(command)
        .current_dir(&ctx.workspace_dir)
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
            // Nothing ran, so there is no exit code to report and no `ShellData` to attach: this
            // is the one shell failure that is a failure *of the call* rather than a result of it.
            return ToolOutcome::failed(
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
    let merged = merge_output(&stdout, &stderr);
    let (body, truncated) = truncate(&merged, MAX_OUTPUT_BYTES);

    if timed_out {
        let mut output = format!(
            "command timed out after {:.3}s and was killed.",
            timeout.as_secs_f64()
        );
        if !body.is_empty() {
            output.push_str("\n\n");
            output.push_str(&body);
        }
        // A gg-side ceiling killed a command that was otherwise running fine, which is a different
        // thing from the command failing — so it is classified as the limit it is, and carries no
        // `ShellData`: there is no exit code, and whatever the process had printed is already in
        // the message.
        return ToolOutcome::failed(ToolFailure::LimitExceeded, output);
    }

    let status = match waited {
        Ok(Ok(status)) => status,
        // `child.wait()` itself failed (rare): report it rather than pretend success.
        Ok(Err(err)) => {
            return ToolOutcome::failed(
                ToolFailure::from_io(&err),
                format!("waiting on shell command: {err}"),
            );
        }
        Err(_) => unreachable!("the timeout branch is handled above"),
    };

    let code = status.code();
    let ok = status.success();
    let mut output = match code {
        Some(code) => format!("exit code: {code}\n"),
        None => "exit code: (terminated by signal)\n".to_string(),
    };
    if body.is_empty() {
        output.push_str("(no output)");
    } else {
        output.push_str(&body);
    }
    if truncated {
        output.push_str(&format!(
            "\n\n[output truncated to {MAX_OUTPUT_BYTES} bytes]"
        ));
    }

    let summary = match code {
        Some(0) => "exited 0".to_string(),
        Some(code) => format!("exited {code}"),
        None => "terminated by signal".to_string(),
    };
    ToolOutcome {
        ok,
        output,
        summary: Some(summary),
        images: Vec::new(),
        // The process ran, so its facts are reported whatever it exited with. A non-zero exit
        // leaves `ok` false (the model is told plainly that the command failed) but `failure`
        // empty: nothing about the *call* went wrong, and a caller that wants to branch on the
        // code reads it from here rather than from the first line of `output`.
        data: Some(ToolData::Shell(ShellData {
            exit_code: code,
            body,
            truncated,
        })),
        failure: None,
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

/// Merge stdout and stderr into one block: stdout first, then stderr, each labeled
/// only when the other is also present so single-stream output stays clean.
fn merge_output(stdout: &str, stderr: &str) -> String {
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

/// Truncate `text` to at most `cap` bytes on a char boundary, reporting whether it was
/// cut. Keeps the *tail* of the output, since a command's final lines (errors, the
/// prompt that follows) are usually the most useful.
fn truncate(text: &str, cap: usize) -> (String, bool) {
    if text.len() <= cap {
        return (text.to_string(), false);
    }
    let mut start = text.len() - cap;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    (text[start..].to_string(), true)
}

#[cfg(test)]
#[path = "shell.test.rs"]
mod tests;
