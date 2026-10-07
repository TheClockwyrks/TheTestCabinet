//! **The knowledge SDK, driven from programs** — `gg.memories`, `gg.tasks` and `gg.board`.
//!
//! The sibling of [`sandbox.workspace.test.rs`](super::workspace_tests), and it answers the same two
//! questions the [crossing table](super::membrane_tests) does not: what a call **hands back**, and
//! what a program reads when it **fails**.
//!
//! These three modules are where the failure classes actually carry information. A memory write can
//! fail four ways, a board call five, and the class is the whole of what tells a program whether to
//! rename, to shorten, to re-read, or to give up — so every `@throws` line has a case here, with a
//! separate case per *cause* where one class has more than one.
//!
//! Every answer comes from [`FakeOperationApi`](crate::sandbox::fake::FakeOperationApi); nothing
//! here reaches a model, a provider or a real store.

use super::*;
use crate::tools::{ApiData, BoardUsageData, MemoryHitData};

/// The compiler's refusal of a program, insisting that it was refused.
///
/// The one case below that never runs is the one the **type checker** answers: an unrecognised task
/// status is not a runtime failure to catch, it is a program that does not compile, and what the
/// model reads is `tsc`'s diagnostic.
fn compile_refusal(outcome: &SandboxOutcome) -> String {
    match &outcome.result {
        Err(error) => error.to_string(),
        Ok(result) => panic!(
            "the compiler accepted the program; it logged {:?} and reported {:?}",
            outcome.logs, result.error
        ),
    }
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

/// **A memory write hands back the budget it just spent**, which is how a program knows whether
/// there is room for the next one.
#[test]
fn a_memory_write_hands_back_the_budget() {
    let (outcome, _) = run(r#"import * as gg from "gg";
const usage = gg.memories.writeMemory({ name: "layout", description: "where things live", body: "the crates are under crates/" });
console.log(JSON.stringify({ count: usage.count, maxCount: usage.maxCount ?? null, totalChars: usage.totalChars, indexChars: usage.indexChars ?? null }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(reported["count"], json!(1));
    assert_eq!(reported["maxCount"], json!(8));
    assert_eq!(reported["totalChars"], json!(12));
    assert_eq!(
        reported["indexChars"],
        json!(null),
        "a run that keeps no index bounds nothing, and absence is not zero: {reported}"
    );
}

/// **A name another memory already holds is a `conflict`.**
#[test]
fn a_duplicate_memory_name_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.writeMemory({ name: "layout", description: "d", body: "b" })"#),
        "write_memory",
        ToolFailure::Conflict,
        "write_memory: a memory named `layout` is already held",
    );

    assert_caught(&outcome, "conflict", "write_memory", "is already held");
}

/// **A body over the run's cap is `limit-exceeded`** — a different cause from the duplicate name,
/// and the one a program answers by writing less rather than by renaming.
#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.memories.writeMemory({ name: "notes", description: "d", body: "b".repeat(10000) })"#,
        ),
        "write_memory",
        ToolFailure::LimitExceeded,
        "write_memory: the body is 10000 chars and 4000 remain of the run's memory budget",
    );

    assert_caught(
        &outcome,
        "limit-exceeded",
        "write_memory",
        "of the run's memory budget",
    );
}

/// **A whole-memory replacement hands back the budget after it**, as a write does.
#[test]
fn a_memory_update_hands_back_the_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const usage = gg.memories.updateMemory({ name: "layout", description: "revised", body: "the crates moved" });
console.log(JSON.stringify({ count: usage.count, totalChars: usage.totalChars, maxTotalChars: usage.maxTotalChars ?? null }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(reported["count"], json!(1));
    assert_eq!(reported["totalChars"], json!(12));
    assert_eq!(reported["maxTotalChars"], json!(4_000));
    assert_eq!(log.names(), ["update_memory"]);
}

/// **Replacing a memory that is not held is `not-found`**, because an update is keyed on the name
/// rather than creating one.
#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.updateMemory({ name: "gone", description: "d", body: "b" })"#),
        "update_memory",
        ToolFailure::NotFound,
        "update_memory: no memory named `gone`",
    );

    assert_caught(&outcome, "not-found", "update_memory", "no memory named");
}

