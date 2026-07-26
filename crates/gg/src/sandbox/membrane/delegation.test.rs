//! Tests for the delegation family: the five tools whose calls are serviced by the loop's subagent
//! scheduler rather than by a tool implementation.

use serde_json::json;

use super::*;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, membrane, membrane_with};
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
            task: SubagentBrief::Prompt("write the lexer".to_string()),
            slot: Some("subagent".to_string()),
            worktree: Some(true),
        })
        .expect("spawned");
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({
            "prompt": "write the lexer",
            "issueId": null,
            "slot": "subagent",
            "worktree": true,
        }))
    );

    let log = CallLog::default();
    let mut state = membrane(&log);
    let handle = state
        .spawn_subagent(SpawnRequest {
            task: SubagentBrief::Issue("i1".to_string()),
            slot: None,
            worktree: None,
        })
        .expect("spawned");
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({
            "prompt": null,
            "issueId": "i1",
            "slot": null,
            "worktree": null,
        }))
    );
    assert_eq!(handle.id, "agent-1");
    assert_eq!(handle.slot, "primary");
    assert_eq!(handle.model_id, "test/model");
    assert!(handle.worktree_branch.is_none());
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
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::ok("collected", "collected").with_data(
            crate::tools::ToolData::SubagentResults(vec![crate::tools::SubagentResultData {
                id: "agent-9".to_string(),
                status: None,
                summary: String::new(),
            }]),
        )
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

/// **An absent `items` and an empty one are different stages.** Absent means "fan out over the
/// previous stage's results"; empty is an error the loop reports. Lowering both the same way would
/// turn a mistake into a silent second fan-out.
#[test]
fn absent_items_and_empty_items_are_different_workflow_stages() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let report = state
        .run_workflow(vec![
            WorkflowStage {
                name: Some("survey".to_string()),
                prompt: "look at {{item}}".to_string(),
                items: Some(vec!["a.ts".to_string(), "b.ts".to_string()]),
                slot: None,
                worktree: None,
            },
            WorkflowStage {
                name: None,
                prompt: "summarise {{prior}}".to_string(),
                items: None,
                slot: Some("subagent".to_string()),
                worktree: Some(false),
            },
            WorkflowStage {
                name: Some("empty".to_string()),
                prompt: "never runs".to_string(),
                items: Some(Vec::new()),
                slot: None,
                worktree: None,
            },
        ])
        .expect("ran");

    assert_eq!(report.workflow_id, "wf-1");
    assert_eq!(report.stages, 2);
    assert_eq!(report.results, ["first", "second"]);

    let stages = log
        .args("run_workflow")
        .and_then(|args| args.get("stages").cloned())
        .expect("the stages were sent");
    assert_eq!(
        stages,
        json!([
            {
                "name": "survey",
                "prompt": "look at {{item}}",
                "items": ["a.ts", "b.ts"],
                "slot": null,
                "worktree": null,
            },
            {
                "name": null,
                "prompt": "summarise {{prior}}",
                "items": null,
                "slot": "subagent",
                "worktree": false,
            },
            {
                "name": "empty",
                "prompt": "never runs",
                "items": [],
                "slot": null,
                "worktree": null,
            },
        ])
    );
}

/// K is clamped into 2–6 at the membrane, as the loop clamps it: a program that asks for twenty
/// gets six rather than an argument error after it has committed to the call.
#[test]
fn attempts_is_clamped_to_the_two_to_six_range() {
    let cases = [(None, 2), (Some(1), 2), (Some(4), 4), (Some(200), 6)];

    for (requested, expected) in cases {
        let log = CallLog::default();
        let mut state = membrane_with(&log, &all_tools(), None, canned_outcome);
        state
            .speculate(SpeculateRequest {
                task: SubagentBrief::Prompt("try it".to_string()),
                attempts: requested,
                approaches: vec!["be bold".to_string()],
                slots: Vec::new(),
            })
            .expect("speculated");
        assert_eq!(
            log.args("speculate")
                .and_then(|args| args.get("attempts").and_then(serde_json::Value::as_u64)),
            Some(expected),
            "requesting {requested:?} attempts"
        );
    }
}

/// The speculation report names the winner and how many attempts really ran.
#[test]
fn a_speculation_reports_its_winner_and_rationale() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let report = state
        .speculate(SpeculateRequest {
            task: SubagentBrief::Issue("i1".to_string()),
            attempts: Some(2),
            approaches: Vec::new(),
            slots: vec!["subagent".to_string()],
        })
        .expect("speculated");

    assert_eq!(report.winner_id, "agent-2");
    assert_eq!(report.attempts, 2);
    assert_eq!(report.rationale.as_deref(), Some("it was tidier"));
    assert_eq!(
        log.args("speculate"),
        Some(json!({
            "prompt": null,
            "issueId": "i1",
            "attempts": 2,
            "approaches": [],
            "slots": ["subagent"],
        }))
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
