//! The one retry policy every call of a run's finishing is made under.
//!
//! Once the session ends, the driver hands the run to durable storage: the held
//! `storing` report, the uploads of the run tree and the bundle, and the terminal
//! report (see the driver overview's "Finishing a run"). Every one of those calls is
//! retried the same way, which is what this module holds:
//!
//! - The waits between attempts are `5`, `10`, `20` and `40` seconds, then `60`
//!   seconds for every attempt after ([`RetryPolicy::delay_after`]).
//! - A call is retried until its deadline has passed, counted from the call's
//!   **first failure**, not from its first attempt: a slow first attempt costs the
//!   call none of its wait. `Duration::ZERO` makes a single attempt.
//!   [`DEFAULT_UPLOAD_WAIT`] bounds each upload (`TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS`)
//!   and [`DEFAULT_REPORT_WAIT`] the held and terminal reports
//!   (`TCAB_DRIVER_REPORT_WAIT_SECONDS`).
//! - A call ends at once when its answer says the request itself is at fault
//!   ([`FinalFailure::is_final`]): a `4xx` other than `408` and `429` from the
//!   backend ([`ClientError::is_refused`](crate::client::ClientError::is_refused)),
//!   or one of the run's own upload failures. Every other failure is retried.
//! - An operator's cancellation ends the waiting wherever it is: the driver polls
//!   its job's state every [three seconds](CANCEL_POLL_INTERVAL) throughout
//!   ([`job_canceled`]), and a `canceled` job ends the call in flight. A gg run that
//!   was already canceled when its finishing began is not cut short by the
//!   cancellation it follows; each of its uploads waits at most
//!   [`CANCELED_RUN_UPLOAD_WAIT`] instead ([`RetryPolicy::for_canceled_run`]).
//!
//! [`retry_call`] is the loop itself, generic over the call so the reports and the
//! uploads share it.

use std::future::Future;
use std::time::Duration;

use tokio::time::Instant;

use crate::client::JobClient;
use crate::job_api::JobState;

/// The default wait of each upload: six hours, the documented default of
/// `TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS`.
pub const DEFAULT_UPLOAD_WAIT: Duration = Duration::from_secs(6 * 60 * 60);

/// The default wait of the held report and the terminal report: six hours, the
/// documented default of `TCAB_DRIVER_REPORT_WAIT_SECONDS`.
pub const DEFAULT_REPORT_WAIT: Duration = Duration::from_secs(6 * 60 * 60);

/// The most a gg run that was already canceled when its finishing began waits on
/// each upload, when the configured wait is longer.
pub const CANCELED_RUN_UPLOAD_WAIT: Duration = Duration::from_secs(10 * 60);

/// How long an upload attempt may go with the service taking none of its body and
/// giving no answer before it is abandoned as stalled.
pub const DEFAULT_STALL_LIMIT: Duration = Duration::from_secs(5 * 60);

/// How often a finishing driver polls its job's state for a cancellation.
pub const CANCEL_POLL_INTERVAL: Duration = Duration::from_secs(3);

/// The waits between attempts: `5`, `10`, `20` and `40` seconds, then `60` seconds
/// for every attempt after.
const DEFAULT_DELAYS: [Duration; 5] = [
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(20),
    Duration::from_secs(40),
    Duration::from_secs(60),
];

/// How a finishing call is retried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPolicy {
    /// How long, counted from the first failure, the call keeps being retried.
    /// `Duration::ZERO` makes a single attempt.
    pub give_up_after: Duration,
    /// The waits between attempts; the last one repeats for every later attempt.
    pub delays: Vec<Duration>,
    /// How long an upload attempt may make no progress before it is abandoned as
    /// stalled. Unused by the reports, whose bodies are small.
    pub stall_limit: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self::waiting_for(DEFAULT_UPLOAD_WAIT)
    }
}

impl RetryPolicy {
    /// The driver's policy, retrying for `give_up_after` from the first failure.
    pub fn waiting_for(give_up_after: Duration) -> Self {
        Self {
            give_up_after,
            delays: DEFAULT_DELAYS.to_vec(),
            stall_limit: DEFAULT_STALL_LIMIT,
        }
    }

    /// The policy for an upload of a run that was already canceled when its
    /// finishing began: the same, waiting at most [`CANCELED_RUN_UPLOAD_WAIT`].
    pub fn for_canceled_run(mut self) -> Self {
        self.give_up_after = self.give_up_after.min(CANCELED_RUN_UPLOAD_WAIT);
        self
    }

    /// The wait after the `failures`-th failed attempt (counted from one).
    pub fn delay_after(&self, failures: u32) -> Duration {
        let index = (failures.max(1) - 1) as usize;
        self.delays
            .get(index)
            .or_else(|| self.delays.last())
            .copied()
            .unwrap_or_default()
    }
}

