use super::*;
// `GgRunLimits` and `GgLimitBreach` already ride in on the glob; only the ceiling taxonomy the
// emitter itself never names has to be named here.
use test_cabinet_core::gg::GgLimitKind;

/// The emitter serializes each event as one NDJSON line to its sink, stamped with the
/// session id and a timestamp, and the collecting sink captures them in order.
#[test]
fn emits_ndjson_lines_to_the_injected_sink() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-42".to_string()), Box::new(sink.clone()));

    emitter.emit(GgTelemetryKind::SessionStarted {
        capability_set: None,
    });
    emitter.emit(GgTelemetryKind::AssistantMessage {
        text: "hello".to_string(),
    });
    emitter.emit(GgTelemetryKind::SessionEnded {
        status: "completed".to_string(),
    });

    // One line per event, each valid NDJSON (no embedded newline).
    let lines = sink.lines();
    assert_eq!(lines.len(), 3);
    assert!(lines.iter().all(|line| !line.contains('\n')));

    // Round-trips back to the typed events, in order, all stamped with the session id
    // and a non-empty timestamp.
    let events = sink.events();
    assert!(matches!(
        events[0].kind,
        GgTelemetryKind::SessionStarted {
            capability_set: None
        }
    ));
    assert!(matches!(
        events[1].kind,
        GgTelemetryKind::AssistantMessage { ref text } if text == "hello"
    ));
    assert!(matches!(
        events[2].kind,
        GgTelemetryKind::SessionEnded { ref status } if status == "completed"
    ));
    assert!(events.iter().all(|event| {
        event.session_id.as_deref() == Some("run-42") && !event.timestamp.is_empty()
    }));
}

/// An agent-scoped emitter stamps every event with that agent's id and its spawner's id,
/// while sharing the base emitter's session id and its underlying sink.
#[test]
fn for_agent_stamps_the_agent_and_parent_ids() {
    let sink = CollectingSink::new();
    let base = Emitter::with_sink(Some("run-7".to_string()), Box::new(sink.clone()));

    // The base (unscoped) emitter carries no agent id.
    base.emit(GgTelemetryKind::SessionStarted {
        capability_set: None,
    });

    // A root-scoped emitter: its own id, no parent.
    let root = base.for_agent("root", None);
    root.emit(GgTelemetryKind::TurnStarted {});

    // A child-scoped emitter derived from the root: its own id, the root as parent. It writes to
    // the same shared sink.
    let child = root.for_agent("agent-1", Some("root".to_string()));
    child.emit(GgTelemetryKind::TurnStarted {});

    let events = sink.events();
    assert_eq!(events.len(), 3, "all three emitters share the one sink");

    // Base: no agent context.
    assert!(events[0].agent_id.is_none());
    assert!(events[0].parent_agent_id.is_none());
    // Root: tagged as root, no parent.
    assert_eq!(events[1].agent_id.as_deref(), Some("root"));
    assert!(events[1].parent_agent_id.is_none());
    // Child: tagged as itself, spawned by root.
    assert_eq!(events[2].agent_id.as_deref(), Some("agent-1"));
    assert_eq!(events[2].parent_agent_id.as_deref(), Some("root"));

    // The session id is inherited by every scope.
    assert!(
        events
            .iter()
            .all(|e| e.session_id.as_deref() == Some("run-7"))
    );
}

/// The four recorded (rather than folded) summary facts land on the **shared** tracker, so it does
/// not matter which derived emitter records them, and they survive onto the finalized summary. A
/// `LimitExceeded` an agent emits on the same stream is deliberately not folded, so a subagent's
/// ceiling never becomes the run's recorded outcome.
#[test]
fn the_recorded_summary_facts_reach_the_shared_tracker() {
    let sink = CollectingSink::new();
    let base = Emitter::with_sink(Some("run-9".to_string()), Box::new(sink.clone()));
    let root = base.for_agent("root", None);
    let child = root.for_agent("agent-1", Some("root".to_string()));

    let limits = GgRunLimits {
        max_turns: Some(12),
        max_cost: Some(2.5),
        ..GgRunLimits::default()
    };
    let child_breach = GgLimitBreach {
        limit: GgLimitKind::ErrorRate,
        threshold: 0.5,
        observed: 0.6,
        turns: 10,
        agent_id: "agent-1".to_string(),
        window: Some(10),
    };

    // The child records the run's configuration facts and stops on its own ceiling, emitting the
    // event the tracker observes but must not fold.
    child.record_execution_mode("responses_as_code");
    child.record_effective_tools(vec!["shell".to_string()]);
    child.record_limits(limits);
    child.emit(GgTelemetryKind::LimitExceeded {
        breach: child_breach.clone(),
    });
    // The root ended on its own terms, so the run hit no ceiling.
    root.record_limit_hit(None);

    // Any emitter can finalize: they all share one tracker.
    let summary = base.finalize_summary("completed");
    assert_eq!(summary.execution_mode, "responses_as_code");
    assert_eq!(summary.effective_tools, vec!["shell".to_string()]);
    assert_eq!(summary.limits, limits);
    assert_eq!(
        summary.limit_hit, None,
        "the child's ceiling stopped the child, not the run"
    );

    // The child's breach is still on the wire, attributed to the child's own stream — recording and
    // emitting are independent, and dropping the fold does not drop the event.
    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].agent_id.as_deref(), Some("agent-1"));
    assert!(matches!(
        events[0].kind,
        GgTelemetryKind::LimitExceeded { ref breach } if *breach == child_breach
    ));
}

/// `now_rfc3339` yields a parseable RFC 3339 timestamp (not the empty fallback).
#[test]
fn now_rfc3339_is_parseable() {
    let stamp = now_rfc3339();
    assert!(!stamp.is_empty());
    OffsetDateTime::parse(&stamp, &Rfc3339).expect("valid RFC 3339 timestamp");
}