/// **A replacement over the cap is `limit-exceeded`**, even though the memory it replaces fitted.
#[test]
fn a_memory_replacement_over_the_cap_is_limit_exceeded() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.memories.updateMemory({ name: "layout", description: "d", body: "b".repeat(10000) })"#,
        ),
        "update_memory",
        ToolFailure::LimitExceeded,
        "update_memory: the replacement is 10000 chars and 4000 remain of the run's memory budget",
    );

    assert_caught(
        &outcome,
        "limit-exceeded",
        "update_memory",
        "the replacement is 10000 chars",
    );
}

/// **A slug another memory already holds is a `conflict`** on the creating call too.
#[test]
fn a_duplicate_memory_slug_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.createMemory({ name: "layout", description: "d", body: "b" })"#),
        "create_memory",
        ToolFailure::Conflict,
        "create_memory: a memory with the slug `layout` is already held",
    );

    assert_caught(&outcome, "conflict", "create_memory", "already held");
}

/// **A created memory whose contents or index entry breach a limit is `limit-exceeded`.**
#[test]
fn a_created_memory_over_the_cap_is_limit_exceeded() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.memories.createMemory({ name: "notes", description: "d", body: "b".repeat(10000) })"#,
        ),
        "create_memory",
        ToolFailure::LimitExceeded,
        "create_memory: the contents are 10000 chars and the index entry would breach the cap",
    );

    assert_caught(
        &outcome,
        "limit-exceeded",
        "create_memory",
        "would breach the cap",
    );
}

/// **Reading a memory that is not held is `not-found`** — the failure a program hits when a search
/// hit has gone stale.
#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.readMemory("gone")"#),
        "read_memory",
        ToolFailure::NotFound,
        "read_memory: no memory named `gone`",
    );

    assert_caught(&outcome, "not-found", "read_memory", "no memory named");
}

/// **An in-place memory edit returns the budget after it**, so a program editing in a loop can watch
/// the total.
#[test]
fn a_memory_edit_returns_the_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const usage = gg.memories.editMemory({ name: "layout", search: "crates/", replace: "crates/gg/" });
console.log(JSON.stringify({ count: usage.count, totalChars: usage.totalChars }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "count": 1, "totalChars": 12 })
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "crates/", "new_string": "crates/gg/" }))
    );
}

/// **Text that is nowhere in the memory is `not-found`.**
#[test]
fn a_memory_edit_whose_text_is_absent_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.editMemory({ name: "layout", search: "nowhere", replace: "x" })"#),
        "edit_memory",
        ToolFailure::NotFound,
        "edit_memory: `nowhere` does not appear in `layout`",
    );

    assert_caught(&outcome, "not-found", "edit_memory", "does not appear in");
}

/// **Text that appears more than once is a `conflict`**, because the edit is ambiguous.
#[test]
fn a_memory_edit_whose_text_repeats_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.editMemory({ name: "layout", search: "the", replace: "a" })"#),
        "edit_memory",
        ToolFailure::Conflict,
        "edit_memory: `the` is not unique in `layout` (4 occurrences)",
    );

    assert_caught(&outcome, "conflict", "edit_memory", "(4 occurrences)");
}

/// **An edit whose result is too long is `limit-exceeded`**, a third cause on the same call.
#[test]
fn a_memory_edit_that_grows_past_the_cap_is_limit_exceeded() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.memories.editMemory({ name: "layout", search: "x", replace: "y".repeat(10000) })"#,
        ),
        "edit_memory",
        ToolFailure::LimitExceeded,
        "edit_memory: the revision would be 10008 chars and 4000 remain of the run's memory budget",
    );

    assert_caught(
        &outcome,
        "limit-exceeded",
        "edit_memory",
        "the revision would be 10008 chars",
    );
}

/// **An edit that would leave the memory empty is an argument error**, the fourth and last cause the
/// call documents — deleting a memory is `deleteMemory`, not an edit down to nothing.
#[test]
fn a_memory_edit_that_would_empty_it_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.memories.editMemory({ name: "layout", search: "the memory", replace: "" })"#,
        ),
        "edit_memory",
        ToolFailure::InvalidArgument,
        "edit_memory: the edit would leave `layout` empty; use `deleteMemory` to remove it",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "edit_memory",
        "would leave `layout` empty",
    );
}

/// **A search hit reads its own memory**, with the slug already supplied — so the two calls the
/// program composed are a search followed by a read carrying the hit's own name.
#[test]
fn a_search_hit_reads_its_own_memory() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const best = gg.memories.searchMemories(["cargo"])[0];
console.log(JSON.stringify({ name: best.name, contents: best.read() }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "name": "build-commands", "contents": "the memory contents" })
    );
    assert_eq!(log.names(), ["search_memories", "read_memory"]);
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" })),
        "the helper supplies the hit's own slug; nothing in the program repeats it"
    );
}

