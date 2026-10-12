//! When a snapshot refresh is released: the batching described under "Refresh
//! batching" in the backend overview.
//!
//! Every refresh ends in a full gallery build, so requests for one are counted and
//! released together. A batch is released when the pending count reaches the
//! threshold or when no request has arrived for the quiet window, whichever comes
//! first, and two releases are held a minimum interval apart.
//!
//! The wait of any one request is bounded without a maximum-wait setting. Requests
//! that keep arriving reach the threshold; requests that stop arriving let the quiet
//! window run out; and the hold between releases is itself a fixed interval.
//!
//! The scheduling here knows nothing about what a refresh does. It drives a
//! [`RefreshTarget`], which is what lets the timing be tested on a paused clock
//! with no database behind it.

use std::future::Future;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::{Notify, mpsc};
use tokio::time::Instant;

use crate::error::{BackendError, Result};

/// The shortest wait before a failed release is tried again, whatever the minimum
/// interval is set to. A failure is usually the bucket or the database being
/// unreachable, and retrying at once would spin against it.
const FAILED_RELEASE_RETRY: Duration = Duration::from_secs(60);

/// The longest wait between two tries of a release that keeps failing. The wait
/// doubles with each consecutive failure up to this, because every try uploads a
/// whole snapshot generation: a deploy hook that stays down for a day would
/// otherwise cost a generation every minimum interval.
const FAILED_RELEASE_RETRY_MAX: Duration = Duration::from_secs(6 * 3600);

/// The settings a batch is released by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchTiming {
    /// The pending request count that releases a batch at once
    /// (`TCAB_SNAPSHOT_BATCH_SIZE`). Values below one behave as one.
    pub threshold: u64,
    /// How long after the last request a batch below the threshold is released
    /// (`TCAB_SNAPSHOT_COALESCE_MS`).
    pub quiet_window: Duration,
    /// The minimum time between the end of one release and the start of the next
    /// (`TCAB_SNAPSHOT_MIN_INTERVAL_MS`). [`Duration::ZERO`] removes the hold.
    pub min_interval: Duration,
    /// How long one refresh may run before it is abandoned as failed
    /// (`TCAB_SNAPSHOT_REFRESH_TIMEOUT_MS`). [`Duration::ZERO`] removes the bound.
    ///
    /// Refreshes are serialized, so one that never returned would stop every later
    /// one, a forced refresh included. The bound turns a stalled bucket call into a
    /// failed release, which is retried.
    pub refresh_timeout: Duration,
}

/// Why a batch was released. The value of the `reason` field on the release log
/// line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseReason {
    /// The pending count reached the threshold.
    Threshold,
    /// No request arrived for the quiet window.
    Quiet,
    /// Requests were pending when the process last stopped.
    Recovery,
    /// An operator forced the refresh, outside the batching.
    Forced,
}

impl ReleaseReason {
    /// The reason as the release log line spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Threshold => "threshold",
            Self::Quiet => "quiet",
            Self::Recovery => "recovery",
            Self::Forced => "forced",
        }
    }
}

/// One released batch, as handed to the [`RefreshTarget`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Batch {
    /// Why the batch was released.
    pub reason: ReleaseReason,
    /// How many requests the batch carried.
    pub requests: u64,
}

/// What a [`Batcher`] releases batches into.
pub trait RefreshTarget: Send + Sync {
    /// What a successful refresh reports.
    type Output: Send;

    /// Publish the current state. Called once per released batch, and never by two
    /// callers at once.
    fn refresh(&self, batch: Batch) -> impl Future<Output = Result<Self::Output>> + Send;

    /// Record durably that requests are pending, so a process that stops before
    /// their batch is released refreshes when it next starts. Called once per
    /// batch, and again when a refresh finished with requests still pending.
    fn persist_pending(&self) -> impl Future<Output = ()> + Send;
}

