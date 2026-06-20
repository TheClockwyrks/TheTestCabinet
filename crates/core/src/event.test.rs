//! Tests for normalized event translation across harness output formats.

use serde_json::json;

use super::*;
use crate::execution::OutputStream;

/// Ingest a single Codex stdout line and return the events it produced.
fn codex(line: &str) -> Vec<HarnessEvent> {
    EventParser::new(EventFormat::Codex).ingest(OutputStream::Stdout, line)
}

/// Ingest a single Claude stdout line through a fresh parser.
fn claude(line: &str) -> Vec<HarnessEvent> {
    EventParser::new(EventFormat::Claude).ingest(OutputStream::Stdout, line)
}

/// Drive one Claude parser through `lines` in order, returning the events the
/// final line produced. This is how a tool use (recorded silently from an
/// `assistant` event) is paired with the `user` tool-result that resolves it.
fn claude_seq(lines: &[&str]) -> Vec<HarnessEvent> {
    seq_last(EventFormat::Claude, lines)
}

/// Ingest one stdout line through a fresh parser of the given format.
fn single(format: EventFormat, line: &str) -> Vec<HarnessEvent> {
    EventParser::new(format).ingest(OutputStream::Stdout, line)
}

/// Drive one parser through `lines`, returning the events the final line
/// produced — for harnesses that record a tool call on one line and resolve it
/// on a later one.
fn seq_last(format: EventFormat, lines: &[&str]) -> Vec<HarnessEvent> {
    let mut parser = EventParser::new(format);
    let mut events = Vec::new();
    for line in lines {
        events = parser.ingest(OutputStream::Stdout, line);
    }
    events
}

/// Drive one parser through `lines`, returning every event produced across them.
fn parse_all(format: EventFormat, lines: &[&str]) -> Vec<HarnessEvent> {
    let mut parser = EventParser::new(format);
    lines
        .iter()
        .flat_map(|line| parser.ingest(OutputStream::Stdout, line))
        .collect()
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
fn system_events_carry_a_stage_status_and_default_message() {
    // The orchestrator's lifecycle events derive a human readable message from
    // the stage and status, carry no session id, and serialize with the stage
    // and status as snake_case slugs inline.
    let event = HarnessEvent::system(SystemStage::PullImage, SystemStatus::Started);
    assert_eq!(event.session_id, None);
    assert_eq!(
        event.kind,
        EventKind::System {
            stage: SystemStage::PullImage,
            status: SystemStatus::Started,
            message: "Pulling the run-container image".to_string(),
        }
    );
    let value = serde_json::to_value(&event).expect("serialize");
    assert_eq!(value["type"], "system");
    assert_eq!(value["stage"], "pull_image");
    assert_eq!(value["status"], "started");
    assert_eq!(value["message"], "Pulling the run-container image");

    // A failed teardown gets its own message, distinct from the started one.
    let failed = HarnessEvent::system(SystemStage::Teardown, SystemStatus::Failed);
    assert_eq!(
        failed.kind,
        EventKind::System {
            stage: SystemStage::Teardown,
            status: SystemStatus::Failed,
            message: "Failed to tear down the run container".to_string(),
        }
    );
}

#[test]
fn claude_assistant_text_becomes_an_agent_message() {
    let kind = one(claude(
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Let me look at the physics."}]}}"#,
    ));
    assert_eq!(
        kind,
        EventKind::Agent {
            message: "Let me look at the physics.".to_string(),
        }
    );
}

#[test]
fn claude_split_text_blocks_join_into_one_agent_message() {
    let kind = one(claude(
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Part one. "},{"type":"text","text":"Part two."}]}}"#,
    ));
    assert_eq!(
        kind,
        EventKind::Agent {
            message: "Part one. Part two.".to_string(),
        }
    );
}

#[test]
fn claude_thinking_blocks_become_reasoning_events() {
    // A thinking block is the model's reasoning, surfaced as its own event.
    assert_eq!(
        one(claude(
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"}]}}"#,
        )),
        EventKind::Reasoning {
            message: "hmm".to_string(),
        }
    );
    // When thinking precedes visible text in one message, the reasoning is
    // reported ahead of the agent message it leads into.
    let events = claude(
        r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"plan"},{"type":"text","text":"done"}]}}"#,
    );
    assert_eq!(
        events.iter().map(|e| e.kind.clone()).collect::<Vec<_>>(),
        vec![
            EventKind::Reasoning {
                message: "plan".to_string(),
            },
            EventKind::Agent {
                message: "done".to_string(),
            },
        ]
    );
    // A redacted thinking block carries no readable text, so it yields nothing.
    assert!(
        claude(
            r#"{"type":"assistant","message":{"content":[{"type":"redacted_thinking","data":"xx"}]}}"#,
        )
        .is_empty()
    );
}