/// **A search that matched nothing is an empty array, not a failure.**
#[test]
fn a_memory_search_with_nothing_to_match_is_an_empty_list() {
    let (outcome, _) = run_answering(
        r#"import * as gg from "gg";
console.log(JSON.stringify({ hits: gg.memories.searchMemories(["nothing"]).length }));
"#,
        "search_memories",
        ToolOutcome::ok("0 of 1 memories match", "searched memories")
            .with_data(ApiData::MemoryHits(Vec::<MemoryHitData>::new())),
    );

    assert_eq!(logged_json(&outcome), json!({ "hits": 0 }));
}

/// **A search with nothing to look for is an argument error**, which is a different answer from a
/// search that found nothing.
#[test]
fn a_memory_search_of_only_blank_keywords_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.searchMemories(["", "   "])"#),
        "search_memories",
        ToolFailure::InvalidArgument,
        "search_memories: every keyword is empty",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "search_memories",
        "every keyword is empty",
    );
}

/// **A delete hands back the budget that is left**, which is the room the program just freed.
#[test]
fn a_memory_delete_hands_back_the_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const usage = gg.memories.deleteMemory("build-commands");
console.log(JSON.stringify({ count: usage.count, totalChars: usage.totalChars }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "count": 1, "totalChars": 12 })
    );
    assert_eq!(
        log.args("delete_memory"),
        Some(json!({ "name": "build-commands" }))
    );
}

/// **Deleting a memory that is not held is `not-found`.**
#[test]
fn a_delete_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.memories.deleteMemory("gone")"#),
        "delete_memory",
        ToolFailure::NotFound,
        "delete_memory: no memory named `gone`",
    );

    assert_caught(&outcome, "not-found", "delete_memory", "no memory named");
}

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

/// **Adding a task hands back the task budget**, count and ceiling both.
#[test]
fn an_added_task_hands_back_the_task_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const usage = gg.tasks.addTask({ id: "t1", title: "T" });
console.log(JSON.stringify({ count: usage.count, maxTasks: usage.maxTasks }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "count": 2, "maxTasks": 20 }));
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "T", "description": null, "blockedBy": [] }))
    );
}

/// **An id another task already holds is a `conflict` naming the id.**
#[test]
fn a_duplicate_task_id_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.addTask({ id: "t1", title: "T" })"#),
        "add_task",
        ToolFailure::Conflict,
        "add_task: a task with the id `t1` is already on the list",
    );

    assert_caught(&outcome, "conflict", "add_task", "the id `t1`");
}

/// **A blocker that would close a cycle is a `conflict` naming the cycle** — the same class as the
/// duplicate id above, from a wholly different cause, which is why it is its own case.
#[test]
fn a_task_blocker_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.addTask({ id: "t3", title: "T", blockedBy: ["t1"] })"#),
        "add_task",
        ToolFailure::Conflict,
        "add_task: that blocker would close a cycle: t1 -> t2 -> t3 -> t1",
    );

    assert_caught(&outcome, "conflict", "add_task", "t1 -> t2 -> t3 -> t1");
}

/// **A task patch reaches the board and returns nothing**, so the program simply carries on.
#[test]
fn a_task_update_reaches_the_board_and_returns_nothing() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.tasks.updateTask("t1", { status: "in_progress" });
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": "in_progress" })),
        "an omitted title and description leave both alone"
    );
}

/// **Patching a task that is not on the list is `not-found`.**
#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.updateTask("t9", { status: "done" })"#),
        "update_task",
        ToolFailure::NotFound,
        "update_task: no task with the id `t9`",
    );

    assert_caught(&outcome, "not-found", "update_task", "no task with the id");
}

/// **A status the SDK does not declare is refused by the compiler**, a turn earlier than any
/// failure class could answer it.
///
/// `TaskStatus` is a union of three string literals, so `"underway"` is not a value the call accepts
/// and `tsc` says so at the line the model wrote, naming the word it wrote. Only an `as any` escape
/// gets such a program past the checker, and a model writing against the catalogue has no reason to
/// write one.
#[test]
fn an_unrecognised_task_status_is_refused_by_the_compiler() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.tasks.updateTask("t1", { status: "underway" });
"#);

    let refusal = compile_refusal(&outcome);
    for fragment in ["program.ts(2,", "\"underway\"", "not assignable"] {
        assert!(
            refusal.contains(fragment),
            "the compiler's refusal should carry {fragment:?}: {refusal}"
        );
    }
    assert!(
        log.calls().is_empty(),
        "a program that did not compile never ran: {:?}",
        log.names()
    );
}