/// The mutable half of a [`Batcher`].
#[derive(Debug, Default)]
struct State {
    /// Requests not yet carried by a release.
    pending: u64,
    /// When the newest pending request arrived. The quiet window is measured from
    /// it.
    last_request: Option<Instant>,
    /// Whether the pending requests are the ones a previous process left behind,
    /// which are released at once.
    recovering: bool,
    /// The earliest instant the next batch may be released: the end of the last
    /// release plus the minimum interval, or plus the retry delay when it failed.
    not_before: Option<Instant>,
    /// How many releases in a row have failed. It scales the wait before the next
    /// try, and a release that succeeds clears it.
    consecutive_failures: u32,
    /// Whether the pending requests have been recorded through
    /// [`RefreshTarget::persist_pending`].
    persisted: bool,
}

/// Counts refresh requests and decides when a batch of them is released.
pub struct Batcher {
    timing: BatchTiming,
    state: Mutex<State>,
    /// Wakes the loop whenever the state changed, so it recomputes its deadline.
    wake: Notify,
    /// Held for the length of a refresh, so the loop and a forced refresh never
    /// publish at the same time.
    refreshing: tokio::sync::Mutex<()>,
}

impl Batcher {
    /// A batcher with nothing pending.
    pub fn new(timing: BatchTiming) -> Self {
        Self {
            timing: BatchTiming {
                threshold: timing.threshold.max(1),
                ..timing
            },
            state: Mutex::new(State::default()),
            wake: Notify::new(),
            refreshing: tokio::sync::Mutex::new(()),
        }
    }

    /// The timing this batcher releases by.
    pub fn timing(&self) -> &BatchTiming {
        &self.timing
    }

    /// How many requests no release has carried yet.
    #[cfg(test)]
    pub(crate) fn pending(&self) -> u64 {
        self.state().pending
    }

    /// Count one refresh request. Returns at once; the loop releases it.
    pub fn request(&self) {
        {
            let mut state = self.state();
            state.pending = state.pending.saturating_add(1);
            state.last_request = Some(Instant::now());
        }
        self.wake.notify_one();
    }

    /// Refresh now, outside the batching: wait for a refresh already running, carry
    /// every pending request, and start the minimum interval. The wait is bounded
    /// by the refresh timeout, which ends a refresh that has stalled.
    pub async fn forced<T: RefreshTarget>(&self, target: &T) -> Result<T::Output> {
        let _refreshing = self.refreshing.lock().await;
        self.release(target, ReleaseReason::Forced).await
    }

    /// Release batches into `target` until `shutdown` is signaled or closed.
    ///
    /// `recover` is `Some` when requests were pending when the process last
    /// stopped. They are released without waiting for the threshold or the quiet
    /// window, once the duration it carries has passed: the part of the minimum
    /// interval the last release before the stop left unspent, so that a process
    /// restarting in a loop releases no more often than one that stays up. A
    /// shutdown leaves pending requests unreleased, which is what `recover` exists
    /// to pick up on the next start.
    pub async fn run<T: RefreshTarget>(
        &self,
        target: &T,
        recover: Option<Duration>,
        mut shutdown: mpsc::Receiver<()>,
    ) {
        if let Some(hold) = recover {
            let mut state = self.state();
            state.pending = state.pending.saturating_add(1);
            state.last_request = Some(Instant::now());
            state.recovering = true;
            state.not_before = Some(Instant::now() + hold);
            // The durable record is what `recover` was read from.
            state.persisted = true;
        }
        loop {
            if self.claim_persist() {
                target.persist_pending().await;
            }
            let due = self.due();
            tokio::select! {
                biased;
                _ = shutdown.recv() => break,
                _ = self.wake.notified() => continue,
                _ = sleep_until_due(due) => {}
            }
            let _refreshing = self.refreshing.lock().await;
            // A forced refresh may have run while this waited for the lock, carrying
            // the batch and moving the earliest release, so decide again.
            let Some((at, reason)) = self.due() else {
                continue;
            };
            if at > Instant::now() {
                continue;
            }
            if let Err(err) = self.release(target, reason).await {
                tracing::error!(
                    reason = reason.as_str(),
                    "snapshot refresh failed; its requests stay pending: {err}"
                );
            }
        }
    }

