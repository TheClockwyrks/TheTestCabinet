//! **Cancellation** — how a gg run learns that its host wants it stopped, and why that
//! is a file on disk rather than a signal.
//!
//! # The channel
//!
//! gg runs as its own process inside the run container. The host driving it holds no
//! handle on that process — it holds the *container*, and reads gg's telemetry off an
//! exec stream. What the host can always do is put a file inside the container. So the
//! cancellation channel is exactly that: the host names a
//! [sentinel path](test_cabinet_core::gg::GgInvocation::cancel_file) in the invocation
//! document, and creates that file when an operator kills the run.
//!
//! Killing the process instead would be worse in the way that matters: gg's result is
//! its telemetry, and the most valuable part of it — the session summary, the per-slot
//! rollups, the replay sidecar — is emitted in the session's epilogue. A signal that cut
//! the process down would throw away precisely what the operator killed the run to look
//! at.
//!
//! # The reading
//!
//! Every agent checks this at its own turn boundary, next to the run-wide
//! [deadline and cost ceilings](crate::limits) and on exactly the same terms — the same
//! "N independent readers of one value, each stopping itself" shape those already use,
//! and for the same stated reason: a turn is the loop's atomic unit, so the wind-down
//! bound is one turn per agent and no turn is ever abandoned half-applied. One `stat`
//! per turn against turns measured in seconds is not a cost worth engineering around.
//!
//! The observation **latches**. Once any agent has seen the sentinel the whole run is
//! canceled, whatever happens to the file afterwards — otherwise a sentinel removed
//! mid-wind-down would stop the agents that had already reached a boundary and leave the
//! rest running, which is not a state anybody asked for.

#[cfg(test)]
#[path = "cancel.test.rs"]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// The run-wide cancellation watch: the sentinel path to look for, plus the latch that
/// records that it has been seen.
///
/// Cloning shares the latch (it is `Arc`-backed), so every agent in the run — the root
/// and every subagent — observes one decision rather than each racing the filesystem
/// independently. A [`disabled`](Self::disabled) watch has no path and is never
/// canceled, which is the shape a run whose host cannot cancel it takes; no call site
/// needs an `Option`.
#[derive(Debug, Clone, Default)]
pub struct CancelWatch {
    /// The sentinel to watch for, or `None` when this run cannot be canceled.
    path: Option<PathBuf>,
    /// Whether the sentinel has been observed. Latching: only ever set.
    seen: Arc<AtomicBool>,
}

impl CancelWatch {
    /// Watch `path` for the host's cancellation sentinel.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            seen: Arc::new(AtomicBool::new(false)),
        }
    }

    /// A watch that can never fire — the shape of a run whose host cannot cancel it, so
    /// no call site needs an `Option`.
    pub fn disabled() -> Self {
        Self::default()
    }

    /// Whether the run has been canceled, checked at an agent's turn boundary.
    ///
    /// Reads the latch first so a canceled run stops stat-ing the filesystem once the
    /// decision is made, and latches the observation so every other agent reaches the
    /// same conclusion at its own boundary even if the sentinel is removed in between.
    pub fn is_canceled(&self) -> bool {
        if self.seen.load(Ordering::SeqCst) {
            return true;
        }
        let Some(path) = self.path.as_deref() else {
            return false;
        };
        if sentinel_present(path) {
            self.seen.store(true, Ordering::SeqCst);
            return true;
        }
        false
    }
}

/// Whether the cancellation sentinel exists.
///
/// A path that cannot be examined at all (a permission error, a vanished parent) reads
/// as *not* canceled: a run must never be stopped by an inability to answer the
/// question, and the host retries by leaving the file there.
fn sentinel_present(path: &Path) -> bool {
    path.try_exists().unwrap_or(false)
}