#[test]
fn claude_init_captures_the_session_id_and_is_consumed() {
    let mut parser = EventParser::new(EventFormat::Claude);
    assert!(
        parser
            .ingest(
                OutputStream::Stdout,
                r#"{"type":"system","subtype":"init","session_id":"sess-1","cwd":"/work"}"#,
            )
            .is_empty()
    );
    let events = parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#,
    );
    assert_eq!(events[0].session_id.as_deref(), Some("sess-1"));
}

#[test]
fn claude_read_tool_use_resolves_on_its_result_with_a_line_range() {
    // Mirrors a real stream: a Read with offset 130 + limit 65 reads through the
    // inclusive line 194 (130 + 65 - 1), reported when the tool-result arrives.
    let kind = one(claude_seq(&[
        r#"{"type":"system","subtype":"init","session_id":"sess-1","cwd":"/work"}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/work/src/physics.ts","limit":65,"offset":130}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"130\t}"}]}}"#,
    ]));
    assert_eq!(
        kind,
        EventKind::Read {
            path: "/work/src/physics.ts".to_string(),
            start_line: Some(130),
            end_line: Some(194),
            is_success: Some(true),
        }
    );
}

#[test]
fn claude_tool_use_is_recorded_without_emitting_an_event() {
    // The tool use is held until its result; the assistant line alone is silent.
    assert!(
        claude(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/work/a.ts"}}]}}"#,
        )
        .is_empty()
    );
}

#[test]
fn claude_write_like_tools_map_to_write_events() {
    for name in ["Write", "Edit", "MultiEdit"] {
        let assistant = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"w","name":"{name}","input":{{"file_path":"/work/index.html","content":"<!DOCTYPE html>"}}}}]}}}}"#,
        );
        let kind = one(claude_seq(&[
            &assistant,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"w","content":"ok"}]}}"#,
        ]));
        assert_eq!(
            kind,
            EventKind::Write {
                path: "/work/index.html".to_string(),
                start_line: None,
                end_line: None,
                is_success: Some(true),
            },
            "{name} should map to a write",
        );
    }
}

#[test]
fn claude_search_and_list_tools_map_to_their_events() {
    let grep = one(claude_seq(&[
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"g","name":"Grep","input":{"pattern":"needle","path":"/work/src"}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"g","content":"3 matches"}]}}"#,
    ]));
    assert_eq!(
        grep,
        EventKind::Search {
            query: "needle".to_string(),
            path: Some("/work/src".to_string()),
            is_success: Some(true),
        }
    );

    let ls = one(claude_seq(&[
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"l","name":"LS","input":{"path":"/work/src"}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"l","content":"a.ts"}]}}"#,
    ]));
    assert_eq!(
        ls,
        EventKind::List {
            path: Some("/work/src".to_string()),
            is_success: Some(true),
        }
    );
}

#[test]
fn claude_bash_is_classified_and_carries_result_success() {
    // A plain command stays a command and a failed result is reflected.
    let plain = one(claude_seq(&[
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"b","name":"Bash","input":{"command":"npm test"}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b","content":"fail","is_error":true}]}}"#,
    ]));
    assert_eq!(
        plain,
        EventKind::Command {
            command: "npm test".to_string(),
            working_directory: None,
            exit_code: None,
            is_success: Some(false),
        }
    );

    // A recognized file-operation command is reclassified, as for Codex.
    let cat = one(claude_seq(&[
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"c","name":"Bash","input":{"command":"cat README.md"}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c","content":"readme"}]}}"#,
    ]));
    assert_eq!(
        cat,
        EventKind::Read {
            path: "README.md".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );
}

#[test]
fn claude_skill_tool_maps_to_a_skill_event() {
    let kind = one(claude_seq(&[
        r#"{"type":"system","subtype":"init","cwd":"/work"}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"s","name":"Skill","input":{"skill":"physics"}}]}}"#,
        r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"s","content":"expanded"}]}}"#,
    ]));
    assert_eq!(
        kind,
        EventKind::Skill {
            path: "/work/skills/physics/SKILL.md".to_string(),
            skill_name: Some("physics".to_string()),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );
}