/// A failed attempt's verdict on whether another attempt could change it.
pub trait FinalFailure {
    /// Whether the answer says the request itself is at fault, which no retry can
    /// change: the call ends at once. Every other failure is retried.
    fn is_final(&self) -> bool;
}

impl FinalFailure for crate::client::ClientError {
    fn is_final(&self) -> bool {
        self.is_refused()
    }
}

/// How a call that did not land ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryEnd {
    /// An attempt's answer said the request itself is at fault
    /// ([`FinalFailure::is_final`]).
    Refused,
    /// The policy's wait passed, counted from the first failure, without the call
    /// landing.
    GaveUp,
    /// The run's job was canceled while the call was being made or waited on.
    Canceled,
}

/// A call that ended without landing.
#[derive(Debug)]
pub struct RetryFailure<E> {
    /// How the call ended.
    pub end: RetryEnd,
    /// The last attempt's failure. `None` only for a call canceled before any
    /// attempt had failed.
    pub error: Option<E>,
}

impl<E: std::fmt::Display> std::fmt::Display for RetryFailure<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (&self.error, self.end) {
            (Some(error), RetryEnd::Canceled) => {
                write!(f, "the run was canceled while retrying: {error}")
            }
            (Some(error), _) => error.fmt(f),
            (None, _) => f.write_str("the run was canceled before the call landed"),
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for RetryFailure<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.error
            .as_ref()
            .map(|error| error as &(dyn std::error::Error + 'static))
    }
}

/// Make `attempt` until it lands, under `policy`.
///
/// A failure that is [final](FinalFailure::is_final) ends the call at once, on any
/// attempt. Any other failure is retried after the policy's
/// [delay](RetryPolicy::delay_after) until the policy's wait has passed since the
/// call's first failure; the last sleep is cut to what is left of the wait, so the
/// final attempt is made as the deadline passes rather than a delay after it.
///
/// `canceled` resolving ends the call wherever it is, mid-attempt included. Pass
/// [`job_canceled`] for a call an operator's cancellation must end, and
/// [`std::future::pending`] for one nothing cancels (a gg run that was already
/// canceled when its finishing began).
///
/// `what` names the call in the log.
pub async fn retry_call<T, E, A, F, C>(
    policy: &RetryPolicy,
    what: &str,
    canceled: C,
    mut attempt: A,
) -> Result<T, RetryFailure<E>>
where
    E: FinalFailure + std::fmt::Display,
    A: FnMut() -> F,
    F: Future<Output = Result<T, E>>,
    C: Future<Output = ()>,
{
    tokio::pin!(canceled);
    let mut failures: u32 = 0;
    let mut first_failure: Option<Instant> = None;
    let mut last: Option<E> = None;
    loop {
        let result = tokio::select! {
            result = attempt() => result,
            () = &mut canceled => {
                return Err(RetryFailure { end: RetryEnd::Canceled, error: last });
            }
        };
        let error = match result {
            Ok(value) => {
                if failures > 0 {
                    tracing::info!(call = what, failures, "the call landed after a wait");
                }
                return Ok(value);
            }
            Err(error) => error,
        };
        if error.is_final() {
            return Err(RetryFailure {
                end: RetryEnd::Refused,
                error: Some(error),
            });
        }
        failures += 1;
        let first = *first_failure.get_or_insert_with(Instant::now);
        let waited = first.elapsed();
        if waited >= policy.give_up_after {
            return Err(RetryFailure {
                end: RetryEnd::GaveUp,
                error: Some(error),
            });
        }
        let delay = policy
            .delay_after(failures)
            .min(policy.give_up_after - waited);
        tracing::warn!(
            call = what,
            failures,
            waited_secs = waited.as_secs(),
            give_up_after_secs = policy.give_up_after.as_secs(),
            retry_in_secs = delay.as_secs_f64(),
            error = %error,
            "the call failed; retrying",
        );
        last = Some(error);
        tokio::select! {
            () = tokio::time::sleep(delay) => {}
            () = &mut canceled => {
                return Err(RetryFailure { end: RetryEnd::Canceled, error: last });
            }
        }
    }
}

/// Resolve once `client`'s job reads `canceled`, polling every
/// [`CANCEL_POLL_INTERVAL`]. Anything but a `canceled` answer, an unreachable
/// backend included, is no reason to stop, so the poll simply goes on.
pub async fn job_canceled(client: &JobClient) {
    loop {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
        if is_canceled(client).await {
            return;
        }
    }
}

/// Whether `client`'s job reads `canceled` now. An unreachable backend reads as
/// not canceled.
pub async fn is_canceled(client: &JobClient) -> bool {
    matches!(client.poll_state().await, Ok(Some(JobState::Canceled)))
}

#[cfg(test)]
#[path = "retry.test.rs"]
mod tests;
