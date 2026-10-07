//! Tests for the delegation family: the five operations whose calls are serviced by the loop's subagent
//! scheduler rather than by a tool implementation.

use serde_json::json;
use test_cabinet_core::gg::ROOT_AGENT;

use super::*;
use crate::sandbox::fake::{CallLog, all_operations, membrane, membrane_with};
use crate::tools::ToolOutcome;

/// A brief is exactly one of a prompt or an issue — the variant makes "neither" unrepresentable,
/// where today's JSON schema declares both optional and rejects the empty case only at run time,
/// after the model has already spent a call on it.
#[test]
fn a_subagent_brief_is_exactly_one_of_prompt_or_issue() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .spawn_subagent(SpawnRequest {
            agent: "subagent".to_string(),
            task: SubagentBrief::Prompt("write the lexer".to_string()),
        })
        .expect("spawned");
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({
            "agent": "subagent",
            "prompt": "write the lexer",
            "issueId": null,
        }))
    );

    let log = CallLog::default();
    let mut state = membrane(&log);
    let handle = state
        .spawn_subagent(SpawnRequest {
            agent: ROOT_AGENT.to_string(),
            task: SubagentBrief::Issue("i1".to_string()),
        })
        .expect("spawned");
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({
            "agent": ROOT_AGENT,
            "prompt": null,
            "issueId": "i1",
        }))
    );
    assert_eq!(handle.id, "agent-1");
    assert_eq!(handle.slot, "primary");
    assert_eq!(handle.model_id, "test/model");
}

/// Collected results carry how each child finished as a **value**, so a program can count the ones
/// that actually completed instead of matching on a paragraph.
#[test]
fn wait_for_subagents_returns_typed_statuses() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let results = state
        .wait_for_subagents(Some(vec!["agent-1".to_string()]))
        .expect("collected");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, "agent-1");
    assert_eq!(results[0].status, Some(AgentStatus::Completed));
    assert_eq!(results[0].summary, "did the work");
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

/// Waiting for *every* outstanding child is the absent-ids case, and the loop reads an absent list
/// as "all of them".
#[test]
fn waiting_for_every_child_sends_no_ids() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.wait_for_subagents(None).expect("collected");

    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

/// A child that produced no recognisable ending reports no status rather than a plausible-looking
/// wrong one — a caller told `None` reads the summary; one told `Completed` does not.
#[test]
fn a_child_with_no_ending_reports_no_status() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_operations(), None, |_, _| {
        ToolOutcome::ok("collected", "collected").with_data(crate::tools::ApiData::SubagentResults(
            vec![crate::tools::SubagentResultData {
                id: "agent-9".to_string(),
                status: None,
                summary: String::new(),
            }],
        ))
    });

    let results = state.wait_for_subagents(None).expect("collected");
    assert!(results[0].status.is_none());
}

/// A message is delivered by id, under the schema's camelCase key.
#[test]
fn send_message_carries_the_agent_id_and_text() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .send_message(
            "agent-1".to_string(),
            "prefer the simpler parser".to_string(),
        )
        .expect("delivered");

    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

/// Every ending gg records has a membrane spelling; the conversion is exhaustive, so a new one
/// cannot be silently dropped.
#[test]
fn every_agent_ending_crosses_the_membrane() {
    assert_eq!(status(AgentStatusData::Completed), AgentStatus::Completed);
    assert_eq!(status(AgentStatusData::Exhausted), AgentStatus::Exhausted);
    assert_eq!(status(AgentStatusData::TimedOut), AgentStatus::TimedOut);
    assert_eq!(status(AgentStatusData::ModelError), AgentStatus::ModelError);
    assert_eq!(status(AgentStatusData::AuthError), AgentStatus::AuthError);
}
