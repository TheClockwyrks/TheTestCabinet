use super::*;

/// The emitter serializes each event as one NDJSON line to its sink, stamped with the
/// session id and a timestamp, and the collecting sink captures them in order.
#[test]
fn emits_ndjson_lines_to_the_injected_sink() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-42".to_string()), Box::new(sink.clone()));

    emitter.emit(GgTelemetryKind::SessionStarted {});
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
    assert!(matches!(events[0].kind, GgTelemetryKind::SessionStarted {}));
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
    base.emit(GgTelemetryKind::SessionStarted {});

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

/// `now_rfc3339` yields a parseable RFC 3339 timestamp (not the empty fallback).
#[test]
fn now_rfc3339_is_parseable() {
    let stamp = now_rfc3339();
    assert!(!stamp.is_empty());
    OffsetDateTime::parse(&stamp, &Rfc3339).expect("valid RFC 3339 timestamp");
}
