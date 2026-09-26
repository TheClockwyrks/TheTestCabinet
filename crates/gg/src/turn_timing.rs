//! Where a turn's wall-clock went, split into the three phases every turn passes through.
//!
//! A gg turn is not one operation but three, and they fail and drag for entirely different
//! reasons. First gg **assembles the prompt** — drains the agent's inbox, refreshes the pinned
//! blocks, runs any triggered compaction, resolves the offered toolset. Then it **waits on the
//! model**. Then it **handles the response** — dispatches and answers every tool call (or runs the
//! turn's program, in responses-as-code mode) and applies the state transitions the turn asked for.
//! A run that feels slow can be slow in any of them, and the turn's total says which only by
//! accident. This module records the split so it is a measurement rather than a guess.
//!
//! The unit of accounting is a [`TurnTimer`], created immediately after the turn's
//! [`TurnStarted`](GgTelemetryKind::TurnStarted) and dropped when the turn's scope ends. It emits
//! exactly one [`TurnTiming`](GgTelemetryKind::TurnTiming) per turn **on drop**, which is what makes
//! it exhaustive: the turn loop leaves through dozens of paths — a breached ceiling, a failed model
//! call, a `finish`, a plain fall-through — and every one of them ends the turn's scope. A timing
//! emitted from the end of the loop body instead would silently skip every abnormal turn, which are
//! precisely the turns worth looking at. The cost is ordering: a turn cut short reports its timing
//! *after* the event that ended it, because the accounting closes when the turn does.
//!
//! The three figures are a **partition** of the turn, not three independent stopwatches:
//! [`prompt_ms`](TurnTimer::model_call_started) is measured to the model call, `request_ms` is the
//! call's own latency, and the response phase is whatever is left. They therefore always sum to the
//! turn's wall-clock duration exactly, which is what lets the console stack them into one bar per
//! turn with no gap and no overlap.

use std::time::Instant;

use test_cabinet_core::gg::GgTelemetryKind;

use crate::telemetry::Emitter;

/// Where a turn's elapsed milliseconds are read from.
///
/// A run reads the wall clock, which is the only honest source for a real turn. A **test** must
/// not. What is worth testing here is the arithmetic — which boundary fixes which phase, how a
/// phase that was never closed is accounted for, that the three always sum to the whole — and a
/// test that produces its elapsed figures by sleeping is not testing that arithmetic; it is
/// testing how loaded the machine is. Such a test has only two settings, and both are bad: bounds
/// wide enough to survive a saturated CI runner are wide enough to pass with the arithmetic
/// removed, and bounds tight enough to mean something fail whenever the box is busy. So the timer
/// reads its elapsed time from this, and a test hands it a clock it steps by hand and asserts
/// exact figures.
enum Clock {
    /// The wall clock, running since the turn began.
    Wall(Instant),
    /// A clock that reads whatever it was last set to. Test-only, by construction: nothing outside
    /// a test can build one.
    #[cfg(test)]
    Stepped(SteppedClock),
}

impl Clock {
    /// Milliseconds since the turn began, saturating rather than wrapping on the (unreachable)
    /// overflow of a turn longer than 584 million years.
    fn elapsed_ms(&self) -> u64 {
        match self {
            Self::Wall(started) => u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            #[cfg(test)]
            Self::Stepped(clock) => clock.read_ms(),
        }
    }
}

/// A clock a test drives by hand: it reads whatever [`set_ms`](Self::set_ms) last put on it.
///
/// Shared with the [`TurnTimer`] that holds it, so a test can move it on while the timer is alive
/// — including after the last boundary and before the drop, which is where the turn's total is
/// taken.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct SteppedClock(std::sync::Arc<std::sync::atomic::AtomicU64>);

#[cfg(test)]
impl SteppedClock {
    /// A clock reading zero — the instant the turn began.
    pub fn started() -> Self {
        Self::default()
    }

    /// Move it to `ms` milliseconds after the turn began.
    pub fn set_ms(&self, ms: u64) {
        self.0.store(ms, std::sync::atomic::Ordering::Relaxed);
    }

