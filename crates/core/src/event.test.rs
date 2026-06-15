//! Tests for normalized event translation across harness output formats.

use serde_json::json;

use super::*;
use crate::execution::OutputStream;

/// Ingest a single Codex stdout line and return the events it produced.
fn codex(line: &str) -> Vec<HarnessEvent> {
    EventParser::new(EventFormat::Codex).ingest(OutputStream::Stdout, line)
}

/// The single event a line is expected to produce, panicking otherwise.
fn one(mut events: Vec<HarnessEvent>) -> EventKind {
    assert_eq!(events.len(), 1, "expected exactly one event");
    events.remove(0).kind
}

#[test]
fn stderr_lines_become_warnings_for_any_format() {
    let mut parser = EventParser::new(EventFormat::Codex);
    let kind = one(parser.ingest(
        OutputStream::Stderr,
        "Reading additional input from stdin...",
    ));
    assert_eq!(
        kind,
        EventKind::Warning {
            message: "Reading additional input from stdin...".to_string(),
            code: None,
        }
    );
}

#[test]
fn blank_lines_produce_no_events() {
    let mut parser = EventParser::new(EventFormat::Codex);
    assert!(parser.ingest(OutputStream::Stdout, "   ").is_empty());
    assert!(parser.ingest(OutputStream::Stderr, "").is_empty());
}

#[test]
fn generic_format_preserves_each_line_as_unknown() {
    let mut parser = EventParser::new(EventFormat::Generic);
    let json_kind = one(parser.ingest(OutputStream::Stdout, r#"{"some":"event"}"#));
    assert_eq!(
        json_kind,
        EventKind::Unknown {
            raw: json!({"some": "event"})
        }
    );

    let text_kind = one(parser.ingest(OutputStream::Stdout, "plain progress text"));
    assert_eq!(
        text_kind,
        EventKind::Unknown {
            raw: json!("plain progress text")
        }
    );
}

#[test]
fn codex_thread_started_sets_the_session_id_for_later_events() {
    let mut parser = EventParser::new(EventFormat::Codex);
    assert!(
        parser
            .ingest(
                OutputStream::Stdout,
                r#"{"type":"thread.started","thread_id":"thread-123"}"#,
            )
            .is_empty()
    );

    let events = parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}"#,
    );
    assert_eq!(events[0].session_id.as_deref(), Some("thread-123"));
}

#[test]
fn codex_turn_and_started_events_are_consumed_silently() {
    for line in [
        r#"{"type":"turn.started"}"#,
        r#"{"type":"turn.completed","usage":{"input_tokens":1}}"#,
        r#"{"type":"item.started","item":{"type":"command_execution","command":"ls"}}"#,
    ] {
        assert!(codex(line).is_empty(), "{line} should produce no event");
    }
}

#[test]
fn codex_plain_command_keeps_exit_code_and_success() {
    let kind = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":1}}"#,
    ));
    assert_eq!(
        kind,
        EventKind::Command {
            command: "npm test".to_string(),
            working_directory: None,
            exit_code: Some(1),
            is_success: Some(false),
        }
    );
}

#[test]
fn codex_classifies_wrapped_file_reads_and_searches() {
    let cat = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc \"cat README.md\"","exit_code":0}}"#,
    ));
    assert_eq!(
        cat,
        EventKind::Read {
            path: "README.md".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );

    let sed = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc \"sed -n '10,20p' src/main.ts\"","exit_code":0}}"#,
    ));
    assert_eq!(
        sed,
        EventKind::Read {
            path: "src/main.ts".to_string(),
            start_line: Some(10),
            end_line: Some(20),
            is_success: Some(true),
        }
    );

    let rg = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc 'rg -n needle src'","exit_code":0}}"#,
    ));
    assert_eq!(
        rg,
        EventKind::Search {
            query: "needle".to_string(),
            path: None,
            is_success: Some(true),
        }
    );

    let ls = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc \"ls src\"","exit_code":0}}"#,
    ));
    assert_eq!(
        ls,
        EventKind::List {
            path: Some("src".to_string()),
            is_success: Some(true),
        }
    );
}

#[test]
fn codex_sed_without_print_range_stays_a_command() {
    // An in-place edit is not a read and must not be reclassified.
    let kind = one(codex(
        r#"{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc \"sed -i s/a/b/ file\"","exit_code":0}}"#,
    ));
    assert!(matches!(kind, EventKind::Command { .. }));
}

#[test]
fn codex_file_change_emits_one_write_per_path() {
    let events = codex(
        r#"{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"/work/a.ts","kind":"add"},{"path":"/work/b.ts","kind":"update"}]}}"#,
    );
    let paths: Vec<_> = events
        .iter()
        .map(|event| match &event.kind {
            EventKind::Write { path, .. } => path.clone(),
            other => panic!("expected write, got {other:?}"),
        })
        .collect();
    assert_eq!(paths, vec!["/work/a.ts", "/work/b.ts"]);
}

#[test]
fn codex_agent_message_and_error_items_map_to_their_events() {
    assert_eq!(
        one(codex(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"building"}}"#,
        )),
        EventKind::Agent {
            message: "building".to_string(),
        }
    );
    assert_eq!(
        one(codex(
            r#"{"type":"item.completed","item":{"type":"error","message":"hook trust bypassed"}}"#,
        )),
        EventKind::Error {
            message: "hook trust bypassed".to_string(),
            code: None,
        }
    );
}

#[test]
fn codex_unrecognized_lines_and_items_become_unknown() {
    assert!(matches!(
        one(codex(r#"{"type":"mystery"}"#)),
        EventKind::Unknown { .. }
    ));
    assert!(matches!(
        one(codex(
            r#"{"type":"item.completed","item":{"type":"reasoning","text":"..."}}"#,
        )),
        EventKind::Unknown { .. }
    ));
    // Non-JSON on stdout is a diagnostic printed outside the JSON stream.
    assert!(matches!(
        one(codex("not json at all")),
        EventKind::Warning { .. }
    ));
}

#[test]
fn events_serialize_with_the_type_inline_and_camel_case_fields() {
    let event = HarnessEvent {
        timestamp: "2026-06-15T00:00:00Z".to_string(),
        session_id: Some("thread-1".to_string()),
        kind: EventKind::Command {
            command: "npm run build".to_string(),
            working_directory: None,
            exit_code: Some(0),
            is_success: Some(true),
        },
    };
    let value = serde_json::to_value(&event).expect("serialize");
    assert_eq!(
        value,
        json!({
            "timestamp": "2026-06-15T00:00:00Z",
            "sessionId": "thread-1",
            "type": "command",
            "command": "npm run build",
            "exitCode": 0,
            "isSuccess": true
        })
    );
}

#[test]
fn unset_optional_fields_are_omitted_when_serialized() {
    let event = HarnessEvent {
        timestamp: "2026-06-15T00:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: "hello".to_string(),
        },
    };
    let value = serde_json::to_value(&event).expect("serialize");
    assert_eq!(
        value,
        json!({
            "timestamp": "2026-06-15T00:00:00Z",
            "type": "agent",
            "message": "hello"
        })
    );
}

#[test]
fn orchestration_actions_use_their_documented_slugs() {
    assert_eq!(
        serde_json::to_value(OrchestrationAction::SubagentStarted).unwrap(),
        json!("subagent_started")
    );
    assert_eq!(
        serde_json::to_value(OrchestrationAction::SubagentCompleted).unwrap(),
        json!("subagent_completed")
    );
    assert_eq!(
        serde_json::to_value(OrchestrationAction::SubagentFailed).unwrap(),
        json!("subagent_failed")
    );
}
