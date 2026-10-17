use super::*;
use crate::event::{EventFormat, EventParser};
use crate::execution::OutputStream;
use crate::gg::GgTelemetryEvent;
use serde_json::json;

/// The events a Codex `codex exec --json` stream translates into.
fn codex_events(lines: &[serde_json::Value]) -> Vec<HarnessEvent> {
    let mut parser = EventParser::new(EventFormat::Codex);
    lines
        .iter()
        .flat_map(|line| parser.ingest(OutputStream::Stdout, &line.to_string()))
        .collect()
}

fn completed(item: serde_json::Value) -> serde_json::Value {
    json!({ "type": "item.completed", "item": item })
}

fn command(text: &str) -> serde_json::Value {
    completed(json!({ "type": "command_execution", "command": text, "exit_code": 0 }))
}

#[test]
fn a_codex_run_counts_what_its_commands_and_file_changes_did() {
    let events = codex_events(&[
        json!({ "type": "thread.started", "thread_id": "t-1" }),
        json!({ "type": "item.started", "item": { "type": "command_execution" } }),
        command("cat src/main.rs"),
        command("sed -n '10,20p' src/lib.rs"),
        command("rg TODO src"),
        command("ls src"),
        command("cargo build"),
        completed(json!({
            "type": "file_change",
            "changes": [{ "path": "src/a.rs" }, { "path": "src/b.rs" }],
        })),
        completed(json!({ "type": "agent_message", "text": "done" })),
    ]);
    let tally = codex_tool_calls(&events);
    assert_eq!(
        tally,
        BTreeMap::from([
            ("command".to_string(), 1),
            ("list".to_string(), 1),
            ("read".to_string(), 2),
            ("search".to_string(), 1),
            // One per file the change touched.
            ("write".to_string(), 2),
        ])
    );
}

/// The events gg's bridge records for one telemetry event of `kind`.
fn gg_events(kind: GgTelemetryKind) -> Vec<HarnessEvent> {
    crate::gg_exec::bridge(&GgTelemetryEvent {
        timestamp: "2026-10-17T00:00:00Z".to_string(),
        session_id: Some("sess-1".to_string()),
        agent_id: None,
        parent_agent_id: None,
        issue_id: None,
        kind,
    })
}

#[test]
fn a_gg_run_counts_its_tool_calls_and_program_functions_once_each() {
    let events: Vec<HarnessEvent> = [
        GgTelemetryKind::ToolCall {
            name: "read_file".to_string(),
            args: json!({ "path": "src/main.rs" }),
        },
        GgTelemetryKind::ToolCall {
            name: "shell".to_string(),
            args: json!({ "command": "cargo test" }),
        },
        GgTelemetryKind::ToolCall {
            name: "read_file".to_string(),
            args: json!({ "path": "src/lib.rs" }),
        },
        GgTelemetryKind::ApiCall {
            operation: "files.edit_file".to_string(),
        },
        GgTelemetryKind::ApiResult {
            operation: "files.edit_file".to_string(),
            ok: true,
            failure: None,
        },
        GgTelemetryKind::AssistantMessage {
            text: "done".to_string(),
        },
    ]
    .into_iter()
    .flat_map(gg_events)
    .collect();
    // The bridge records a human-facing Read or Command beside each tool call's
    // carry; only the carry counts, so each call counts once.
    assert_eq!(
        gg_tool_calls(&events),
        BTreeMap::from([
            ("files.edit_file".to_string(), 1),
            ("read_file".to_string(), 2),
            ("shell".to_string(), 1),
        ])
    );
}

#[test]
fn only_codex_and_gg_are_counted_off_their_events() {
    assert!(counted_from_events(HarnessSlug::Codex));
    assert!(counted_from_events(HarnessSlug::Gg));
    assert!(!counted_from_events(HarnessSlug::Claude));
    assert_eq!(tool_calls_from_events(HarnessSlug::Pi, &[]), None);
    assert_eq!(
        tool_calls_from_events(HarnessSlug::Gg, &[]),
        Some(BTreeMap::new())
    );
}
