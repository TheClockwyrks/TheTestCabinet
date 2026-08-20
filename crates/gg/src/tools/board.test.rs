//! Tests for the board tools: the happy paths, the cycle guard surfaced as a tool error, and
//! argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::board::{BoardCaps, BoardStore, IssuePolicy, IssueStatus};
use crate::tools::ToolFailure;

/// The [`BoardUsageData`] an outcome carries, whether on its own (a removal) or beside the id a
/// creation assigned — or a failure naming what it carried instead.
fn usage(outcome: &ToolOutcome) -> &BoardUsageData {
    match outcome.data.as_ref() {
        Some(ApiData::BoardUsage(data)) => data,
        Some(ApiData::BoardNode(node)) => &node.board,
        other => panic!("expected board usage, got {other:?}"),
    }
}

/// The id a creation reported on its [`BoardNode`](ApiData::BoardNode) sidecar — the one thing its
/// caller could not have known.
fn assigned_id(outcome: &ToolOutcome) -> &str {
    match outcome.data.as_ref() {
        Some(ApiData::BoardNode(node)) => &node.id,
        other => panic!("expected an assigned id, got {other:?}"),
    }
}

/// A shared board store plus a throwaway workspace context.
fn fixture() -> (Arc<Mutex<BoardStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (
        Arc::new(Mutex::new(BoardStore::new(BoardCaps::detached()))),
        ctx,
        dir,
    )
}

/// The **id** of the profile the fixture's filing agent may assign an issue to.
const IMPLEMENTER: &str = "implementer";

/// Its display name. Deliberately unlike its id, so a surface that shows one where the other belongs
/// is visible in the assertion rather than passing on a coincidence.
const IMPLEMENTER_NAME: &str = "The Implementer";

/// The **id** of the profile it may name as a reviewer. Deliberately disjoint from
/// [`IMPLEMENTER`]: the two scopes are governed independently, and a fixture that reused one id
/// could not tell them apart.
const REVIEWER: &str = "critic";

/// The reviewer's display name.
const REVIEWER_NAME: &str = "The Critic";

/// One roster entry: the id a call names the profile by, and the display name a menu reads it as.
fn entry(agent_id: &str, name: &str) -> GgRosterEntry {
    GgRosterEntry {
        agent_id: agent_id.to_string(),
        name: name.to_string(),
        description: String::new(),
    }
}

/// The filing rules the tools are built with: one implementer, one reviewer, reviewers optional.
fn policy() -> IssuePolicy {
    IssuePolicy {
        implementers: vec![entry(IMPLEMENTER, IMPLEMENTER_NAME)],
        reviewers: vec![entry(REVIEWER, REVIEWER_NAME)],
        require_reviewers: false,
    }
}

/// The same, with the reviewers feature switched on.
fn reviewers_required() -> IssuePolicy {
    IssuePolicy {
        require_reviewers: true,
        ..policy()
    }
}

/// The full argument set for a well-formed `create_issue` call titled `title`. There is no id: the
/// board assigns one (`ISSUE-1`, `ISSUE-2`, … for these ungrouped issues).
fn issue_args(title: &str) -> serde_json::Value {
    json!({
        "title": format!("Issue {title}"),
        "inScope": "the in-scope work",
        "outOfScope": "the out-of-scope work",
        "completionCriteria": "the acceptance criteria",
        "agent": "implementer",
    })
}

/// The full argument set for a well-formed `create_epic` call.
fn epic_args(prefix: &str) -> serde_json::Value {
    json!({ "prefix": prefix, "title": "Core", "description": "the loop" })
}

#[tokio::test]
async fn create_epic_and_issue_report_usage() {
    let (store, ctx, _dir) = fixture();
    let epic = CreateEpicTool::new(Arc::clone(&store))
        // A lower-case prefix is upper-cased rather than refused.
        .invoke(epic_args("core"), &ctx)
        .await;
    assert!(epic.ok);
    assert_eq!(assigned_id(&epic), "CORE");
    assert!(
        epic.output.contains("Created epic `CORE`"),
        "{}",
        epic.output
    );
    assert!(
        epic.output.contains("`CORE-1`"),
        "the confirmation says how its issues will be numbered: {}",
        epic.output
    );

    let mut args = issue_args("render");
    args["epicId"] = json!("CORE");
    let issue = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(args, &ctx)
        .await;
    assert!(issue.ok, "{}", issue.output);
    // The id the board assigned is both stated and carried structurally, since the model did not
    // choose it and needs it to reference the issue later.
    assert_eq!(assigned_id(&issue), "CORE-1");
    assert!(
        issue.output.contains("Created issue `CORE-1`"),
        "{}",
        issue.output
    );

    let store = store.lock().unwrap();
    assert_eq!(store.epic_count(), 1);
    assert_eq!(store.issue_count(), 1);
    assert_eq!(store.issues()[0].epic_id(), Some("CORE"));
}

