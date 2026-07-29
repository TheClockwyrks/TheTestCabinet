//! Tests for the knowledge families: one round trip per tool, plus the three lowerings that could
//! silently do the wrong thing (the status spelling and the two sentinel-carrying variants).
//!
//! The round trips look repetitive on purpose. Each one asserts the **exact JSON** its typed call
//! produced, which is what makes "every tool is a typed function" a checked property rather than a
//! claim: a renamed key, a lost field, or a camelCase/snake_case slip in either direction fails
//! here rather than in a container at 3am.

use serde_json::json;

use super::super::ErrorCode;
use super::*;
use crate::sandbox::fake::{CallLog, all_tools, membrane, membrane_with};
use crate::tools::{ToolFailure, ToolOutcome};

/// A skill's body is its own result — the one tool whose typed value is the outcome's text.
#[test]
fn read_skill_returns_the_body() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let body = state.read_skill("testing".to_string()).expect("read");

    assert_eq!(body, "the skill body");
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

/// An unknown skill is `not-found`, carrying the catalogue in its message so the next call can name
/// a real one.
#[test]
fn an_unknown_skill_is_not_found() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::failed(
            ToolFailure::NotFound,
            "read_skill: no skill named `nope`; available skills: testing",
        )
    });

    let error = state
        .read_skill("nope".to_string())
        .expect_err("an unknown skill throws");
    assert_eq!(error.code, ErrorCode::NotFound);
    assert!(error.message.contains("available skills"));
}

/// The three memory tools carry their three fields and report both budget axes back.
#[test]
fn the_memory_tools_round_trip_with_both_budget_axes() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let input = MemoryInput {
        name: "layout".to_string(),
        description: "where things live".to_string(),
        body: "src/ holds the engine".to_string(),
    };
    let usage = state.write_memory(input.clone()).expect("wrote");
    assert_eq!(
        (usage.count, usage.max_count),
        (1, Some(8)),
        "the count axis is reported"
    );
    assert_eq!(
        (usage.total_chars, usage.max_total_chars),
        (12, Some(4_000)),
        "the character axis is reported"
    );

    state.update_memory(input).expect("updated");
    state.delete_memory("layout".to_string()).expect("deleted");

    assert_eq!(
        log.names(),
        ["write_memory", "update_memory", "delete_memory"]
    );
    assert_eq!(
        log.args("write_memory"),
        Some(json!({
            "name": "layout",
            "description": "where things live",
            "body": "src/ holds the engine",
        }))
    );
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

/// The five task tools, each under the key names `tasks.rs` declares — including the camelCase
/// `blockedBy` the schema uses and the WIT spells with a hyphen.
#[test]
fn the_task_tools_round_trip_under_the_schemas_key_names() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let usage = state
        .add_task(TaskInput {
            id: "t1".to_string(),
            title: "write the parser".to_string(),
            description: Some("start with the lexer".to_string()),
            blocked_by: vec!["t0".to_string()],
        })
        .expect("added");
    assert_eq!((usage.count, usage.max_tasks), (2, 20));

    state
        .set_blocked_by("t1".to_string(), Vec::new())
        .expect("cleared the blockers");
    state.complete_task("t1".to_string()).expect("completed");
    let usage = state.remove_task("t1".to_string()).expect("removed");
    assert_eq!(usage.count, 2);

    assert_eq!(
        log.names(),
        ["add_task", "set_blocked_by", "complete_task", "remove_task"]
    );
    assert_eq!(
        log.args("add_task"),
        Some(json!({
            "id": "t1",
            "title": "write the parser",
            "description": "start with the lexer",
            "blockedBy": ["t0"],
        }))
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [] })),
        "an empty list must survive as `[]` — it is what clears every blocker"
    );
}

/// WIT identifiers cannot carry an underscore, so `in-progress` crosses the membrane and gg's own
/// `in_progress` reaches the tool. A model must never see that seam.
#[test]
fn in_progress_maps_to_the_stores_underscore_spelling() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .update_task(
            "t1".to_string(),
            TaskPatch {
                title: None,
                description: TextEdit::Keep,
                status: Some(TaskStatus::InProgress),
            },
        )
        .expect("updated");
    assert_eq!(
        log.args("update_task")
            .and_then(|args| args.get("status").cloned()),
        Some(json!("in_progress"))
    );

    // Both directions of the seam: the membrane's WIT status enum lowers onto gg's native status
    // enum, which the typed function takes directly (no schema word between them any more).
    assert!(matches!(
        task_status(TaskStatus::Pending),
        crate::tasks::TaskStatus::Pending
    ));
    assert!(matches!(
        task_status(TaskStatus::Done),
        crate::tasks::TaskStatus::Done
    ));
    assert!(matches!(
        issue_status(IssueStatus::InProgress),
        crate::board::IssueStatus::InProgress
    ));
    assert!(matches!(
        issue_status(IssueStatus::Open),
        crate::board::IssueStatus::Open
    ));
    assert!(matches!(
        issue_status(IssueStatus::Done),
        crate::board::IssueStatus::Done
    ));
}