    /// When the next batch is due and why, or `None` with nothing pending.
    fn due(&self) -> Option<(Instant, ReleaseReason)> {
        let state = self.state();
        if state.pending == 0 {
            return None;
        }
        let now = Instant::now();
        let (ready, reason) = if state.recovering {
            (now, ReleaseReason::Recovery)
        } else if state.pending >= self.timing.threshold {
            (now, ReleaseReason::Threshold)
        } else {
            let last = state.last_request.unwrap_or(now);
            (last + self.timing.quiet_window, ReleaseReason::Quiet)
        };
        let at = state.not_before.map_or(ready, |held| ready.max(held));
        Some((at, reason))
    }

    /// Whether the pending requests still need recording durably; claims the
    /// recording when they do.
    fn claim_persist(&self) -> bool {
        let mut state = self.state();
        if state.pending == 0 || state.persisted {
            return false;
        }
        state.persisted = true;
        true
    }

    /// Run one refresh carrying every pending request. The caller holds
    /// `refreshing`.
    async fn release<T: RefreshTarget>(
        &self,
        target: &T,
        reason: ReleaseReason,
    ) -> Result<T::Output> {
        let mut carried = Carried::take(self);
        let batch = Batch {
            reason,
            requests: carried.requests,
        };
        tracing::info!(
            reason = reason.as_str(),
            requests = batch.requests,
            "releasing a snapshot refresh batch"
        );
        let result = self.bounded(target.refresh(batch)).await;
        let mut state = self.state();
        let hold = match &result {
            Ok(_) => {
                carried.published = true;
                state.consecutive_failures = 0;
                self.timing.min_interval
            }
            Err(_) => {
                state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                self.failed_release_hold(state.consecutive_failures)
            }
        };
        state.not_before = Some(Instant::now() + hold);
        drop(state);
        result
    }

    /// Run one refresh under the refresh timeout. A refresh that outlasts it is
    /// dropped where it stands and reported as failed.
    async fn bounded<O>(&self, refresh: impl Future<Output = Result<O>>) -> Result<O> {
        let limit = self.timing.refresh_timeout;
        if limit.is_zero() {
            return refresh.await;
        }
        match tokio::time::timeout(limit, refresh).await {
            Ok(result) => result,
            Err(_) => Err(BackendError::Snapshot(format!(
                "the refresh was abandoned after running for {} s without finishing",
                limit.as_secs()
            ))),
        }
    }

    /// How long to wait before the next try after `failures` failed releases in a
    /// row: the minimum interval or [`FAILED_RELEASE_RETRY`], whichever is longer,
    /// doubled per failure after the first and capped at
    /// [`FAILED_RELEASE_RETRY_MAX`].
    fn failed_release_hold(&self, failures: u32) -> Duration {
        let first = self.timing.min_interval.max(FAILED_RELEASE_RETRY);
        let doublings = failures.saturating_sub(1).min(16);
        first
            .saturating_mul(1u32 << doublings)
            .min(FAILED_RELEASE_RETRY_MAX.max(first))
    }

    /// The state, recovered from a poisoned lock: every critical section leaves it
    /// consistent, so a panic elsewhere while holding it loses nothing.
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// The requests one release took out of the pending count.
///
/// Dropping it without `published` set puts them back, which covers both a refresh
/// that failed and a forced refresh whose caller went away mid-flight.
struct Carried<'a> {
    batcher: &'a Batcher,
    requests: u64,
    published: bool,
}

impl<'a> Carried<'a> {
    /// Take every pending request.
    fn take(batcher: &'a Batcher) -> Self {
        let mut state = batcher.state();
        state.recovering = false;
        Self {
            batcher,
            requests: std::mem::take(&mut state.pending),
            published: false,
        }
    }
}

impl Drop for Carried<'_> {
    fn drop(&mut self) {
        {
            let mut state = self.batcher.state();
            if !self.published {
                state.pending = state.pending.saturating_add(self.requests);
            }
            // A finished refresh clears the durable record, including for requests
            // that arrived while it ran, so whatever is pending is recorded again.
            state.persisted = false;
        }
        self.batcher.wake.notify_one();
    }
}

/// Sleep until a batch is due, or forever with nothing pending.
async fn sleep_until_due(due: Option<(Instant, ReleaseReason)>) {
    match due {
        Some((at, _)) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
#[path = "publisher.batch.test.rs"]
mod tests;