/// **An empty blocker list clears every blocker**, and the call returns nothing.
#[test]
fn blockers_set_on_a_task_clear_when_the_list_is_empty() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.tasks.setBlockedBy("t1", []);
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [] }))
    );
}

/// **Setting blockers on a task that is not there is `not-found`.**
#[test]
fn setting_blockers_on_a_task_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.setBlockedBy("t9", ["t1"])"#),
        "set_blocked_by",
        ToolFailure::NotFound,
        "set_blocked_by: no task with the id `t9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "set_blocked_by",
        "no task with the id",
    );
}

/// **A blocker edge that would close a cycle is a `conflict`.**
#[test]
fn a_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.setBlockedBy("t1", ["t2"])"#),
        "set_blocked_by",
        ToolFailure::Conflict,
        "set_blocked_by: that edge would close a cycle: t1 -> t2 -> t1",
    );

    assert_caught(&outcome, "conflict", "set_blocked_by", "t1 -> t2 -> t1");
}

/// **Completing a task returns nothing and the program runs on.**
#[test]
fn a_completed_task_returns_nothing_and_the_program_runs_on() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.tasks.completeTask("t1");
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t1" })));
}

/// **Completing a task that is not there is `not-found`.**
#[test]
fn completing_a_task_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.completeTask("t9")"#),
        "complete_task",
        ToolFailure::NotFound,
        "complete_task: no task with the id `t9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "complete_task",
        "no task with the id",
    );
}

/// **Removing a task hands back the task budget**, as adding one does.
#[test]
fn a_removed_task_hands_back_the_task_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const usage = gg.tasks.removeTask("t1");
console.log(JSON.stringify({ count: usage.count, maxTasks: usage.maxTasks }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "count": 2, "maxTasks": 20 }));
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t1" })));
}

/// **Removing a task that is not there is `not-found`.**
#[test]
fn removing_a_task_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.tasks.removeTask("t9")"#),
        "remove_task",
        ToolFailure::NotFound,
        "remove_task: no task with the id `t9`",
    );

    assert_caught(&outcome, "not-found", "remove_task", "no task with the id");
}

// ---------------------------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------------------------

/// **Creating an epic hands back the id the prefix resolved to**, upper-cased by the board rather
/// than by the caller, together with the board budget.
#[test]
fn a_created_epic_hands_back_its_upper_cased_id() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const epic = gg.board.createEpic({ prefix: "auth", title: "Authentication", description: "Sign-in" });
console.log(JSON.stringify({ id: epic.id, epics: epic.board.epics, maxEpics: epic.board.maxEpics, issues: epic.board.issues, maxIssues: epic.board.maxIssues }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(
        reported["id"], "EPIC",
        "the id is the board's answer, upper-cased, not the prefix the program wrote: {reported}"
    );
    assert_eq!(reported["epics"], json!(1));
    assert_eq!(reported["maxEpics"], json!(4));
    assert_eq!(reported["issues"], json!(3));
    assert_eq!(reported["maxIssues"], json!(20));
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "auth", "title": "Authentication", "description": "Sign-in" }))
    );
}

/// **A prefix shorter than three letters is an argument error.**
#[test]
fn an_epic_prefix_that_is_too_short_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.createEpic({ prefix: "au", title: "T", description: "D" })"#),
        "create_epic",
        ToolFailure::InvalidArgument,
        "create_epic: `au` is 2 letters; a prefix is 3 to 6 letters",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "create_epic",
        "`au` is 2 letters",
    );
}

/// **A prefix longer than six letters is an argument error** — the other end of the same bound, and
/// a distinct thing for a model to get wrong.
#[test]
fn an_epic_prefix_that_is_too_long_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.board.createEpic({ prefix: "authentication", title: "T", description: "D" })"#,
        ),
        "create_epic",
        ToolFailure::InvalidArgument,
        "create_epic: `authentication` is 14 letters; a prefix is 3 to 6 letters",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "create_epic",
        "`authentication` is 14 letters",
    );
}

/// **A prefix that is not letters is an argument error**, whatever its length.
#[test]
fn an_epic_prefix_that_is_not_letters_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.createEpic({ prefix: "au7h", title: "T", description: "D" })"#),
        "create_epic",
        ToolFailure::InvalidArgument,
        "create_epic: `au7h` must be letters only",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "create_epic",
        "must be letters only",
    );
}