#[test]
fn claude_structured_output_delivery_produces_no_event() {
    // Both the tool use and its result are plumbing for `--json-schema` output.
    assert!(
        claude_seq(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"o","name":"StructuredOutput","input":{"value":{}}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"o","content":"ok"}]}}"#,
        ])
        .is_empty()
    );
}

#[test]
fn claude_user_prompt_text_carries_no_activity() {
    assert!(
        claude(r#"{"type":"user","message":{"content":[{"type":"text","text":"the prompt"}]}}"#)
            .is_empty()
    );
}

#[test]
fn claude_unrecognized_tool_use_becomes_unknown() {
    // A tool with no normalized mapping (here an MCP tool) is surfaced verbatim
    // rather than dropped, so the stream stays lossless.
    assert!(matches!(
        one(claude(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"m","name":"mcp__server__do","input":{"x":1}}]}}"#,
        )),
        EventKind::Unknown { .. }
    ));
}

#[test]
fn claude_rate_limit_warns_only_when_not_allowed() {
    assert!(
        claude(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#).is_empty()
    );
    assert!(matches!(
        one(claude(
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}"#,
        )),
        EventKind::Warning { .. }
    ));
}

#[test]
fn claude_result_is_consumed_unless_it_reports_an_error() {
    assert!(
        claude(r#"{"type":"result","subtype":"success","result":"done","usage":{}}"#).is_empty()
    );
    assert!(matches!(
        one(claude(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true}"#,
        )),
        EventKind::Error { .. }
    ));
}

#[test]
fn claude_non_json_stdout_is_a_warning() {
    assert!(matches!(
        one(claude("not json at all")),
        EventKind::Warning { .. }
    ));
}

#[test]
fn opencode_text_and_self_contained_tools_classify() {
    assert_eq!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"text","part":{"text":"working"}}"#,
        )),
        EventKind::Agent {
            message: "working".to_string(),
        }
    );

    // A nested tool event with a line range from offset + limit.
    assert_eq!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"tool_use","part":{"tool":"read","state":{"status":"completed","input":{"path":"/work/a.ts","offset":5,"limit":10}}}}"#,
        )),
        EventKind::Read {
            path: "/work/a.ts".to_string(),
            start_line: Some(5),
            end_line: Some(14),
            is_success: Some(true),
        }
    );

    // A flat tool event whose failed status is reflected.
    assert_eq!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"tool_use","tool":"bash","status":"error","input":{"command":"npm test"}}"#,
        )),
        EventKind::Command {
            command: "npm test".to_string(),
            working_directory: None,
            exit_code: None,
            is_success: Some(false),
        }
    );

    assert_eq!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"tool_use","tool":"grep","status":"completed","input":{"pattern":"needle","path":"/work/src"}}"#,
        )),
        EventKind::Search {
            query: "needle".to_string(),
            path: Some("/work/src".to_string()),
            is_success: Some(true),
        }
    );
}

#[test]
fn opencode_steps_reasoning_errors_and_unknowns() {
    assert!(
        single(
            EventFormat::Opencode,
            r#"{"type":"step_finish","tokens":{"input":1}}"#
        )
        .is_empty()
    );
    // A reasoning event carrying text surfaces as a reasoning event.
    assert_eq!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"reasoning","part":{"text":"hmm"}}"#
        )),
        EventKind::Reasoning {
            message: "hmm".to_string(),
        }
    );
    // A reasoning event with no text is consumed.
    assert!(single(EventFormat::Opencode, r#"{"type":"reasoning","part":{}}"#).is_empty());
    assert!(matches!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"error","error":"boom"}"#
        )),
        EventKind::Error { .. }
    ));
    // A tool with no normalized mapping is surfaced verbatim.
    assert!(matches!(
        one(single(
            EventFormat::Opencode,
            r#"{"type":"tool_use","tool":"webfetch","status":"completed","input":{"url":"https://x"}}"#,
        )),
        EventKind::Unknown { .. }
    ));
}

