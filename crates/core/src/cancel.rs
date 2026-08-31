//! **Run cancellation** — the signal an operator's kill travels on, from the driver
//! that observes it down to the gg session that has to wind down for it.
//!
//! # What the signal is for
//!
//! Cancellation is **cooperative for a [gg](crate::gg) run**, and the latch is the
//! request. gg checks an in-container sentinel at every turn boundary, so the signal is
//! raised, the session is asked to stop and given a bounded chance to do so, and the run
//! then finishes through its ordinary post-session path — [collecting the produced
//! tree](crate::ArtifactCollector), folding the accumulated usage into
//! [metrics](crate::metrics::RunMetrics), writing the record. That is the reason to ask
//! rather than to drop: a run's *result* is assembled after the session returns, so a
//! dropped future skips every one of those stages and costs the operator the very thing
//! a kill is issued to look at — everything the run had done up to that point. This is
//! the same shape gg's own run-wide ceilings already use, for the same reason (see
//! `crate::gg` and gg's `limits` module): a turn is the loop's atomic unit, so the
//! wind-down bound is one turn, and nothing is abandoned half-applied.
//!
//! A **third-party harness** run is destroyed instead. It is a CLI driven through an
//! `exec` — there is no boundary at which it can be told to stop and no epilogue to wait
//! for — so nothing on that path ever observes this latch, and the driver does not raise
//! one it knows will not be read. Waiting would produce no earlier record; it would only
//! hold the run's driver, and with it a dispatcher scheduling slot, open until the
//! session ended on its own. So the driver drops the run and tears the sandbox down at
//! once (see the driver's `cancel` module).
//!
//! # Dropping never stops a harness
//!
//! True of both paths: **dropping the run future does not stop the run**. A harness — gg
//! included — executes as its own process inside the run container, and the future the
//! host holds is only reading that process's output stream. Dropping it closes the
//! stream; the harness carries on, and keeps spending, until the sandbox is torn out
//! from under it. Deleting the sandbox, not dropping the future, is what ends a run.
//!
//! # Shape
//!
//! [`RunCancellation`] is a latch, not a channel: once raised it stays raised, and it
//! can be observed either by polling ([`is_canceled`](RunCancellation::is_canceled), for
//! a caller at a natural boundary) or by awaiting ([`canceled`](RunCancellation::canceled),
//! for a caller parked on something else). Cloning shares the latch. A run that nothing
//! can cancel simply holds one that is never raised, so no call site needs an `Option`.

#[cfg(test)]
#[path = "cancel.test.rs"]
mod tests;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::Notify;

/// The cancellation latch for one run: raised once, by whoever observes the operator's
/// kill, and read by everyone who has to wind down for it.
///
/// Cloning shares the same latch (it is `Arc`-backed), so the driver's watcher and the
/// engine stage that has to act on it hold the same signal. A [`Default`] one is never
/// raised — the shape a run with no cancellation path takes.
#[derive(Debug, Clone, Default)]
pub struct RunCancellation {
    inner: Arc<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    /// Whether the kill has been observed. Latching: it is only ever set.
    raised: AtomicBool,
    /// Wakes every awaiting observer when `raised` is set.
    wake: Notify,
}

impl RunCancellation {
    /// A fresh, un-raised latch.
    pub fn new() -> Self {
        Self::default()
    }

    /// Raise the latch: the run has been canceled. Idempotent — a second call is a
    /// no-op, so a duplicate observation cannot double-signal anything.
    ///
    /// `notify_waiters` is called under the same ordering as the store, so an observer
    /// that misses the wake still sees `raised` on its next poll: the latch, not the
    /// notification, is the source of truth.
    pub fn cancel(&self) {
        self.inner.raised.store(true, Ordering::SeqCst);
        self.inner.wake.notify_waiters();
    }

    /// Whether the run has been canceled. The form for a caller sitting at a natural
    /// boundary (a turn edge, a loop head) that can simply ask.
    pub fn is_canceled(&self) -> bool {
        self.inner.raised.load(Ordering::SeqCst)
    }

    /// Resolve once the run has been canceled — immediately if it already has. The form
    /// for a caller parked on something else, which races this against its own work.
    ///
    /// Checking before *and* after registering for the notification closes the race
    /// where the latch is raised between the two: `Notify` only wakes waiters registered
    /// at the time it fires, so a caller that registered late would otherwise wait
    /// forever on a signal that had already been sent.
    pub async fn canceled(&self) {
        if self.is_canceled() {
            return;
        }
        let notified = self.inner.wake.notified();
        tokio::pin!(notified);
        // Registering happens on `enable`, before the check below, so a `cancel` racing
        // us here wakes this waiter rather than passing it by.
        notified.as_mut().enable();
        if self.is_canceled() {
            return;
        }
        notified.await;
    }
}