/// A prefix that is not 3-6 letters is refused as an argument error, and the refusal teaches the
/// rule — including what the prefix is *for*, so the retry is a considered one.
#[tokio::test]
async fn create_epic_requires_a_three_to_six_letter_prefix() {
    let (store, ctx, _dir) = fixture();
    let tool = CreateEpicTool::new(Arc::clone(&store));
    for bad in ["ab", "toolongprefix", "au7h", "two words", "core-x", ""] {
        let outcome = tool.invoke(epic_args(bad), &ctx).await;
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "`{bad}` is not a prefix: {}",
            outcome.output
        );
    }
    assert!(
        tool.invoke(epic_args("xy"), &ctx)
            .await
            .output
            .contains("`xy`"),
        "the refusal names the value it rejected"
    );
    assert_eq!(store.lock().unwrap().epic_count(), 0);
}

#[tokio::test]
async fn create_issue_requires_the_structured_fields() {
    let (store, ctx, _dir) = fixture();
    // Missing completionCriteria => argument error from the tool.
    let outcome = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(
            json!({ "title": "t", "inScope": "a", "outOfScope": "b" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("completionCriteria"));
    assert_eq!(store.lock().unwrap().issue_count(), 0);
}

/// An issue may only be assigned to a profile the filing agent could have spawned itself, so one
/// allowlist governs both delegation and issue assignment.
#[tokio::test]
async fn create_issue_only_assigns_to_a_spawnable_agent() {
    let (store, ctx, _dir) = fixture();
    let mut args = issue_args("a");
    args["agent"] = json!("stranger");
    let outcome = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(args, &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("stranger"), "{}", outcome.output);
    // The refusal lists the **ids** that are assignable, since an id is what the retry must pass.
    assert!(
        outcome.output.contains("`implementer`"),
        "{}",
        outcome.output
    );
    assert!(
        !outcome.output.contains(IMPLEMENTER_NAME),
        "a display name is not something the model can pass: {}",
        outcome.output
    );
    assert_eq!(store.lock().unwrap().issue_count(), 0);

    // The same rule covers reviewers.
    let mut args = issue_args("a");
    args["reviewers"] = json!(["stranger"]);
    let outcome = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(args, &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert_eq!(store.lock().unwrap().issue_count(), 0);

    // An assignee is required at all: there is no run-level default to fall back on.
    let mut args = issue_args("a");
    args.as_object_mut().unwrap().remove("agent");
    let outcome = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(args, &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("agent"), "{}", outcome.output);
}

/// Every model-facing surface of `create_issue` is in the **id** vocabulary: the two rosters reach
/// the model as the schema's `enum`s — not as prose, which the system prompt's project-management
/// section already renders — and the confirmation leads with the id the issue was recorded under.
#[tokio::test]
async fn create_issue_offers_ids_and_names_them_in_prose() {
    let (store, ctx, _dir) = fixture();
    let tool = CreateIssueTool::new(Arc::clone(&store), policy());

    let definition = tool.definition();
    assert_eq!(
        definition.parameters["properties"]["agent"]["enum"],
        json!([IMPLEMENTER])
    );
    assert_eq!(
        definition.parameters["properties"]["reviewers"]["items"]["enum"],
        json!([REVIEWER])
    );
    // The roster is enumerated once, in the schema. Re-listing it in the description would be the
    // same names paid for on every request, after the system prompt has already listed them.
    for name in [IMPLEMENTER_NAME, REVIEWER_NAME] {
        assert!(
            !definition.description.contains(name),
            "the description restates the roster: {}",
            definition.description
        );
    }

    let outcome = tool.invoke(issue_args("a"), &ctx).await;
    assert!(outcome.ok, "{}", outcome.output);
    assert!(
        outcome
            .output
            .contains(&format!("assigned to `{IMPLEMENTER}` ({IMPLEMENTER_NAME})")),
        "the id leads, because that is what a later call passes: {}",
        outcome.output
    );
    // What the board stores is the id, which is what dispatch resolves a profile from.
    assert_eq!(store.lock().unwrap().issues()[0].agent(), IMPLEMENTER);
}

/// With the reviewers feature on, an issue cannot be filed without naming at least one — and the
/// ids it does give are recorded on the issue.
#[tokio::test]
async fn the_reviewers_feature_makes_reviewers_mandatory() {
    let (store, ctx, _dir) = fixture();
    let tool = CreateIssueTool::new(Arc::clone(&store), reviewers_required());

    let bare = tool.invoke(issue_args("a"), &ctx).await;
    assert_eq!(bare.failure, Some(ToolFailure::InvalidArgument));
    assert!(bare.output.contains("reviewer"), "{}", bare.output);
    assert_eq!(store.lock().unwrap().issue_count(), 0);
    // The tool tells the model the field is required, and which agents may fill it — both through
    // the schema, which is where a model reads a requirement it must satisfy.
    let definition = tool.definition();
    assert_eq!(
        definition.parameters["properties"]["reviewers"]["items"]["enum"],
        json!([REVIEWER])
    );
    assert_eq!(
        definition.parameters["required"],
        json!([
            "title",
            "inScope",
            "outOfScope",
            "completionCriteria",
            "agent",
            "reviewers"
        ])
    );

    let mut args = issue_args("a");
    args["reviewers"] = json!(["critic"]);
    let reviewed = tool.invoke(args, &ctx).await;
    assert!(reviewed.ok, "{}", reviewed.output);
    let store = store.lock().unwrap();
    assert_eq!(store.issues()[0].agent(), "implementer");
    assert_eq!(store.issues()[0].reviewers(), ["critic".to_string()]);
}

#[tokio::test]
async fn create_issue_with_blocked_by_records_the_edge() {
    let (store, ctx, _dir) = fixture();
    let first = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(issue_args("a"), &ctx)
        .await;
    let blocker = assigned_id(&first).to_string();
    let mut args = issue_args("b");
    args["blockedBy"] = json!([blocker]);
    let outcome = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(args, &ctx)
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert_eq!(store.lock().unwrap().issues()[1].blocked_by(), &[blocker]);
}

#[tokio::test]
async fn set_issue_blocked_by_surfaces_a_cycle_as_a_tool_error_without_mutating() {
    let (store, ctx, _dir) = fixture();
    let create = CreateIssueTool::new(Arc::clone(&store), policy());
    let a = assigned_id(&create.invoke(issue_args("a"), &ctx).await).to_string();
    let b = assigned_id(&create.invoke(issue_args("b"), &ctx).await).to_string();

    // b blocked by a is fine.
    let ok = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": b, "blockedBy": [a] }), &ctx)
        .await;
    assert!(ok.ok);

    // a blocked by b would close a 2-cycle: refused, with guidance, nothing changes.
    let cyclic = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": a, "blockedBy": [b] }), &ctx)
        .await;
    assert!(!cyclic.ok);
    assert!(cyclic.output.contains("cycle"), "{}", cyclic.output);
    assert!(
        store.lock().unwrap().issues()[0].blocked_by().is_empty(),
        "the refused edge left the board unchanged"
    );
}

#[tokio::test]
async fn update_complete_and_remove_flow() {
    let (store, ctx, _dir) = fixture();
    let filed = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(issue_args("a"), &ctx)
        .await;
    let id = assigned_id(&filed).to_string();

    let updated = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": id, "status": "in_progress", "title": "Renamed" }),
            &ctx,
        )
        .await;
    assert!(updated.ok);
    assert_eq!(
        store.lock().unwrap().issues()[0].status(),
        IssueStatus::InProgress
    );

    let removed = RemoveIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": id }), &ctx)
        .await;
    assert!(removed.ok);
    assert_eq!(store.lock().unwrap().issue_count(), 0);
}

#[tokio::test]
async fn unknown_issue_is_a_recoverable_tool_error() {
    let (store, ctx, _dir) = fixture();
    let outcome = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost", "title": "Renamed" }), &ctx)
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("ghost"));
}

// ---------------------------------------------------------------------------
// The structured sidecar and the classified failures
// ---------------------------------------------------------------------------

/// The four tools that change a population report both populations and both caps; a revision
/// reports nothing, because neither changed.
#[tokio::test]
async fn the_board_populations_are_reported_by_the_tools_that_change_them() {
    let (store, ctx, _dir) = fixture();
    let caps = BoardCaps::detached();

    let epic = CreateEpicTool::new(Arc::clone(&store))
        .invoke(epic_args("core"), &ctx)
        .await;
    assert_eq!(
        usage(&epic),
        &BoardUsageData {
            epics: 1,
            max_epics: caps.max_epics as u32,
            issues: 0,
            max_issues: caps.max_issues as u32,
        }
    );

    let issue = CreateIssueTool::new(Arc::clone(&store), policy())
        .invoke(issue_args("a"), &ctx)
        .await;
    assert_eq!(usage(&issue).issues, 1);
    let id = assigned_id(&issue).to_string();

    let revised = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": id, "title": "Renamed" }), &ctx)
        .await;
    assert_eq!(revised.data, None);

    let removed_issue = RemoveIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": id }), &ctx)
        .await;
    assert_eq!(usage(&removed_issue).issues, 0);

    let removed_epic = RemoveEpicTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "CORE" }), &ctx)
        .await;
    assert_eq!(usage(&removed_epic).epics, 0);
}