#[test]
fn kilo_captures_session_and_extends_opencode_tools() {
    // Session id from one event applies to later events.
    let events = seq_last(
        EventFormat::Kilo,
        &[
            r#"{"type":"step_start","sessionID":"k-1"}"#,
            r#"{"type":"tool_use","tool":"write","status":"completed","input":{"path":"/work/x.ts"}}"#,
        ],
    );
    assert_eq!(events[0].session_id.as_deref(), Some("k-1"));
    assert_eq!(
        events[0].kind,
        EventKind::Write {
            path: "/work/x.ts".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );

    // A workflow tool that identifies its subagent becomes orchestration.
    assert_eq!(
        one(single(
            EventFormat::Kilo,
            r#"{"type":"tool_use","tool":"task","status":"completed","input":{"name":"reviewer","sessionId":"sub-1"}}"#,
        )),
        EventKind::Orchestration {
            action: OrchestrationAction::SubagentCompleted,
            subagent_id: Some("sub-1".to_string()),
            subagent_name: Some("reviewer".to_string()),
            is_success: Some(true),
        }
    );
}

#[test]
fn pi_messages_and_self_contained_tools_classify() {
    // The session record sets the id; a completed assistant message is agent text.
    let events = seq_last(
        EventFormat::Pi,
        &[
            r#"{"type":"session","id":"pi-1"}"#,
            r#"{"type":"message_end","message":{"role":"assistant","content":"hi there"}}"#,
        ],
    );
    assert_eq!(events[0].session_id.as_deref(), Some("pi-1"));
    assert_eq!(
        events[0].kind,
        EventKind::Agent {
            message: "hi there".to_string(),
        }
    );

    // Array message content joins its text parts.
    assert_eq!(
        one(single(
            EventFormat::Pi,
            r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}"#,
        )),
        EventKind::Agent {
            message: "ab".to_string(),
        }
    );

    // The echoed user message and partial deltas are lifecycle noise.
    assert!(
        single(
            EventFormat::Pi,
            r#"{"type":"message_end","message":{"role":"user","content":"prompt"}}"#
        )
        .is_empty()
    );
    assert!(
        single(
            EventFormat::Pi,
            r#"{"type":"message_update","assistantMessageEvent":{"partial":true}}"#
        )
        .is_empty()
    );

    // A tool's arguments arrive on its start event and its result on the end
    // event; the two are paired by id and classified together.
    assert_eq!(
        one(seq_last(
            EventFormat::Pi,
            &[
                r#"{"type":"tool_execution_start","toolCallId":"c1","toolName":"read","args":{"path":"/work/a.ts"}}"#,
                r#"{"type":"tool_execution_end","toolCallId":"c1","toolName":"read","result":{"content":[]}}"#,
            ],
        )),
        EventKind::Read {
            path: "/work/a.ts".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );

    // Tool names match case-insensitively, and `isError` on the end marks failure.
    assert_eq!(
        one(seq_last(
            EventFormat::Pi,
            &[
                r#"{"type":"tool_execution_start","toolCallId":"c2","toolName":"Bash","args":{"command":"make"}}"#,
                r#"{"type":"tool_execution_end","toolCallId":"c2","toolName":"Bash","isError":true,"result":{"content":[]}}"#,
            ],
        )),
        EventKind::Command {
            command: "make".to_string(),
            working_directory: None,
            exit_code: None,
            is_success: Some(false),
        }
    );

    // The streaming update between start and end is a partial, and an end with no
    // recorded start cannot be classified, so it is surfaced verbatim.
    assert!(
        single(
            EventFormat::Pi,
            r#"{"type":"tool_execution_update","toolCallId":"c2","toolName":"Bash"}"#
        )
        .is_empty()
    );
    assert!(matches!(
        one(single(
            EventFormat::Pi,
            r#"{"type":"tool_execution_end","toolCallId":"x","toolName":"read","result":{"content":[]}}"#,
        )),
        EventKind::Unknown { .. }
    ));
}

#[test]
fn goose_accumulates_assistant_text_and_flushes_at_completion() {
    // Two same-id records — a cumulative restatement — yield one agent message.
    let events = parse_all(
        EventFormat::Goose,
        &[
            r#"{"type":"message","id":"m1","message":{"role":"assistant","content":[{"type":"text","text":"hel"}]}}"#,
            r#"{"type":"message","id":"m1","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}"#,
            r#"{"type":"complete","usage":{}}"#,
        ],
    );
    assert_eq!(
        events,
        vec![HarnessEvent {
            timestamp: events[0].timestamp.clone(),
            session_id: None,
            kind: EventKind::Agent {
                message: "hello".to_string(),
            },
        }]
    );
}

#[test]
fn goose_tool_request_response_pairs_and_consumes_todos() {
    // A developer text-editor view, recorded on the request and resolved on the
    // response, is a read.
    let read = seq_last(
        EventFormat::Goose,
        &[
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolRequest","id":"t1","toolCall":{"status":"success","value":{"name":"developer__text_editor","arguments":{"command":"view","path":"/work/a.ts"}}}}]}}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"toolResponse","id":"t1","toolResult":{"status":"success"}}]}}"#,
        ],
    );
    assert_eq!(
        one(read),
        EventKind::Read {
            path: "/work/a.ts".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );

    // The todo extension only manages internal state, so it produces no event.
    assert!(
        seq_last(
            EventFormat::Goose,
            &[
                r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolRequest","id":"d1","toolCall":{"status":"success","value":{"name":"todo__write","arguments":{}}}}]}}"#,
                r#"{"type":"message","message":{"role":"user","content":[{"type":"toolResponse","id":"d1","toolResult":{"status":"success"}}]}}"#,
            ],
        )
        .is_empty()
    );

    assert!(matches!(
        one(single(
            EventFormat::Goose,
            r#"{"type":"error","error":"explode"}"#
        )),
        EventKind::Error { .. }
    ));
}

#[test]
fn cline_agent_events_text_and_batched_tools() {
    assert_eq!(
        one(single(
            EventFormat::Cline,
            r#"{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"done"}}"#,
        )),
        EventKind::Agent {
            message: "done".to_string(),
        }
    );

    // A batched read tool, recorded on content_start and resolved on content_end,
    // yields one read per file with the output's success.
    let reads = seq_last(
        EventFormat::Cline,
        &[
            r#"{"type":"agent_event","event":{"type":"content_start","contentType":"tool","toolCallId":"c1","toolName":"read_files","input":{"files":["/work/a.ts","/work/b.ts"]}}}"#,
            r#"{"type":"agent_event","event":{"type":"content_end","contentType":"tool","toolCallId":"c1","output":{"success":true}}}"#,
        ],
    );
    let paths: Vec<_> = reads
        .iter()
        .map(|event| match &event.kind {
            EventKind::Read {
                path, is_success, ..
            } => {
                assert_eq!(*is_success, Some(true));
                path.clone()
            }
            other => panic!("expected read, got {other:?}"),
        })
        .collect();
    assert_eq!(paths, vec!["/work/a.ts", "/work/b.ts"]);

    // A batched command tool emits one command per entry, carrying the failure.
    let commands = seq_last(
        EventFormat::Cline,
        &[
            r#"{"type":"agent_event","event":{"type":"content_start","contentType":"tool","toolCallId":"c2","toolName":"run_commands","input":{"commands":["npm i","npm test"]}}}"#,
            r#"{"type":"agent_event","event":{"type":"content_end","contentType":"tool","toolCallId":"c2","output":{"success":false}}}"#,
        ],
    );
    assert!(commands.iter().all(|event| matches!(
        event.kind,
        EventKind::Command {
            is_success: Some(false),
            ..
        }
    )));
    assert_eq!(commands.len(), 2);
}

#[test]
fn cline_captures_session_not_task_id_and_reads_legacy_text() {
    let mut parser = EventParser::new(EventFormat::Cline);
    // A hook event's taskId is the conversation, not the session, so it is not
    // captured as the session id.
    parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"hook_event","taskId":"task-1"}"#,
    );
    let before = parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"x"}}"#,
    );
    assert_eq!(before[0].session_id, None);
    // A real session id is captured and applied to later events.
    parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"run_result","sessionId":"sess-9"}"#,
    );
    let after = parser.ingest(
        OutputStream::Stdout,
        r#"{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"y"}}"#,
    );
    assert_eq!(after[0].session_id.as_deref(), Some("sess-9"));

    // The legacy say/ask stream still surfaces prose as agent messages.
    assert_eq!(
        one(single(
            EventFormat::Cline,
            r#"{"type":"say","say":"text","text":"hi"}"#
        )),
        EventKind::Agent {
            message: "hi".to_string(),
        }
    );
}

