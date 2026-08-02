//! The context projection — specifically, what it leaves out.
//!
//! The exclusions are the load-bearing half: a projection that quietly kept a wall-clock figure
//! would fail every round trip, and the fix somebody reaches for under that pressure is to relax the
//! comparison until it proves nothing.

use test_cabinet_core::gg::GgTelemetryEvent;

use super::*;

/// One event on the root's stream.
fn event(kind: GgTelemetryKind) -> GgTelemetryEvent {
    GgTelemetryEvent {
        timestamp: "2026-08-01T00:00:00Z".to_string(),
        session_id: Some("run-projection".to_string()),
        agent_id: Some("root".to_string()),
        parent_agent_id: None,
        issue_id: None,
        kind,
    }
}

/// A prompt event with `duration_ms`.
fn prompt(duration_ms: Option<u64>) -> GgTelemetryEvent {
    event(GgTelemetryKind::Prompt {
        request: Vec::new(),
        total_tokens: 42,
        response_id: Some("resp-1".to_string()),
        finish_reason: "stop".to_string(),
        tokens: TokenCounts::default(),
        cost: None,
        duration_ms,
    })
}

/// Two streams that differ **only** in wall clock project identically — the property the round trip
/// rests on, since a reconstruction's model call takes microseconds where the run's took seconds.
#[test]
fn wall_clock_is_the_only_exclusion_and_it_is_total() {
    let recorded = vec![
        prompt(Some(31_415)),
        event(GgTelemetryKind::TurnTiming {
            prompt_ms: 12,
            request_ms: 31_415,
            response_ms: 7,
        }),
    ];
    let reconstructed = vec![
        prompt(Some(0)),
        event(GgTelemetryKind::TurnTiming {
            prompt_ms: 0,
            request_ms: 0,
            response_ms: 1,
        }),
    ];

    assert_eq!(
        ContextProjection::project(&recorded),
        ContextProjection::project(&reconstructed),
        "a projection that kept a wall-clock figure would fail every round trip"
    );
}

/// Everything the projection *does* carry is compared: a finish reason that moved is a difference.
#[test]
fn a_moved_finish_reason_is_a_difference() {
    let stopped = vec![prompt(None)];
    let mut ran_long = stopped.clone();
    if let GgTelemetryKind::Prompt { finish_reason, .. } = &mut ran_long[0].kind {
        *finish_reason = "length".to_string();
    }
    assert_ne!(
        ContextProjection::project(&stopped),
        ContextProjection::project(&ran_long)
    );
}

/// Context messages and the terminal summary survive the projection; the operator log does not —
/// a playback adds lines of its own, which is correct and must not fail a comparison.
#[test]
fn messages_and_the_summary_are_in_and_the_log_is_out() {
    let events = vec![
        event(GgTelemetryKind::ContextMessage {
            id: "msg-1".to_string(),
            role: "system".to_string(),
            content: Some("you are gg".to_string()),
            tool_calls: Vec::new(),
            tool_call_id: None,
            images: Vec::new(),
            tokens: 4,
            label: None,
        }),
        event(GgTelemetryKind::Log {
            level: "info".to_string(),
            message: "playback: reconstructing".to_string(),
        }),
        event(GgTelemetryKind::SessionSummary {
            summary: Box::new(crate::summary::SessionSummaryTracker::new().finalize("completed")),
        }),
    ];

    let projection = ContextProjection::project(&events);
    assert_eq!(projection.messages.len(), 1);
    assert_eq!(projection.messages[0].id, "msg-1");
    assert_eq!(
        projection
            .summary
            .as_ref()
            .map(|s| s.terminal_status.as_str()),
        Some("completed")
    );

    // The same stream with one more log line projects the same.
    let mut noisier = events.clone();
    noisier.insert(
        1,
        event(GgTelemetryKind::Log {
            level: "warn".to_string(),
            message: "playback: reconstructing under `shape` strictness".to_string(),
        }),
    );
    assert_eq!(
        ContextProjection::project(&events),
        ContextProjection::project(&noisier)
    );
}