/// **A prefix another epic already holds is a `conflict`.**
#[test]
fn an_epic_prefix_another_epic_holds_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.createEpic({ prefix: "auth", title: "T", description: "D" })"#),
        "create_epic",
        ToolFailure::Conflict,
        "create_epic: the epic `AUTH` already exists",
    );

    assert_caught(&outcome, "conflict", "create_epic", "already exists");
}

/// **Creating an issue hands back the id the board assigned it** — the caller does not choose it,
/// and keeping it is what makes the issue blockable and waitable.
#[test]
fn a_created_issue_hands_back_the_id_the_board_assigned() {
    let (outcome, _) = run(r#"import * as gg from "gg";
const issue = gg.board.createIssue({ title: "Sign in", inScope: "the form", outOfScope: "the API", completionCriteria: "it signs in", agent: "builder" });
console.log(JSON.stringify({ id: issue.id, issues: issue.board.issues, maxIssues: issue.board.maxIssues }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "id": "EPIC-1", "issues": 3, "maxIssues": 20 })
    );
}

/// **An `agent` this session cannot dispatch to is an argument error naming the agent.**
#[test]
fn an_issue_assigned_to_an_agent_that_cannot_take_it_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.board.createIssue({ title: "T", inScope: "i", outOfScope: "o", completionCriteria: "c", agent: "nobody" })"#,
        ),
        "create_issue",
        ToolFailure::InvalidArgument,
        "create_issue: `nobody` is not an agent this session may spawn",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "create_issue",
        "`nobody` is not an agent",
    );
}

/// **A reviewer this session cannot dispatch to is an argument error naming the reviewer** — the
/// same class as the agent above, from a different field, which a program must tell apart to know
/// which one to fix.
#[test]
fn an_issue_reviewer_that_cannot_take_it_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.board.createIssue({ title: "T", inScope: "i", outOfScope: "o", completionCriteria: "c", agent: "builder", reviewers: ["nobody"] })"#,
        ),
        "create_issue",
        ToolFailure::InvalidArgument,
        "create_issue: the reviewer `nobody` is not an agent this session may spawn",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "create_issue",
        "the reviewer `nobody`",
    );
}

/// **A blocker that would close a cycle is a `conflict`.**
#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(
            r#"gg.board.createIssue({ title: "T", inScope: "i", outOfScope: "o", completionCriteria: "c", agent: "builder", blockedBy: ["EPIC-1"] })"#,
        ),
        "create_issue",
        ToolFailure::Conflict,
        "create_issue: that blocker would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );

    assert_caught(
        &outcome,
        "conflict",
        "create_issue",
        "EPIC-1 -> EPIC-2 -> EPIC-1",
    );
}

/// **A created issue waits on itself through its own handle**, with the minted id already supplied —
/// so the two calls are a creation followed by a wait carrying the id the board assigned.
#[test]
fn a_created_issue_waits_on_itself_through_its_own_handle() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const ack = gg.board.createIssue({ title: "T", inScope: "i", outOfScope: "o", completionCriteria: "c", agent: "builder" }).wait();
console.log(JSON.stringify({ ack }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ack": "wait registered" }));
    assert_eq!(log.names(), ["create_issue", "wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" })),
        "the handle supplies the id the board minted; nothing in the program repeats it"
    );
}

/// **An issue patch reaches the board and the program runs on.**
#[test]
fn an_issue_update_reaches_the_board_and_the_program_runs_on() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.board.updateIssue("EPIC-1", { status: "in_progress", completionCriteria: "it signs in" });
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "EPIC-1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": "it signs in",
            "status": "in_progress",
        }))
    );
}

/// **Patching an issue that is not on the board is `not-found`.**
#[test]
fn an_update_of_an_issue_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.updateIssue("EPIC-9", { status: "done" })"#),
        "update_issue",
        ToolFailure::NotFound,
        "update_issue: no issue with the id `EPIC-9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "update_issue",
        "no issue with the id",
    );
}

/// **An empty blocker list clears every blocker on an issue.**
#[test]
fn blockers_set_on_an_issue_clear_when_the_list_is_empty() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.board.setIssueBlockedBy("EPIC-1", []);
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-1", "blockedBy": [] }))
    );
}

