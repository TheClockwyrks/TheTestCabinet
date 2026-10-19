//! Attributing a harness session's end: the harness's own, or the platform's.
//!
//! A run's end is the model's only when the harness itself ended the session. The
//! exit status an exec reports is the platform's word for how the session ended,
//! and the platform can report a session it ended itself, a sandbox pod deleted or
//! evicted, a lost exec stream, as the harness's own exit. [`platform_end`] reads
//! what the driver holds once a session's exec has returned, in the order
//! [Attributing an
//! end](https://docs.testcabinet.ai/components/driver/execution/#attributing-an-end)
//! sets: the sandbox pod, then the session's own account of its end, and only then
//! the exit status. Each condition it finds is an end the platform caused, which
//! [`classify_failure`](crate::run_record::RunStateExt::classify_failure) records as
//! [`Infrastructure`](crate::run_record::RunState::Infrastructure).
//!
//! It is applied after the runtime limits and the cancellation: a session the idle
//! watchdog killed is `hung`, one stopped at the maximum runtime is `timed_out`, and
//! one the operator canceled is `canceled`, before any of this is read. When it finds
//! nothing, the end is the harness's own, and the caller classifies the exit status
//! as it always has (gg's `3` a breached ceiling, any other non-zero a harness error).
//!
//! A pure function, so the attribution is pinned without a container behind it; the
//! caller reads the sandbox ([`ContainerRuntime::sandbox_state`]) and the session's
//! account.
//!
//! [`ContainerRuntime::sandbox_state`]: crate::execution::ContainerRuntime::sandbox_state

use crate::Error;
use crate::execution::SandboxState;

/// The session's own account of its end, read from what the harness or its
/// in-container wrapper left behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionAccount {
    /// A [gg](crate::gg) session: whether it emitted its `session_ended` event. gg
    /// emits that event before every exit, so an exit `0` without one was reported
    /// by the platform rather than by gg.
    Gg {
        /// Whether the session's stream carried a `session_ended` event.
        session_ended: bool,
    },
    /// The container session log the in-container `tcab-session` wrapper writes.
    /// The wrapper appends a session's closing marker after the harness exits,
    /// whatever its status, so a session without one was still running when the
    /// exec returned.
    SessionLog {
        /// How many sessions the log holds without their closing marker.
        unfinished: usize,
        /// How many sessions the log holds in all.
        total: usize,
    },
    /// No account could be read (the session log was unreadable, and the usage came
    /// from the stream instead). The end is attributed by the sandbox and the exit
    /// status alone.
    Unread,
}

/// Everything the driver holds about a session's end once its exec has returned.
#[derive(Debug, Clone, Copy)]
pub struct SessionEnd<'a> {
    /// The harness slug whose session ended.
    pub slug: &'a str,
    /// The sandbox's runtime identifier: the pod or container name.
    pub sandbox: &'a str,
    /// The sandbox's state, read after the exec returned.
    pub sandbox_state: &'a SandboxState,
    /// The session's own account of its end.
    pub account: SessionAccount,
    /// The exit status the exec reported: `-1` when it returned none.
    pub exit_code: i32,
}

/// The exit status an exec reports when it returned no status: a lost exec stream.
pub const EXIT_NO_STATUS: i32 = -1;

/// The highest exit code a process can return on its own. A code above it is
/// `128 + n` for the signal `n` that killed the process.
const EXIT_SIGNAL_BASE: i32 = 128;

/// The platform's end of the session `end` describes, or `None` when the harness
/// ended it itself.
///
/// The conditions are read in the documented order, and the first that holds is
/// the one reported:
///
/// 1. The sandbox is gone, or carries a `DisruptionTarget` condition, whatever the
///    exit status.
/// 2. The session's own account: the session log holds a session without its
///    closing marker ([`HarnessSessionLost`](Error::HarnessSessionLost); the log is
///    believed over the exit status), or a gg session exited `0` without its
///    `session_ended` event.
/// 3. The exit status: a code above 128 (the harness ended on a signal, which comes
///    from outside it, since the sandbox's PID 1 is `sleep infinity` and the
///    harness runs through an exec), or `-1` (the exec returned no status).
///
/// Every condition but the lost session is reported as
/// [`HarnessEndedByPlatform`](Error::HarnessEndedByPlatform), whose detail names
/// it with its figures: the sandbox and its reason, the sessions left unfinished,
/// and the exit code.
pub fn platform_end(end: &SessionEnd<'_>) -> Option<Error> {
    let code = end.exit_code;
    let unclosed = match end.account {
        SessionAccount::SessionLog { unfinished, total } if unfinished > 0 => {
            Some((unfinished, total))
        }
        _ => None,
    };
    let sessions = unclosed
        .map(|(unfinished, total)| format!(", {unfinished} of {total} logged sessions unclosed"))
        .unwrap_or_default();

    let sandbox = match end.sandbox_state {
        SandboxState::Gone { reason } => Some(format!("sandbox `{}` gone: {reason}", end.sandbox)),
        SandboxState::Disrupted { reason } => {
            Some(format!("sandbox `{}` disrupted: {reason}", end.sandbox))
        }
        SandboxState::Running | SandboxState::Unknown => None,
    };
    if let Some(sandbox) = sandbox {
        return Some(ended_by_platform(
            end.slug,
            format!("{sandbox}{sessions}, exit code {code}"),
        ));
    }

    if let Some((unfinished, total)) = unclosed {
        return Some(Error::HarnessSessionLost {
            slug: end.slug.to_string(),
            unfinished,
            total,
            exit_code: code,
        });
    }
    if code == 0
        && end.account
            == (SessionAccount::Gg {
                session_ended: false,
            })
    {
        return Some(ended_by_platform(
            end.slug,
            "exit code 0 with no `session_ended` event".to_string(),
        ));
    }

    if code > EXIT_SIGNAL_BASE {
        let signal = code - EXIT_SIGNAL_BASE;
        return Some(ended_by_platform(
            end.slug,
            format!("signal {signal}, exit code {code}"),
        ));
    }
    if code == EXIT_NO_STATUS {
        return Some(ended_by_platform(
            end.slug,
            format!("exec stream lost, exit code {code}"),
        ));
    }
    None
}

fn ended_by_platform(slug: &str, detail: String) -> Error {
    Error::HarnessEndedByPlatform {
        slug: slug.to_string(),
        detail,
    }
}

#[cfg(test)]
#[path = "session_end.test.rs"]
mod tests;