#[test]
fn goose_read_image_and_tree_classify() {
    // `read_image` loads an image file, named in `source`, and is a read.
    let read = seq_last(
        EventFormat::Goose,
        &[
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolRequest","id":"i1","toolCall":{"status":"success","value":{"name":"read_image","arguments":{"source":"/work/reference/title.png"}}}}]}}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"toolResponse","id":"i1","toolResult":{"status":"success"}}]}}"#,
        ],
    );
    assert_eq!(
        one(read),
        EventKind::Read {
            path: "/work/reference/title.png".to_string(),
            start_line: None,
            end_line: None,
            is_success: Some(true),
        }
    );

    // `tree` enumerates a directory, so it is a list.
    let tree = seq_last(
        EventFormat::Goose,
        &[
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolRequest","id":"t2","toolCall":{"status":"success","value":{"name":"tree","arguments":{"path":"/work","depth":3}}}}]}}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"toolResponse","id":"t2","toolResult":{"status":"success"}}]}}"#,
        ],
    );
    assert_eq!(
        one(tree),
        EventKind::List {
            path: Some("/work".to_string()),
            is_success: Some(true),
        }
    );
}

#[test]
fn goose_thinking_accumulates_into_reasoning_and_text_flushes_it() {
    // Thinking deltas accumulate into one reasoning event; the visible text that
    // follows flushes the reasoning first, so the two are reported in order.
    let events = parse_all(
        EventFormat::Goose,
        &[
            r#"{"type":"message","id":"m1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let"}]}}"#,
            r#"{"type":"message","id":"m1","message":{"role":"assistant","content":[{"type":"thinking","thinking":" me"}]}}"#,
            r#"{"type":"message","id":"m1","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]}}"#,
            r#"{"type":"complete","usage":{}}"#,
        ],
    );
    assert_eq!(
        events.iter().map(|e| e.kind.clone()).collect::<Vec<_>>(),
        vec![
            EventKind::Reasoning {
                message: "Let me".to_string(),
            },
            EventKind::Agent {
                message: "Done".to_string(),
            },
        ]
    );
}