/// **Setting blockers on an issue that is not there is `not-found`.**
#[test]
fn setting_blockers_on_an_issue_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.setIssueBlockedBy("EPIC-9", ["EPIC-1"])"#),
        "set_issue_blocked_by",
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue with the id `EPIC-9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "set_issue_blocked_by",
        "no issue with the id",
    );
}

/// **An issue blocker edge that would close a cycle is a `conflict`.**
#[test]
fn an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.setIssueBlockedBy("EPIC-1", ["EPIC-2"])"#),
        "set_issue_blocked_by",
        ToolFailure::Conflict,
        "set_issue_blocked_by: that edge would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );

    assert_caught(
        &outcome,
        "conflict",
        "set_issue_blocked_by",
        "EPIC-1 -> EPIC-2 -> EPIC-1",
    );
}

/// **Removing an epic hands back the board budget**, which is the whole of what it returns.
#[test]
fn a_removed_epic_hands_back_the_board_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const board = gg.board.removeEpic("EPIC");
console.log(JSON.stringify({ epics: board.epics, maxEpics: board.maxEpics, issues: board.issues, maxIssues: board.maxIssues }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "epics": 1, "maxEpics": 4, "issues": 3, "maxIssues": 20 })
    );
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "EPIC" })));
}

/// **Removing an epic that is not on the board is `not-found`.**
#[test]
fn removing_an_epic_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.removeEpic("NOPE")"#),
        "remove_epic",
        ToolFailure::NotFound,
        "remove_epic: no epic with the id `NOPE`",
    );

    assert_caught(&outcome, "not-found", "remove_epic", "no epic with the id");
}

/// **Removing an epic that still held issues keeps them**, ungrouped — and the unchanged issue count
/// in the returned budget is the only signal the program gets that they survived.
#[test]
fn removing_an_epic_that_still_holds_issues_shows_in_the_budget() {
    let (outcome, _) = run_answering(
        r#"import * as gg from "gg";
const board = gg.board.removeEpic("EPIC");
console.log(JSON.stringify({ epics: board.epics, issues: board.issues }));
"#,
        "remove_epic",
        ToolOutcome::ok("noted", "board").with_data(ApiData::BoardUsage(BoardUsageData {
            epics: 0,
            max_epics: 4,
            issues: 3,
            max_issues: 20,
        })),
    );

    let reported = logged_json(&outcome);
    assert_eq!(reported["epics"], json!(0), "the epic has gone: {reported}");
    assert_eq!(
        reported["issues"],
        json!(3),
        "and its issues did not go with it: {reported}"
    );
}

/// **Removing an issue hands back the board budget.**
#[test]
fn a_removed_issue_hands_back_the_board_budget() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const board = gg.board.removeIssue("EPIC-1");
console.log(JSON.stringify({ epics: board.epics, issues: board.issues, maxIssues: board.maxIssues }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "epics": 1, "issues": 3, "maxIssues": 20 })
    );
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "EPIC-1" })));
}

/// **Removing an issue that is not on the board is `not-found`.**
#[test]
fn removing_an_issue_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.removeIssue("EPIC-9")"#),
        "remove_issue",
        ToolFailure::NotFound,
        "remove_issue: no issue with the id `EPIC-9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "remove_issue",
        "no issue with the id",
    );
}

/// **A wait is registered rather than served**, so the rest of the program still runs: the
/// acknowledgement comes straight back and the two calls after it reach dispatch.
#[test]
fn a_registered_wait_lets_the_rest_of_the_program_run() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const ack = gg.board.waitForIssue("EPIC-1");
gg.tasks.completeTask("t1");
const board = gg.board.removeIssue("EPIC-2");
console.log(JSON.stringify({ ack, issues: board.issues }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "ack": "wait registered", "issues": 3 })
    );
    assert_eq!(
        log.names(),
        ["wait_for_issue", "complete_task", "remove_issue"],
        "nothing blocked inside the program: both calls after the wait reached dispatch"
    );
}

/// **Waiting on an issue the board does not hold is `not-found`.**
#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.waitForIssue("EPIC-9")"#),
        "wait_for_issue",
        ToolFailure::NotFound,
        "wait_for_issue: no issue with the id `EPIC-9`",
    );

    assert_caught(
        &outcome,
        "not-found",
        "wait_for_issue",
        "no issue with the id",
    );
}

/// **Waiting on this session's own issue is an argument error**, since it would never be served.
#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.board.waitForIssue("EPIC-1")"#),
        "wait_for_issue",
        ToolFailure::InvalidArgument,
        "wait_for_issue: `EPIC-1` is the issue this session was assigned",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "wait_for_issue",
        "is the issue this session was assigned",
    );
}
