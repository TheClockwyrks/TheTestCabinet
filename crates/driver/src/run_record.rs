//! The run record: the central data contract produced by every run.
//!
//! See `docs/run-records.md`. The type tree is the contract, and it lives in
//! `test_cabinet_contracts::run_record`, re-exported here at its old paths. What
//! stays here is the two constructors that need this crate: the build's own
//! provenance ([`RunToolingExt::current`]) and the failure classification over
//! this crate's [`Error`](crate::Error) ([`RunStateExt::classify_failure`]). Each
//! is a trait so the call reads `RunTooling::current()` and
//! `RunState::classify_failure(&err)` as it always did, wherever the module (or
//! the crate root) is imported.

pub use test_cabinet_contracts::run_record::*;

/// The tooling provenance of the running build.
pub trait RunToolingExt {
    /// The tooling provenance for the current build, stamped at compile time by
    /// `build.rs` into the `TEST_CABINET_COMMIT` environment variable.
    fn current() -> Self;
}

impl RunToolingExt for RunTooling {
    fn current() -> Self {
        Self {
            test_cabinet_commit: crate::COMMIT.map(str::to_string),
        }
    }
}

/// The terminal state a run's error leaves it in.
pub trait RunStateExt {
    /// Classify a run that failed *before* producing an implementation. A harness
    /// session stopped at the run's maximum runtime is a model outcome (the model
    /// never converged) → [`TimedOut`](RunState::TimedOut); the harness (or its
    /// orchestrator runner) exiting non-zero is a
    /// [`HarnessError`](RunState::HarnessError) — the model drove it to exit early;
    /// a harness that stopped itself on one of its own configured execution
    /// ceilings is [`LimitExceeded`](RunState::LimitExceeded), which is held apart
    /// from a harness error because it must not be retried;
    /// a harness that went silent and was killed by the idle watchdog is
    /// [`Hung`](RunState::Hung); every other error — the harness-install or
    /// case-init timeouts and container/cluster faults — is the Test Cabinet's
    /// [`Infrastructure`](RunState::Infrastructure).
    ///
    /// [`Canceled`](RunState::Canceled) is reached by one error only, a run the
    /// engine refused to launch a session for because its operator had already
    /// killed it ([`CanceledBeforeSession`](crate::Error::CanceledBeforeSession)).
    /// Every other operator kill is observed out-of-band by the driver, which sets
    /// the state itself, and never surfaces as an error the run returns.
    fn classify_failure(err: &crate::Error) -> Self;
}

impl RunStateExt for RunState {
    fn classify_failure(err: &crate::Error) -> RunState {
        match err {
            crate::Error::RunTimedOut { .. } => RunState::TimedOut,
            crate::Error::HarnessInvocation { .. } => RunState::HarnessError,
            crate::Error::HarnessLimitExceeded { .. } => RunState::LimitExceeded,
            crate::Error::HarnessHung { .. } => RunState::Hung,
            crate::Error::CanceledBeforeSession => RunState::Canceled,
            _ => RunState::Infrastructure,
        }
    }
}

#[cfg(test)]
#[path = "run_record.test.rs"]
mod tests;