/// Each way the store can refuse is classified from its own error variant.
#[tokio::test]
async fn each_store_refusal_is_classified_from_its_variant() {
    let (store, ctx, _dir) = fixture();
    let create_issue = CreateIssueTool::new(Arc::clone(&store), policy());

    let a = assigned_id(&create_issue.invoke(issue_args("a"), &ctx).await).to_string();
    let b = assigned_id(&create_issue.invoke(issue_args("b"), &ctx).await).to_string();

    // A taken prefix and a cycle-closing edge are conflicts with the board as it stands. (There is
    // no duplicate *issue*: the board assigns those ids, so a caller cannot collide on one.)
    let duplicate_epic = {
        let epic = epic_args("core");
        CreateEpicTool::new(Arc::clone(&store))
            .invoke(epic.clone(), &ctx)
            .await;
        CreateEpicTool::new(Arc::clone(&store))
            .invoke(epic, &ctx)
            .await
    };
    assert_eq!(duplicate_epic.failure, Some(ToolFailure::Conflict));

    SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": b, "blockedBy": [a.clone()] }), &ctx)
        .await;
    let cycle = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": a.clone(), "blockedBy": [b] }), &ctx)
        .await;
    assert_eq!(cycle.failure, Some(ToolFailure::Conflict));

    // Anything named but absent — issue, epic, or blocker — is not-found.
    let unknown_issue = RemoveIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown_issue.failure, Some(ToolFailure::NotFound));

    let unknown_epic = RemoveEpicTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown_epic.failure, Some(ToolFailure::NotFound));

    let unknown_grouping = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": a.clone(), "epicId": "GHOST" }), &ctx)
        .await;
    assert_eq!(unknown_grouping.failure, Some(ToolFailure::NotFound));

    let unknown_blocker = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": a.clone(), "blockedBy": ["ghost"] }), &ctx)
        .await;
    assert_eq!(unknown_blocker.failure, Some(ToolFailure::NotFound));

    // And everything the caller got wrong about the call itself is one class — including a `prefix`
    // that is not one.
    for outcome in [
        create_issue
            .invoke(json!({ "title": "t", "inScope": "a" }), &ctx)
            .await,
        CreateEpicTool::new(Arc::clone(&store))
            .invoke(epic_args("nope!"), &ctx)
            .await,
        UpdateIssueTool::new(Arc::clone(&store))
            .invoke(json!({ "id": a.clone(), "status": "nope" }), &ctx)
            .await,
        UpdateIssueTool::new(Arc::clone(&store))
            .invoke(json!({ "id": a }), &ctx)
            .await,
        SetIssueBlockedByTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "ISSUE-1", "blockedBy": "b" }), &ctx)
            .await,
    ] {
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{}",
            outcome.output
        );
    }
}

#[test]
fn is_board_tool_covers_every_mutator() {
    for name in [
        "create_epic",
        "create_issue",
        "update_issue",
        "set_issue_blocked_by",
        "remove_epic",
        "remove_issue",
    ] {
        assert!(is_board_tool(name), "`{name}` should be a board tool");
    }
    assert!(!is_board_tool("add_task"));
    assert!(!is_board_tool("write_file"));
}