#[test]
fn kilo_consumes_todo_tools_without_an_unknown() {
    // The todo tool only manages the agent's internal task list, so it produces
    // no event rather than an unknown one.
    assert!(
        single(
            EventFormat::Kilo,
            r#"{"type":"tool_use","tool":"todowrite","status":"completed","part":{"state":{"input":{"todos":[]}}}}"#,
        )
        .is_empty()
    );
}

#[test]
fn pi_thinking_parts_become_reasoning() {
    // A message_end with both a thinking part and a text part reports the
    // reasoning ahead of the agent message.
    let events = single(
        EventFormat::Pi,
        r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"weigh options"},{"type":"text","text":"answer"}]}}"#,
    );
    assert_eq!(
        events.iter().map(|e| e.kind.clone()).collect::<Vec<_>>(),
        vec![
            EventKind::Reasoning {
                message: "weigh options".to_string(),
            },
            EventKind::Agent {
                message: "answer".to_string(),
            },
        ]
    );
}

#[test]
fn cline_reasoning_content_and_legacy_say_become_reasoning() {
    // A reasoning content block is its own stream, kept apart from the message.
    assert_eq!(
        one(single(
            EventFormat::Cline,
            r#"{"type":"agent_event","event":{"type":"content_end","contentType":"reasoning","text":"thinking it through"}}"#,
        )),
        EventKind::Reasoning {
            message: "thinking it through".to_string(),
        }
    );
    // The legacy say stream's reasoning is surfaced the same way.
    assert_eq!(
        one(single(
            EventFormat::Cline,
            r#"{"type":"say","say":"reasoning","text":"hmm"}"#
        )),
        EventKind::Reasoning {
            message: "hmm".to_string(),
        }
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
