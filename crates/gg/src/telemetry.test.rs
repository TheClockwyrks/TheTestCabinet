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

/// `now_rfc3339` yields a parseable RFC 3339 timestamp (not the empty fallback).
#[test]
fn now_rfc3339_is_parseable() {
    let stamp = now_rfc3339();
    assert!(!stamp.is_empty());
    OffsetDateTime::parse(&stamp, &Rfc3339).expect("valid RFC 3339 timestamp");
}
