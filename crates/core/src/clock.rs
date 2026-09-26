//! The monotonic clock the [run engine](crate::RunEngine) reads its stage durations from.
//!
//! A run records how long its setup, session, teardown and validation took, and which stage a
//! span of time lands in is decided entirely by where the engine reads the clock. Injecting the
//! clock is what lets that placement be tested exactly: a test hands the engine a [`ManualClock`]
//! and has each faked stage advance it by a known amount, so the recorded figures are exactly those
//! amounts rather than readings of how busy the machine was. Every production host uses
//! [`SystemClock`].

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// A monotonic clock, read as the time since an origin of the clock's choosing.
///
/// Only differences between two readings of the same clock mean anything.
pub trait Clock: Send + Sync {
    /// The time since this clock's origin.
    fn now(&self) -> Duration;
}

/// The host's monotonic clock: [`Instant`], read against the moment this process first asked.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Duration {
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        ORIGIN.get_or_init(Instant::now).elapsed()
    }
}

/// A clock that moves only when it is [advanced](Self::advance).
///
/// Cloning shares the clock, so the engine and the fakes a test drives it with read and move one
/// clock. Held to nanosecond precision.
#[derive(Debug, Clone, Default)]
pub struct ManualClock {
    nanos: Arc<AtomicU64>,
}

impl ManualClock {
    /// A clock standing at its origin.
    pub fn new() -> Self {
        Self::default()
    }

    /// Move the clock forward by `by`.
    pub fn advance(&self, by: Duration) {
        let nanos = u64::try_from(by.as_nanos()).unwrap_or(u64::MAX);
        self.nanos.fetch_add(nanos, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Duration {
        Duration::from_nanos(self.nanos.load(Ordering::SeqCst))
    }
}

#[cfg(test)]
#[path = "clock.test.rs"]
mod tests;
