//! Draining a streamed command's output with an idle watchdog.
//!
//! Both container runtimes — the CLI runtime driving `docker`/`podman` and the
//! driver's Kubernetes runtime driving a pod exec — read a harness's stdout and
//! stderr concurrently and forward each line to an [`OutputSink`] as it arrives.
//! They share this module so the draining, and in particular the idle watchdog
//! that bounds it, behaves identically wherever a run executes.
//!
//! ## Why an idle watchdog exists
//!
//! A harness that hangs — a stalled provider request with no client-side timeout,
//! a subagent that never returns — stops producing output but never exits. Left
//! alone the run occupies its slot until something external reaps it, which is
//! both expensive and misreported: the reaper, not the hang, decides how the run
//! ends.
//!
//! Kubernetes makes this concrete. The kubelet closes a streaming connection that
//! has been idle for `streamingConnectionIdleTimeout` (4h by default, and 4h on
//! both of our clusters). When it does, the exec stream ends *without* a
//! terminating status frame, so the exec reports exit code `-1` and the run is
//! recorded as a harness error four hours after it actually stopped doing
//! anything. Worse, a test case whose `max_runtime_hours` exceeds 4 could never
//! reach its own cap: the kubelet always won first.
//!
//! [`HARNESS_IDLE_TIMEOUT`] is therefore deliberately far below that ceiling. We
//! notice the silence ourselves, kill the harness, and attribute the run as
//! [`RunState::Hung`](crate::run_record::RunState::Hung) — so a run only ever
//! ends on a Test Cabinet mechanism, never on an external limit.

use std::time::Duration;

use tokio::io::{AsyncBufRead, Lines};
use tokio::time::Instant;

use crate::error::{Error, Result};
use crate::execution::{OutputSink, OutputStream};

/// How long a harness may produce no output at all before it is treated as hung.
///
/// This must stay comfortably below the kubelet's `streamingConnectionIdleTimeout`
/// (4h on our clusters), because whichever timer fires first decides how the run
/// is classified — and only this one produces an accurate answer. See the module
/// documentation for the failure it exists to prevent.
pub const HARNESS_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// The captured output of a drained command.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DrainedOutput {
    /// Everything read from standard output, newline-terminated per line.
    pub stdout: String,
    /// Everything read from standard error, newline-terminated per line.
    pub stderr: String,
    /// Whether draining stopped because the idle watchdog fired rather than
    /// because both streams closed. When set, the command was still running and
    /// the caller is responsible for killing it.
    pub idle_timed_out: bool,
}

/// Drain `stdout` and `stderr` concurrently, forwarding every line to `sink` as
/// it arrives, until both streams close or `idle_timeout` elapses with no line
/// from either.
///
/// Passing `None` for `idle_timeout` drains until the streams close, with no
/// watchdog.
///
/// Returning `idle_timed_out` rather than an error keeps this layer free of
/// policy: a container runtime reports *what happened*, and the harness layer —
/// which knows the slug and the run's limits — decides what it means.
pub async fn drain_with_idle_timeout<O, E>(
    stdout: &mut Lines<O>,
    stderr: &mut Lines<E>,
    idle_timeout: Option<Duration>,
    sink: &mut dyn OutputSink,
) -> Result<DrainedOutput>
where
    O: AsyncBufRead + Unpin + Send,
    E: AsyncBufRead + Unpin + Send,
{
    let mut drained = DrainedOutput::default();
    let mut stdout_open = true;
    let mut stderr_open = true;
    // The watchdog measures the gap between lines, so the deadline is pushed out
    // every time either stream produces one.
    let mut deadline = idle_timeout.map(|idle| Instant::now() + idle);

    // Drain both streams concurrently so neither blocks the other by filling its
    // pipe buffer. Only one select branch runs at a time, so the sink is never
    // borrowed twice.
    while stdout_open || stderr_open {
        // A `None` timeout parks forever, leaving the two read branches to race
        // exactly as they did before the watchdog existed.
        let idle = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(at).await,
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            line = stdout.next_line(), if stdout_open => match read_line(line)? {
                Some(line) => {
                    sink.on_line(OutputStream::Stdout, &line);
                    drained.stdout.push_str(&line);
                    drained.stdout.push('\n');
                    deadline = idle_timeout.map(|idle| Instant::now() + idle);
                }
                None => stdout_open = false,
            },
            line = stderr.next_line(), if stderr_open => match read_line(line)? {
                Some(line) => {
                    sink.on_line(OutputStream::Stderr, &line);
                    drained.stderr.push_str(&line);
                    drained.stderr.push('\n');
                    deadline = idle_timeout.map(|idle| Instant::now() + idle);
                }
                None => stderr_open = false,
            },
            // Cancelling the read branches here can discard a partially-read
            // line, which is immaterial: the command is about to be killed and
            // its output abandoned.
            () = idle => {
                drained.idle_timed_out = true;
                break;
            }
        }
    }

    Ok(drained)
}

/// Map a line read from a streamed command into our [`Result`], turning an I/O
/// error into a container runtime error.
fn read_line(line: std::io::Result<Option<String>>) -> Result<Option<String>> {
    line.map_err(|err| Error::ContainerRuntime(format!("reading command output failed: {err}")))
}

#[cfg(test)]
#[path = "exec_stream.test.rs"]
mod tests;