    /// What it currently reads.
    fn read_ms(&self) -> u64 {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// One turn's phase accounting, which emits the turn's
/// [`TurnTiming`](GgTelemetryKind::TurnTiming) when it is dropped.
///
/// Create it right after the turn's [`TurnStarted`](GgTelemetryKind::TurnStarted) and let it live
/// for exactly the turn's scope. Call [`model_call_started`](Self::model_call_started) when the
/// request is dispatched and [`model_call_finished`](Self::model_call_finished) when it returns;
/// everything before the first is the prompt phase, everything after the second is the response
/// phase. A turn that never reaches the model simply never calls them, and reports all of its time
/// as prompt construction — which is where it actually went.
pub struct TurnTimer<'a> {
    /// Where the turn's timing is emitted, on drop.
    emitter: &'a Emitter,
    /// How long the turn has been running, counted from the moment the timer was created just
    /// after `TurnStarted`.
    clock: Clock,
    /// How long prompt assembly took, fixed when the model call was dispatched. `None` while the
    /// turn is still assembling, and for a turn that never reached the model at all.
    prompt_ms: Option<u64>,
    /// The model call's own latency, fixed when the call returned. `None` while the call is in
    /// flight, and for a turn whose call never returned (it failed, or the turn left first).
    request_ms: Option<u64>,
}

impl<'a> TurnTimer<'a> {
    /// Start accounting for a turn that begins **now**, reporting to `emitter` when dropped.
    pub fn start(emitter: &'a Emitter) -> Self {
        Self::on(emitter, Clock::Wall(Instant::now()))
    }

    /// Start accounting for a turn whose elapsed time comes from a hand-stepped clock rather than
    /// the wall clock — see [`Clock`] for why the tests measure nothing.
    #[cfg(test)]
    pub fn stepped(emitter: &'a Emitter, clock: SteppedClock) -> Self {
        Self::on(emitter, Clock::Stepped(clock))
    }

    /// Start accounting against `clock`, which is reading zero.
    fn on(emitter: &'a Emitter, clock: Clock) -> Self {
        Self {
            emitter,
            clock,
            prompt_ms: None,
            request_ms: None,
        }
    }

    /// Close the prompt-assembly phase: the request is being dispatched to the model.
    ///
    /// Idempotent by design — only the first call fixes the boundary, so a turn that retries its
    /// dispatch does not restate its prompt phase as the whole turn up to the retry. (The
    /// vision-recovery retry lives *inside* the call and is charged to the request phase, which is
    /// the latency the turn actually paid.)
    pub fn model_call_started(&mut self) {
        self.prompt_ms
            .get_or_insert_with(|| self.clock.elapsed_ms());
    }

    /// Close the model-call phase with the call's measured latency, in milliseconds — the same
    /// figure the turn's [`Prompt`](GgTelemetryKind::Prompt) carries as `duration_ms`, so the two
    /// events never disagree about how long the model took. Everything after this is the response
    /// phase.
    pub fn model_call_finished(&mut self, request_ms: u64) {
        self.request_ms = Some(request_ms);
    }
}

impl Drop for TurnTimer<'_> {
    fn drop(&mut self) {
        let total = self.clock.elapsed_ms();
        // A turn that never reached the model spent all of itself assembling; one whose call never
        // returned spent nothing after it. Both clamp to the turn's real duration so the partition
        // holds even when the phases are cut short.
        let prompt_ms = self.prompt_ms.unwrap_or(total).min(total);
        let request_ms = self.request_ms.unwrap_or(0).min(total - prompt_ms);
        self.emitter.emit(GgTelemetryKind::TurnTiming {
            prompt_ms,
            request_ms,
            // The remainder, so the three always sum to exactly the turn's wall-clock.
            response_ms: total - prompt_ms - request_ms,
        });
    }
}

#[cfg(test)]
#[path = "turn_timing.test.rs"]
mod tests;
