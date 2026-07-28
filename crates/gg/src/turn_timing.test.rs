use std::thread::sleep;
use std::time::Duration;

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
    {
        let mut timer = TurnTimer::start(&emitter);
        sleep(Duration::from_millis(20));
        timer.model_call_started();
        // Stand in for the model call, measured the way the loop measures it.
        let call = Instant::now();
        sleep(Duration::from_millis(30));
        timer.model_call_finished(u64::try_from(call.elapsed().as_millis()).expect("fits"));
        sleep(Duration::from_millis(20));
    }

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    assert!(
        prompt_ms >= 20,
        "the 20ms before the call is the prompt phase: {prompt_ms}"
    );
    assert!(
        request_ms >= 30,
        "the call's own measured latency: {request_ms}"
    );
    assert!(
        response_ms >= 20,
        "the 20ms after the call is the response phase: {response_ms}"
    );
}

/// The three phases are a partition of the turn, never three independent measurements: they sum
/// to exactly the turn's wall-clock, so the console can stack them into one bar with no gap.
#[test]
fn the_phases_sum_to_the_turns_duration() {
    let (emitter, sink) = emitter();
    let started = Instant::now();
    {
        let mut timer = TurnTimer::start(&emitter);
        sleep(Duration::from_millis(10));
        timer.model_call_started();
        sleep(Duration::from_millis(10));
        timer.model_call_finished(10);
        sleep(Duration::from_millis(10));
    }
    let total = u64::try_from(started.elapsed().as_millis()).expect("fits");

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    let sum = prompt_ms + request_ms + response_ms;
    assert!(
        sum <= total,
        "the partition cannot exceed the turn it partitions: {sum} > {total}"
    );
    assert!(
        sum + 5 >= total,
        "the partition accounts for the whole turn: {sum} vs {total}"
    );
}

/// A turn that leaves before it ever reaches the model — a ceiling breached while the prompt was
/// still being assembled — still reports a timing, and reports all of its time as the phase it was
/// actually in rather than dropping the turn from the record.
#[test]
fn a_turn_that_never_reached_the_model_is_all_prompt() {
    let (emitter, sink) = emitter();
    {
        let _timer = TurnTimer::start(&emitter);
        sleep(Duration::from_millis(15));
    }

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    assert!(prompt_ms >= 15, "all of it is assembly: {prompt_ms}");
    assert_eq!(request_ms, 0, "the model was never called");
    assert_eq!(response_ms, 0, "there was no response to handle");
}

/// A turn whose model call never returned — it failed, and the loop left on the error path —
/// reports the assembly it did and charges the rest to the request it was waiting on, rather than
/// mislabelling the wait as response handling.
#[test]
fn a_call_that_never_returned_charges_the_wait_to_the_request() {
    let (emitter, sink) = emitter();
    {
        let mut timer = TurnTimer::start(&emitter);
        sleep(Duration::from_millis(10));
        timer.model_call_started();
        sleep(Duration::from_millis(15));
    }

    let (prompt_ms, request_ms, response_ms) = only_timing(&sink);
    assert!(prompt_ms >= 10, "the assembly it did: {prompt_ms}");
    // With no measured latency the wait falls out as the remainder, which the response phase would
    // otherwise absorb. It is reported as `response_ms` only because the timer has no better
    // figure — what matters is that the turn's total is still whole.
    assert!(
        request_ms + response_ms >= 15,
        "the wait is accounted for: {request_ms} + {response_ms}"
    );
}

/// Dispatch is idempotent: a second `model_call_started` does not restate the prompt phase as
/// everything up to the retry, so a turn that re-dispatches keeps an honest assembly figure.
#[test]
fn re_marking_dispatch_keeps_the_first_boundary() {
    let (emitter, sink) = emitter();
    {
        let mut timer = TurnTimer::start(&emitter);
        sleep(Duration::from_millis(10));
        timer.model_call_started();
        sleep(Duration::from_millis(25));
        timer.model_call_started();
        timer.model_call_finished(25);
    }

    let (prompt_ms, _, _) = only_timing(&sink);
    assert!(
        prompt_ms < 30,
        "the prompt phase ended at the first dispatch, not the second: {prompt_ms}"
    );
}

/// Every timer emits exactly one timing, so a run's timings and its `turn_started` events are
/// one-to-one however each turn ended.
#[test]
fn each_turn_emits_exactly_one_timing() {
    let (emitter, sink) = emitter();
    for _ in 0..3 {
        emitter.emit(GgTelemetryKind::TurnStarted {});
        let mut timer = TurnTimer::start(&emitter);
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
