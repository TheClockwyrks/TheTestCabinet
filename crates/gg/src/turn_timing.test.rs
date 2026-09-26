//! These tests never sleep, and never measure.
//!
//! A turn's phase accounting is arithmetic over elapsed figures — see [`Clock`] — so every test
//! here hands the timer a clock it steps by hand and asserts the exact milliseconds that come out.
//! Nothing in this file depends on how fast, or how busy, the machine running it is.

use test_cabinet_core::gg::GgTelemetryEvent;

use crate::telemetry::CollectingSink;

use super::*;

/// The one timing event on a sink, asserting exactly one was emitted.
fn only_timing(sink: &CollectingSink) -> (u64, u64, u64) {
    let timings: Vec<(u64, u64, u64)> = sink
        .events()
        .iter()
        .filter_map(|event: &GgTelemetryEvent| match event.kind {
            GgTelemetryKind::TurnTiming {
                prompt_ms,
                request_ms,
                response_ms,
            } => Some((prompt_ms, request_ms, response_ms)),
            _ => None,
        })
        .collect();
    assert_eq!(timings.len(), 1, "exactly one timing per turn: {timings:?}");
    timings[0]
}

/// A fresh emitter over a collecting sink, and the sink to read the stream back from.
fn emitter() -> (Emitter, CollectingSink) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-1".to_string()), Box::new(sink.clone()));
    (emitter, sink)
}

/// A turn that runs all three phases reports all three, in the order they happened: the time
/// before the model call is the prompt phase, the call's own latency is the request phase, and
/// what follows is the response phase.
#[test]
fn splits_a_turn_into_its_three_phases() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let mut timer = TurnTimer::stepped(&emitter, clock.clone());
        // 20ms assembling the prompt, then the call is dispatched.
        clock.set_ms(20);
        timer.model_call_started();
        // The call takes 30ms, measured by the loop and reported back to the timer.
        clock.set_ms(50);
        timer.model_call_finished(30);
        // 20ms handling the response, and the turn ends.
        clock.set_ms(70);
    }

    assert_eq!(
        only_timing(&sink),
        (20, 30, 20),
        "each phase is the span it actually occupied",
    );
}

/// The three phases are a partition of the turn, never three independent measurements: they sum
/// to exactly the turn's wall-clock, so the console can stack them into one bar with no gap.
#[test]
fn the_phases_sum_to_the_turns_duration() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let mut timer = TurnTimer::stepped(&emitter, clock.clone());
        clock.set_ms(10);
        timer.model_call_started();
        clock.set_ms(20);
        timer.model_call_finished(10);
        clock.set_ms(30);
    }

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    assert_eq!(
        prompt_ms + request_ms + response_ms,
        30,
        "the partition is the whole turn and nothing but the turn: \
         {prompt_ms} + {request_ms} + {response_ms}",
    );
}

/// A turn that leaves before it ever reaches the model — a ceiling breached while the prompt was
/// still being assembled — still reports a timing, and reports all of its time as the phase it was
/// actually in rather than dropping the turn from the record.
#[test]
fn a_turn_that_never_reached_the_model_is_all_prompt() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let _timer = TurnTimer::stepped(&emitter, clock.clone());
        clock.set_ms(15);
    }

    assert_eq!(
        only_timing(&sink),
        (15, 0, 0),
        "all of it is assembly; the model was never called and there was no response to handle",
    );
}

/// A turn whose model call never returned — it failed, and the loop left on the error path —
/// reports the assembly it did, and the wait it was still in falls out as the remainder so the
/// turn's total is whole.
#[test]
fn a_call_that_never_returned_leaves_its_wait_in_the_remainder() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let mut timer = TurnTimer::stepped(&emitter, clock.clone());
        clock.set_ms(10);
        timer.model_call_started();
        // The call is dispatched and never comes back: no measured latency ever reaches the timer.
        clock.set_ms(25);
    }

    // The 15ms wait is reported as `response_ms` only because the timer has no figure for the
    // request it was in — what matters is that none of the turn is lost.
    assert_eq!(
        only_timing(&sink),
        (10, 0, 15),
        "the assembly it did, and the wait accounted for in the remainder",
    );
}

/// Dispatch is idempotent: a second `model_call_started` does not restate the prompt phase as
/// everything up to the retry, so a turn that re-dispatches keeps an honest assembly figure.
#[test]
fn re_marking_dispatch_keeps_the_first_boundary() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let mut timer = TurnTimer::stepped(&emitter, clock.clone());
        clock.set_ms(10);
        timer.model_call_started();
        // 25ms later the turn re-dispatches. The prompt phase must not swallow that.
        clock.set_ms(35);
        timer.model_call_started();
        timer.model_call_finished(25);
        clock.set_ms(40);
    }

    let (prompt_ms, _, _) = only_timing(&sink);
    assert_eq!(
        prompt_ms, 10,
        "the prompt phase ended at the first dispatch, not the second",
    );
}

/// A phase can only be as long as the turn that contains it. A model call whose reported latency
/// exceeds the turn's own elapsed time — the two figures come from different clocks, so nothing
/// stops them disagreeing — is clamped rather than allowed to overrun the partition and underflow
/// the remainder.
#[test]
fn a_phase_longer_than_its_turn_is_clamped_to_the_turn() {
    let (emitter, sink) = emitter();
    let clock = SteppedClock::started();
    {
        let mut timer = TurnTimer::stepped(&emitter, clock.clone());
        clock.set_ms(5);
        timer.model_call_started();
        timer.model_call_finished(1_000);
        clock.set_ms(8);
    }

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    assert_eq!(
        (prompt_ms, request_ms, response_ms),
        (5, 3, 0),
        "the request takes what is left of the turn, and the remainder does not go negative",
    );
    assert_eq!(prompt_ms + request_ms + response_ms, 8, "still a partition");
}

/// Every timer emits exactly one timing, so a run's timings and its `turn_started` events are
/// one-to-one however each turn ended.
#[test]
fn each_turn_emits_exactly_one_timing() {
    let (emitter, sink) = emitter();
    for _ in 0..3 {
        emitter.emit(GgTelemetryKind::TurnStarted {});
        let mut timer = TurnTimer::stepped(&emitter, SteppedClock::started());
        timer.model_call_started();
        timer.model_call_finished(1);
    }

    let events = sink.events();
    let starts = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count();
    let timings = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnTiming { .. }))
        .count();
    assert_eq!((starts, timings), (3, 3));
}