/// The three-way text edit onto gg's stringly sentinel: `keep` omits the key entirely (the only way
/// the schema says "leave it alone"), `clear` sends the empty string, `set` sends the text.
#[test]
fn a_text_edit_variant_maps_onto_the_schemas_sentinel() {
    let cases = [
        (TextEdit::Keep, None),
        (TextEdit::Clear, Some(json!(""))),
        (
            TextEdit::Set("a new description".to_string()),
            Some(json!("a new description")),
        ),
    ];

    for (edit, expected) in cases {
        let log = CallLog::default();
        let mut state = membrane(&log);
        state
            .update_task(
                "t1".to_string(),
                TaskPatch {
                    title: None,
                    description: edit,
                    status: None,
                },
            )
            .expect("updated");
        let args = log.args("update_task").expect("the call was made");
        assert_eq!(
            args.get("description").cloned(),
            expected,
            "the description sentinel is wrong for {args}"
        );
    }
}

/// The board's seven tools, under the key names `board.rs` declares.
#[test]
fn the_board_tools_round_trip_under_the_schemas_key_names() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let usage = state
        .create_epic(EpicInput {
            id: "e1".to_string(),
            title: "the parser".to_string(),
            description: "everything about parsing".to_string(),
        })
        .expect("created the epic");
    assert_eq!(
        (usage.epics, usage.max_epics, usage.issues, usage.max_issues),
        (1, 4, 3, 20)
    );

    state
        .create_issue(IssueInput {
            id: "i1".to_string(),
            title: "the lexer".to_string(),
            description: None,
            in_scope: "tokens".to_string(),
            out_of_scope: "the AST".to_string(),
            completion_criteria: "every token has a test".to_string(),
            blocked_by: vec!["i0".to_string()],
            epic_id: Some("e1".to_string()),
            agent: "implementer".to_string(),
            reviewers: vec!["critic".to_string()],
        })
        .expect("created the issue");
    state
        .set_issue_blocked_by("i1".to_string(), vec!["i0".to_string()])
        .expect("set the blockers");
    state
        .remove_epic("e1".to_string())
        .expect("removed the epic");
    state
        .remove_issue("i1".to_string())
        .expect("removed the issue");

    assert_eq!(
        log.args("create_issue"),
        Some(json!({
            "id": "i1",
            "title": "the lexer",
            "description": null,
            "inScope": "tokens",
            "outOfScope": "the AST",
            "completionCriteria": "every token has a test",
            "blockedBy": ["i0"],
            "epicId": "e1",
            "agent": "implementer",
            "reviewers": ["critic"],
        }))
    );
    assert_eq!(
        log.names(),
        [
            "create_epic",
            "create_issue",
            "set_issue_blocked_by",
            "remove_epic",
            "remove_issue",
        ]
    );
}

/// The epic assignment is the same three-way idea for an issue's grouping: omit to leave it,
/// empty string to ungroup, an id to re-group.
#[test]
fn an_epic_assignment_maps_onto_the_schemas_sentinel() {
    let cases = [
        (EpicAssignment::Keep, None),
        (EpicAssignment::Ungroup, Some(json!(""))),
        (EpicAssignment::Set("e2".to_string()), Some(json!("e2"))),
    ];

    for (epic, expected) in cases {
        let log = CallLog::default();
        let mut state = membrane(&log);
        state
            .update_issue(
                "i1".to_string(),
                IssuePatch {
                    title: Some("a better title".to_string()),
                    description: TextEdit::Keep,
                    in_scope: None,
                    out_of_scope: None,
                    completion_criteria: None,
                    status: Some(IssueStatus::InProgress),
                    epic,
                },
            )
            .expect("updated");
        let args = log.args("update_issue").expect("the call was made");
        assert_eq!(
            args.get("epicId").cloned(),
            expected,
            "the epic sentinel is wrong for {args}"
        );
        assert_eq!(args.get("status").cloned(), Some(json!("in_progress")));
        assert_eq!(args.get("title").cloned(), Some(json!("a better title")));
    }
}

/// A store refusal keeps its class — a duplicate id is a `conflict`, not a generic failure — which
/// is the whole reason failures are classified where they are raised.
#[test]
fn a_store_refusal_keeps_its_class() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::failed(
            ToolFailure::Conflict,
            "add_task: a task `t1` already exists",
        )
    });

    let error = state
        .add_task(TaskInput {
            id: "t1".to_string(),
            title: "again".to_string(),
            description: None,
            blocked_by: Vec::new(),
        })
        .expect_err("a duplicate id throws");
    assert_eq!(error.code, ErrorCode::Conflict);
    assert_eq!(error.tool, "add_task");
}
