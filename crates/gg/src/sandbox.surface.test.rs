//! **The session-side surface, driven from TypeScript programs** — `context`, `delegation`,
//! `programs`, `docs`, `views` and `session`, plus the `feedback` channel underneath them.
//!
//! These six modules are the half of gg's responses-as-code surface that **no gg tool backs**: a
//! `views.close` is not a tool call, a `session.approve` is not a tool call, and the four that do
//! reach a tool (`context`, `delegation`) reach one the loop services rather than one a workspace
//! answers. So what an arm gets right or wrong about them is invisible from the crossing table and
//! invisible from the host-side membrane tests, and the only way to see it is to write the program
//! a model would write and read what came back.
//!
//! One short function per case, named as the sentence it proves — see
//! [the module header](super) for why a name is worth a component compile.
//!
//! # The two shapes, stated once
//!
//! A **successful** call asserts the post-call state: the arguments the membrane composed
//! ([`CallLog::args`]), the operations the model reached for ([`ApiLog::operations`]), the value the
//! program logged ([`logged_json`]), and the view, ending or hand-over the outcome carries.
//!
//! A **refusal** is caught in the program and logged as `{ operation, code, message }` off
//! `gg.core.ApiError` — [`catching`] writes that program and [`assert_caught`] reads it. A refusal
//! raised host-side carries the operation's own segment (`evict_file_view`, `open_text`); one
//! raised by the SDK before the crossing carries the SDK function's name (`openDocsView`,
//! `spawnSubagent`), because nothing has crossed yet for gg to have an operation for.
//!
//! **Nothing here reaches a model or a provider.** Every failure is synthesized: a tool-backed one
//! by a responder that answers that call with that class, an api-raised one by the
//! [double](crate::sandbox::fake::FakeOperationApi)'s own guards, and `archive_thread`'s by handing
//! the arguments to gg's own [guard](crate::tools::ArchiveThreadTool::archive) so the sentence under
//! test is production's rather than one this file wrote.

use std::time::Instant;

use super::*;
use crate::context::SEARCH_RESULTS_VIEW;
use crate::sandbox::fake::ApiLog;
use crate::sandbox::membrane::capture::{MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::operations::{DELEGATION_TRANSITION_STATE, DOCS_CLOSE, DOCS_CLOSE_ALL};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveSearchData, FileTextData, MAX_ARCHIVE_RANGES,
    SubagentResultData,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Run `program` in the scope its four arguments name, and hand back the [api log](ApiLog) beside
/// the outcome.
///
/// The log has to be taken **before** the api is moved into the store, which is the whole reason
/// this exists rather than a call to one of the four helpers above: those return what a tool saw,
/// and half the calls in this file reach no tool at all.
fn evaluate(
    program: &str,
    capabilities: &[String],
    operations: &[OperationId],
    ending: RunEnding,
    deadline: Option<Instant>,
    api: FakeOperationApi,
) -> (SandboxOutcome, ApiLog) {
    let api_log = api.api_log();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            capabilities,
            operations,
            modules: &[],
            ending,
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        deadline,
        api,
    );
    (outcome, api_log)
}

/// Every capability a maximal agent holds **except** the program library, which is what
/// [`run`](super::run) grants and therefore what a case comparing itself to one has to grant too.
fn capabilities_without_the_library() -> Vec<String> {
    all_capabilities()
        .into_iter()
        .filter(|id| id != CAPABILITY_PROGRAM_LIBRARY)
        .collect()
}

/// [`run`](super::run), keeping the api log as well as the call log — for a case whose subject is
/// which **operations** the model reached for rather than which tools ran.
fn watched(program: &str) -> (SandboxOutcome, CallLog, ApiLog) {
    let log = CallLog::default();
    let (outcome, api_log) = evaluate(
        program,
        &capabilities_without_the_library(),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        None,
        FakeOperationApi::new(&log),
    );
    (outcome, log, api_log)
}

/// [`run`](super::run) under a wall-clock budget that is **already spent** — the one axis
/// [`run_with`](super::run_with) does not vary, and the axis two calls on this surface are
/// deliberately exempt from.
fn run_spent(program: &str) -> SandboxOutcome {
    let log = CallLog::default();
    evaluate(
        program,
        &capabilities_without_the_library(),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        Some(Instant::now() - Duration::from_secs(60)),
        FakeOperationApi::new(&log),
    )
    .0
}

/// [`all_operations`] less the one `withheld` names — the allowlist of an agent granted everything
/// but that call, which is the only way to withhold one of two operations that share a capability.
fn all_operations_but(withheld: OperationId) -> Vec<OperationId> {
    all_operations()
        .into_iter()
        .filter(|id| *id != withheld)
        .collect()
}

/// A responder handing `archive_thread`'s arguments to **gg's own guard** and answering everything
/// else from the canned table.
///
/// The refusals under test are therefore [`ArchiveThreadTool::archive`](crate::tools::ArchiveThreadTool)'s
/// production sentences rather than ones this file wrote, which is what makes an assertion on the
/// wording worth making. A *successful* archive is deliberately not driven through it — the guard
/// only validates, and the `ApiData::Reclaim` a program reads back is attached by the loop — so the
/// case that reads a report back uses the canned answer instead.
fn archiving(name: &str, args: &Value) -> ToolOutcome {
    if name != "archive_thread" {
        return canned_outcome(name, args);
    }
    let ranges = args["ranges"]
        .as_array()
        .map(|pairs| {
            pairs
                .iter()
                .map(|pair| crate::context::TurnRange {
                    from: pair[0].as_u64().unwrap_or_default(),
                    to: pair[1].as_u64().unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    crate::tools::ArchiveThreadTool.archive(ranges)
}

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

/// The path crosses under its own key, and the report the loop attached comes back as data the
/// program can read field by field.
#[test]
fn a_file_view_is_evicted_by_its_path() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const freed = gg.context.evictFileView(\"src/a.ts\");\n",
        "console.log(JSON.stringify({ items: freed.items, tokens: freed.reclaimedTokens,\n",
        "  paths: freed.paths, detail: freed.detail }));\n",
    ));
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.ts" }))
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "items": 2, "tokens": 300, "paths": ["src/a.ts"], "detail": "dropped 2 items" })
    );
}

/// Omitting the path is how a program drops **every** file view, so it lowers an absent path rather
/// than an empty one — which is the value the SDK documents as refused.
#[test]
fn evicting_every_file_view_sends_no_path() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.context.evictFileView().items));\n",
    ));
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
    assert_eq!(logged_json(&outcome), json!(2));
}

#[test]
fn an_empty_path_is_refused_on_an_eviction() {
    let (outcome, _) = run_failing(
        &catching("gg.context.evictFileView(\"\")"),
        "evict_file_view",
        ToolFailure::InvalidArgument,
        "`evict_file_view`: `path` must not be empty; omit it to drop every file view",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "evict_file_view",
        "omit it to drop every file view",
    );
}

/// Each span lowers onto a **two-element array**, which is the shape gg's own schema declares — and
/// the api record carries the same two numbers *named*, which is the only place the order of a span
/// can be checked at all.
#[test]
fn two_spans_are_archived_as_pairs() {
    let log = CallLog::default();
    let (outcome, api_log) = evaluate(
        concat!(
            "import * as gg from \"gg\";\n",
            "const freed = gg.context.archiveThread([{ from: 4, to: 19 }, { from: 22, to: 25 }]);\n",
            "console.log(JSON.stringify(freed.items));\n",
        ),
        &capabilities_without_the_library(),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        None,
        FakeOperationApi::new(&log),
    );
    assert_eq!(logged_json(&outcome), json!(2));
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19], [22, 25]] }))
    );
    assert_eq!(
        api_log.args("context.archive_thread"),
        Some(json!({ "ranges": [{ "from": 4, "to": 19 }, { "from": 22, "to": 25 }] })),
        "and each end arrived under the name the model wrote it with"
    );
}

/// An empty list is a real program a model writes — a filter that matched nothing — and gg refuses
/// it rather than archiving nothing and reporting success.
#[test]
fn an_empty_span_list_is_refused() {
    let (outcome, log) = run_with(
        &catching("gg.context.archiveThread([])"),
        &all_operations(),
        SandboxLimits::AMPLE,
        archiving,
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "archive_thread",
        "between 1 and 32 inclusive turn ranges",
    );
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [] })),
        "the empty list crossed, so what gg refused is what the program wrote"
    );
}

#[test]
fn more_than_thirty_two_spans_are_refused() {
    let spans: Vec<String> = (0..=MAX_ARCHIVE_RANGES)
        .map(|turn| format!("{{ from: {turn}, to: {turn} }}"))
        .collect();
    let (outcome, log) = run_with(
        &catching(&format!("gg.context.archiveThread([{}])", spans.join(", "))),
        &all_operations(),
        SandboxLimits::AMPLE,
        archiving,
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "archive_thread",
        "between 1 and 32 inclusive turn ranges",
    );
    assert_eq!(
        log.args("archive_thread")
            .and_then(|args| args["ranges"].as_array().map(Vec::len)),
        Some(MAX_ARCHIVE_RANGES + 1),
        "the whole list crossed as one call"
    );
}

/// The refusal **names the span**, which is what makes it a statement about the program rather than
/// about the lowering: a pair whose ends were swapped on the way across would read the same.
#[test]
fn a_span_that_ends_before_it_starts_is_refused() {
    let (outcome, log) = run_with(
        &catching("gg.context.archiveThread([{ from: 19, to: 4 }])"),
        &all_operations(),
        SandboxLimits::AMPLE,
        archiving,
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "archive_thread",
        "the range [19, 4] ends before it starts",
    );
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_search_hands_a_program_its_hits() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const found = gg.context.searchArchive(\"the parser\");\n",
        "console.log(JSON.stringify({ empty: found.archiveEmpty, hits: found.hits.length,\n",
        "  seq: found.hits[0].seq, role: found.hits[0].role, text: found.hits[0].text }));\n",
    ));
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
    assert_eq!(
        logged_json(&outcome),
        json!({
            "empty": false,
            "hits": 1,
            "seq": 3,
            "role": "assistant",
            "text": "the earlier answer",
        })
    );
}

#[test]
fn an_archive_search_that_matches_nothing_is_an_empty_hit_list() {
    let (outcome, _) = run_answering(
        concat!(
            "import * as gg from \"gg\";\n",
            "const found = gg.context.searchArchive(\"nothing at all\");\n",
            "console.log(JSON.stringify({ empty: found.archiveEmpty, hits: found.hits.length }));\n",
        ),
        "search_archive",
        ToolOutcome::ok("no hits", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: false,
                hits: Vec::new(),
            },
        )),
    );
    assert_eq!(logged_json(&outcome), json!({ "empty": false, "hits": 0 }));
}

/// The reason the envelope carries a flag at all: a program told only "no hits" would archive its
/// thread a second time believing the first had failed.
#[test]
fn an_empty_archive_is_not_a_search_that_missed() {
    let (outcome, _) = run_answering(
        concat!(
            "import * as gg from \"gg\";\n",
            "const found = gg.context.searchArchive(\"the parser\");\n",
            "console.log(JSON.stringify({ empty: found.archiveEmpty, hits: found.hits.length }));\n",
        ),
        "search_archive",
        ToolOutcome::ok("nothing archived", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            },
        )),
    );
    assert_eq!(logged_json(&outcome), json!({ "empty": true, "hits": 0 }));
}

#[test]
fn an_empty_archive_query_is_refused() {
    let (outcome, _) = run_failing(
        &catching("gg.context.searchArchive(\"\")"),
        "search_archive",
        ToolFailure::InvalidArgument,
        "`search_archive`: `query` must not be empty",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "search_archive",
        "`query` must not be empty",
    );
}

#[test]
fn a_blank_compaction_summary_is_refused() {
    let (outcome, _) = run_failing(
        &catching("gg.context.compact(\"   \")"),
        "compact",
        ToolFailure::InvalidArgument,
        "`compact`: `summary` must be a non-empty string",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "compact",
        "`summary` must be a non-empty string",
    );
}

// ---------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------

#[test]
fn a_child_is_spawned_on_a_prompt() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const child = gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \"write the lexer\" });\n",
        "console.log(JSON.stringify({ id: child.id, slot: child.slot, model: child.modelId }));\n",
    ));
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }))
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "id": "agent-1", "slot": "primary", "model": "test/model" })
    );
}

/// The other arm of the brief: an issue id crosses under its **own** key and the prompt is absent,
/// rather than both being optional strings a program could fill in together.
#[test]
fn a_child_is_spawned_on_a_board_issue() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(gg.delegation.spawnSubagent({ agent: \"subagent\", issueId: \"EPIC-1\" }).id);\n",
    ));
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "EPIC-1" }))
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
}

/// A brief carrying both can only arrive through `any`, and it is refused rather than lowered as
/// either half — a brief is never both, so guessing which one the program meant would send a child
/// off on work nobody asked for.
#[test]
fn a_brief_carrying_both_a_prompt_and_an_issue_is_refused() {
    let (outcome, log) = run(&catching(
        "gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \"write the lexer\", issueId: \"EPIC-1\" } as any)",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "spawnSubagent",
        "expected exactly one of `prompt` or `issueId`",
    );
    assert!(log.names().is_empty(), "nothing crossed: {:?}", log.names());
}

/// **Refused by the SDK, before the crossing** — so the failure names the SDK function rather than
/// an operation, because nothing crossed for gg to have an operation for. The native JSON schema
/// declares both fields optional and rejects "neither" only at dispatch, which is the wasted call
/// this guard exists to save.
#[test]
fn a_brief_that_is_neither_a_prompt_nor_an_issue_is_refused() {
    let (outcome, log) = run(&catching(
        "gg.delegation.spawnSubagent({ agent: \"subagent\" } as any)",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "spawnSubagent",
        "expected exactly one of `prompt` or `issueId`",
    );
    assert!(log.names().is_empty(), "nothing crossed: {:?}", log.names());
}

#[test]
fn an_agent_this_session_may_not_spawn_is_refused() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.spawnSubagent({ agent: \"nope\", prompt: \"write it\" })"),
        "spawn_subagent",
        ToolFailure::InvalidArgument,
        "`spawn_subagent`: this session may not spawn `nope`; agents it may spawn: subagent",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "spawn_subagent",
        "agents it may spawn: subagent",
    );
}

#[test]
fn the_delegation_depth_cap_refuses_a_spawn() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \"write it\" })"),
        "spawn_subagent",
        ToolFailure::LimitExceeded,
        "`spawn_subagent`: this run's delegation depth cap of 2 is already reached",
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "spawn_subagent",
        "delegation depth cap",
    );
}

#[test]
fn named_children_are_waited_for_in_dispatch_order() {
    let (outcome, log) = run_answering(
        concat!(
            "import * as gg from \"gg\";\n",
            "const results = gg.delegation.waitForSubagents([\"agent-1\", \"agent-2\"]);\n",
            "console.log(JSON.stringify(results.map((r) => [r.id, r.status, r.summary])));\n",
        ),
        "wait_for_subagents",
        ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
            SubagentResultData {
                id: "agent-1".to_string(),
                status: Some(AgentStatusData::Completed),
                summary: "wrote the lexer".to_string(),
            },
            SubagentResultData {
                id: "agent-2".to_string(),
                status: Some(AgentStatusData::Exhausted),
                summary: "ran out of turns".to_string(),
            },
        ])),
    );
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1", "agent-2"] }))
    );
    assert_eq!(
        logged_json(&outcome),
        json!([
            ["agent-1", "completed", "wrote the lexer"],
            ["agent-2", "exhausted", "ran out of turns"],
        ])
    );
}

/// Naming no child waits for **every** outstanding one, and says so with an absent list rather than
/// an empty one — an empty list would ask gg to wait for exactly nothing.
#[test]
fn waiting_for_every_child_sends_no_ids() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.delegation.waitForSubagents().length));\n",
    ));
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
    assert_eq!(logged_json(&outcome), json!(1));
}

/// **Every ending, in one program.** WIT identifiers carry no underscore, so the membrane says
/// `timed-out` where everything else gg reports says `timed_out` — and a literal that does not match
/// is not an error, it is a branch that quietly never runs. The only way to see a word this arm
/// failed to translate is to drive one child per ending at once.
#[test]
fn every_agent_ending_reaches_the_program_in_ggs_spelling() {
    let endings = [
        (AgentStatusData::Completed, "completed"),
        (AgentStatusData::Exhausted, "exhausted"),
        (AgentStatusData::TimedOut, "timed-out"),
        (AgentStatusData::ModelError, "model-error"),
        (AgentStatusData::AuthError, "auth-error"),
        (AgentStatusData::LimitExceeded, "limit-exceeded"),
    ];
    let (outcome, _) = run_answering(
        concat!(
            "import * as gg from \"gg\";\n",
            "console.log(JSON.stringify(gg.delegation.waitForSubagents().map((r) => r.status)));\n",
        ),
        "wait_for_subagents",
        ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(
            endings
                .iter()
                .map(|(status, id)| SubagentResultData {
                    id: (*id).to_string(),
                    status: Some(*status),
                    summary: "did the work".to_string(),
                })
                .collect(),
        )),
    );
    assert_eq!(
        logged_json(&outcome),
        json!([
            "completed",
            "exhausted",
            "timed_out",
            "model_error",
            "auth_error",
            "limit_exceeded",
        ])
    );
}

/// A child stopped by a gg defect produced no ending at all, and reports **none** — `undefined`
/// rather than a word the program would branch on and be wrong about.
#[test]
fn a_child_with_no_ending_reports_no_status() {
    let (outcome, _) = run_answering(
        concat!(
            "import * as gg from \"gg\";\n",
            "const first = gg.delegation.waitForSubagents()[0];\n",
            "console.log(JSON.stringify({ known: first.status !== undefined,\n",
            "  read: first.status === undefined ? \"no ending\" : first.status,\n",
            "  summary: first.summary }));\n",
        ),
        "wait_for_subagents",
        ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
            SubagentResultData {
                id: "agent-9".to_string(),
                status: None,
                summary: "it said this much".to_string(),
            },
        ])),
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "known": false, "read": "no ending", "summary": "it said this much" })
    );
}

#[test]
fn waiting_on_an_unknown_child_is_not_found() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.waitForSubagents([\"agent-9\"])"),
        "wait_for_subagents",
        ToolFailure::NotFound,
        "`wait_for_subagents`: no child agent `agent-9`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "wait_for_subagents",
        "no child agent `agent-9`",
    );
}

#[test]
fn an_unknown_agent_id_is_not_found_on_a_message() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.sendMessage(\"agent-9\", \"prefer the simpler parser\")"),
        "send_message",
        ToolFailure::NotFound,
        "`send_message`: no agent `agent-9`",
    );
    assert_caught(&outcome, "not-found", "send_message", "no agent `agent-9`");
}

#[test]
fn messaging_a_child_that_has_returned_is_a_conflict() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.sendMessage(\"agent-1\", \"prefer the simpler parser\")"),
        "send_message",
        ToolFailure::Conflict,
        "`send_message`: `agent-1` has already returned",
    );
    assert_caught(
        &outcome,
        "conflict",
        "send_message",
        "`agent-1` has already returned",
    );
}

/// A transition is **registered**, not performed: replacing the agent — and the very window the
/// program is composing into — mid-execution would pull every remaining call out from under it.
#[test]
fn a_state_transition_is_declared_and_the_program_runs_on() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.delegation.transitionState(\"review\", \"the parser is done\");\n",
        "console.log(\"ran on\");\n",
    ));
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "review", "note": "the parser is done" }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_refused() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.transitionState(\"nowhere\")"),
        "transition_state",
        ToolFailure::InvalidArgument,
        "`transition_state`: `review` is the only state this one has an edge to",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "transition_state",
        "the only state this one has an edge to",
    );
}

/// **The first declaration stands.** A silently replaced succession would be a change the model
/// cannot see, so the second is refused and the first is the one gg kept.
#[test]
fn a_second_state_declaration_in_one_turn_is_refused() {
    let mut declared = false;
    let (outcome, log) = run_with(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.delegation.transitionState(\"review\");\n",
            "try { gg.delegation.transitionState(\"verify\"); }\n",
            "catch (e) { const f = e as gg.core.ApiError;\n",
            "  console.log(JSON.stringify({ code: f.code, operation: f.operation })); }\n",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
        move |name: &str, args: &Value| {
            if name == "transition_state" && declared {
                return ToolOutcome::failed(
                    ToolFailure::Refused,
                    "this session already declared a succession this turn",
                );
            }
            declared |= name == "transition_state";
            canned_outcome(name, args)
        },
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "code": "refused", "operation": "transition_state" })
    );
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "review", "note": null })),
        "the first declaration is the recorded one"
    );
    assert_eq!(log.names(), ["transition_state", "transition_state"]);
}

/// **The surface's one positional binding.** `delegation.transition_state` is bought by where an
/// instance stands rather than by a capability, so the only way to withhold it is to take it out of
/// the allowlist — which is exactly what an agent standing in no machine has.
#[test]
fn an_agent_outside_a_machine_cannot_transition() {
    let (outcome, log) = run_with(
        &catching("gg.delegation.transitionState(\"review\")"),
        &all_operations_but(DELEGATION_TRANSITION_STATE),
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_caught(
        &outcome,
        "unavailable",
        "transition_state",
        "`gg.delegation.transitionState` is not available.",
    );
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "delegation.transition_state"),
        "a withheld call lands on the roster a cross-arm readout joins on: {:?}",
        outcome.refusals
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");
}

/// An `exec` is the same registered succession a transition is, declared by the model instead of by
/// a machine — so it returns and the program runs to its end.
#[test]
fn an_exec_returns_and_the_program_runs_to_its_end() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.delegation.exec(\"reviewer\");\n",
        "console.log(\"ran on\");\n",
    ));
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "reviewer", "prompt": null }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_refused() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.exec(\"nope\")"),
        "exec",
        ToolFailure::InvalidArgument,
        "`exec`: this session may not become `nope`; agents it may become: reviewer",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "exec",
        "agents it may become: reviewer",
    );
}

/// **One succession per turn, whichever of the two declared it.** A program that has already moved
/// its machine on cannot then hand the session to another agent: they share one slot.
#[test]
fn a_second_succession_in_one_turn_is_refused() {
    let mut declared = false;
    let (outcome, log) = run_with(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.delegation.transitionState(\"review\");\n",
            "try { gg.delegation.exec(\"reviewer\"); }\n",
            "catch (e) { const f = e as gg.core.ApiError;\n",
            "  console.log(JSON.stringify({ code: f.code, operation: f.operation })); }\n",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
        move |name: &str, args: &Value| {
            if declared {
                return ToolOutcome::failed(
                    ToolFailure::Refused,
                    "this session already declared a succession this turn",
                );
            }
            declared = true;
            canned_outcome(name, args)
        },
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "code": "refused", "operation": "exec" })
    );
    assert_eq!(
        log.names(),
        ["transition_state", "exec"],
        "both reached dispatch; it is the second gg declined"
    );
}

/// A fork's handle is real at once — the id is minted at the call so the program can name the copy —
/// but the copy starts only when the turn's results are recorded, so **this** program waiting on it
/// finds no such child.
#[test]
fn a_fork_hands_back_a_handle_the_same_program_cannot_wait_on() {
    let (outcome, log) = run_failing(
        concat!(
            "import * as gg from \"gg\";\n",
            "const copy = gg.delegation.fork(\"try the other fix\");\n",
            "try { gg.delegation.waitForSubagents([copy.id]); }\n",
            "catch (e) { const f = e as gg.core.ApiError;\n",
            "  console.log(JSON.stringify({ id: copy.id, code: f.code, operation: f.operation })); }\n",
        ),
        "wait_for_subagents",
        ToolFailure::NotFound,
        "`wait_for_subagents`: no child agent `agent-2`; a fork is collected on a later turn",
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "id": "agent-2", "code": "not-found", "operation": "wait_for_subagents" })
    );
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn the_delegation_depth_cap_refuses_a_fork() {
    let (outcome, _) = run_failing(
        &catching("gg.delegation.fork(\"try the other fix\")"),
        "fork",
        ToolFailure::LimitExceeded,
        "`fork`: this run's delegation depth cap of 2 is already reached",
    );
    assert_caught(&outcome, "limit-exceeded", "fork", "delegation depth cap");
}

// ---------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------

/// A call that asks for nothing and narrows nothing is refused rather than answered with the whole
/// catalogue, because an empty query would page a model through everything it holds.
#[test]
fn a_search_with_neither_a_query_nor_a_filter_is_refused() {
    let (outcome, _) = run(&catching("gg.docs.search({})"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "a search needs something to look for",
    );
}

/// The kind is a closed union in this arm, so the only way a program composes a bad one is through
/// `any` — and gg names the three rather than only refusing, which is what makes it recoverable on
/// the same turn.
#[test]
fn an_unrecognised_doc_kind_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.docs.search({ query: \"view\", kind: \"funciton\" as any })",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "use `module`, `function` or `type`",
    );
}

#[test]
fn a_search_limit_of_zero_is_refused() {
    let (outcome, _) = run(&catching("gg.docs.search({ query: \"view\", limit: 0 })"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "a page of zero hits would answer nothing",
    );
}

/// **The call the whole discovery loop begins at.** The prompt names no function, so a run that
/// could withhold this could withhold an agent's knowledge of its own capabilities — which is why
/// it is [`Binding::Always`](crate::sandbox::Binding::Always) and answers an agent granted nothing.
#[test]
fn a_search_answers_an_agent_granted_nothing() {
    let outcome = run_as(
        concat!(
            "import * as gg from \"gg\";\n",
            "const page = gg.docs.search({ query: \"view\" });\n",
            "console.log(JSON.stringify({ total: page.total, offset: page.offset,\n",
            "  hits: page.hits.length }));\n",
        ),
        EndingRole::Standard,
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "total": 0, "offset": 0, "hits": 0 }),
        "an empty page is an answer; the refusal is the other thing"
    );
}

/// The page also lands in the window as a view, filed under **gg's own** selector — a program that
/// could choose the label could file two searches under one name and lose the first.
#[test]
fn a_search_files_its_results_under_ggs_own_selector() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.docs.search({ query: \"view\" });\n",
    ));
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.kind, view.selector.as_str()))
            .collect::<Vec<_>>(),
        vec![(ViewKind::Search, SEARCH_RESULTS_VIEW)]
    );
}

#[test]
fn a_documentation_view_is_closed_by_its_key() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.views.openDocsView(\"openText\");\n",
        "console.log(JSON.stringify(gg.docs.close(\"openText\")));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(1));
    assert_eq!(outcome.views_closed, ["openText"]);
}

/// A key that is not open is not a failure: a program that tidies up unconditionally should not
/// have to guard every call.
#[test]
fn closing_a_key_nothing_is_open_under_returns_zero() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.docs.close(\"nothing\")));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(0));
    assert!(outcome.views_closed.is_empty());
}

#[test]
fn every_documentation_view_is_closed_at_once() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.views.openDocsView(\"openText\");\n",
        "gg.views.openDocsView(\"readFile\");\n",
        "console.log(JSON.stringify(gg.docs.closeAll()));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(2));
    assert_eq!(
        outcome.views_closed,
        ["(every documentation view)"],
        "one call is reported as one close, not as one per key removed"
    );
}

#[test]
fn closing_every_documentation_view_with_none_open_returns_zero() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.docs.closeAll()));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(0));
    assert!(outcome.views_closed.is_empty());
}

/// **Opening documentation is unconditional and closing it is bought.** An open only ever appends to
/// the prompt, so a provider's cached prefix survives it; a close removes an item from the middle
/// and costs the run every cached token after it. Whether that trade pays is a measurement, so it
/// is a toggle.
#[test]
fn a_docs_close_is_refused_without_the_capability() {
    let (outcome, log) = run_with(
        &catching("gg.docs.close(\"openText\")"),
        &all_operations_but(DOCS_CLOSE),
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_caught(
        &outcome,
        "unavailable",
        "close",
        "`gg.docs.close` is not available.",
    );
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "docs.close"),
        "{:?}",
        outcome.refusals
    );
    assert!(log.names().is_empty());
}

/// The blanket form is its own operation and is refused on its own, which is the only way to see
/// that the two are not one gate behind one name.
#[test]
fn a_docs_close_all_is_refused_without_the_capability() {
    let (outcome, _) = run_with(
        &catching("gg.docs.closeAll()"),
        &all_operations_but(DOCS_CLOSE_ALL),
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_caught(
        &outcome,
        "unavailable",
        "close_all",
        "`gg.docs.closeAll` is not available.",
    );
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "docs.close_all"),
        "{:?}",
        outcome.refusals
    );
}

/// **The one guard against a name collision the catalogue gates cannot see.** Both calls are spelled
/// `close`, they take the same argument, they return the same count, and an arm that crossed the
/// two would pass every crossing check. What tells them apart is the operation each was recorded
/// under, which is what the api log keeps.
#[test]
fn docs_close_and_views_close_are_separate_operations() {
    let (outcome, _log, api_log) = watched(concat!(
        "import * as gg from \"gg\";\n",
        "gg.docs.close(\"openText\");\n",
        "gg.views.close(\"src/a.ts\");\n",
    ));
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        api_log.operations(),
        ["docs.close", "views.close"],
        "no arm that crossed the two could produce this pair"
    );
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

/// Nothing is truncated silently, so the refusal names **the size and the bound** — a program told
/// only "too large" cannot know how much less to ask for, and nothing is opened.
#[test]
fn a_window_over_the_text_cap_is_refused() {
    let oversized = "x".repeat(70_000);
    let (outcome, _) = run_answering(
        &catching("gg.views.openFile(\"src/wide.ts\")"),
        "read_file",
        ToolOutcome::ok(oversized.clone(), "read 1 line").with_data(ApiData::FileText(
            FileTextData {
                contents: oversized,
                first_line: 1,
                last_line: 1,
                total_lines: 1,
                byte_truncated: false,
            },
        )),
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "open_file",
        "view body exceeds max size (70000 bytes; max 65536)",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "a refused read opens nothing: {:?}",
        outcome.views_opened
    );
}

/// Unlike a zero `offset`, which plainly means the first line, a zero line cut names **nothing** —
/// so it is refused by name rather than normalised into "leave the lines whole".
#[test]
fn a_max_line_chars_of_zero_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.views.openFile(\"src/a.ts\", { maxLineChars: 0 })",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "open_file",
        "`maxLineChars` must be between 1 and 65536 (0 given)",
    );
}

#[test]
fn a_max_line_chars_over_the_bound_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.views.openFile(\"src/a.ts\", { maxLineChars: 65537 })",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "open_file",
        "`maxLineChars` must be between 1 and 65536 (65537 given)",
    );
}

/// Re-opening a path **replaces** what it showed, and says so: a program that re-reads a file in a
/// loop must be able to read its own accounting correctly rather than believing it opened a second
/// view each time.
#[test]
fn re_opening_a_file_view_supersedes_it() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.views.openFile(\"src/a.ts\");\n",
        "gg.views.openFile(\"src/a.ts\");\n",
        "console.log(JSON.stringify(gg.views.close(\"src/a.ts\")));\n",
    ));
    let opened: Vec<bool> = outcome
        .views_opened
        .iter()
        .map(|view| view.superseded)
        .collect();
    assert_eq!(opened, [false, true]);
    assert_eq!(
        logged_json(&outcome),
        json!(1),
        "two opens of one path are one view"
    );
}

/// **The read is bounded by the budget and the report is not.** A spent wall-clock budget refuses
/// everything that dispatches, which `views.open_file` does; `views.open_text` performs no work and
/// bypasses the guard, because a turn that cannot say what it found is worse than one that says it
/// late.
#[test]
fn a_spent_wall_clock_budget_refuses_the_read_but_not_the_report() {
    let outcome = run_spent(concat!(
        "import * as gg from \"gg\";\n",
        "try { gg.views.openFile(\"src/a.ts\"); }\n",
        "catch (e) { const f = e as gg.core.ApiError;\n",
        "  console.log(JSON.stringify({ code: f.code, operation: f.operation, message: f.message })); }\n",
        "gg.views.openText(\"note\", \"what I found before the clock ran out\");\n",
    ));
    let refusal = logged_json(&outcome);
    assert_eq!(refusal["code"], json!("limit-exceeded"));
    assert_eq!(refusal["operation"], json!("open_file"));
    assert!(
        refusal["message"]
            .as_str()
            .is_some_and(|said| said.contains("wall-clock budget is spent")),
        "{refusal}"
    );
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.kind, view.selector.as_str()))
            .collect::<Vec<_>>(),
        vec![(ViewKind::Text, "note")],
        "the report still reached the window"
    );
}

#[test]
fn a_text_body_over_the_cap_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.views.openText(\"summary\", \"x\".repeat(65537))",
    ));
    assert_caught(
        &outcome,
        "limit-exceeded",
        "open_text",
        "view body exceeds max size (65537 bytes; max 65536)",
    );
}

/// The label has a cap of its own, far smaller than the body's, and the two are told apart by what
/// the sentence says rather than by the class.
#[test]
fn a_text_label_over_the_cap_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.views.openText(\"l\".repeat(201), \"eight files, two failing\")",
    ));
    assert_caught(
        &outcome,
        "limit-exceeded",
        "open_text",
        "label exceeds max length (201 bytes; max 200)",
    );
}

#[test]
fn an_unknown_documentation_name_is_not_found() {
    let log = CallLog::default();
    let outcome = run_over_library(
        &catching("gg.views.openDocsView(\"gg.views.noSuchThing\")"),
        FakeOperationApi::new(&log).cataloguing(&[("openText", true)]),
    );
    assert_caught(
        &outcome,
        "not-found",
        "open_docs_view",
        "no documentation for `gg.views.noSuchThing`",
    );
    assert!(outcome.views_opened.is_empty());
}

/// A real catalogue name **outside this agent's scope** is the same class and a different cause, and
/// the message is about the binding rather than the spelling: a model told "no such name" would
/// spend a turn correcting a name that was already right. It is still `not-found`, because telling
/// it the call exists would be telling it about a call it may not make.
#[test]
fn a_documentation_name_this_agent_does_not_bind_is_not_found() {
    let log = CallLog::default();
    let outcome = run_over_library(
        &catching("gg.views.openDocsView(\"fork\")"),
        FakeOperationApi::new(&log).cataloguing(&[("openText", true), ("fork", false)]),
    );
    assert_caught(
        &outcome,
        "not-found",
        "open_docs_view",
        "this session does not bind it",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn an_empty_view_selector_is_refused() {
    let (outcome, _) = run(&catching("gg.views.close(\"\")"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "close",
        "needs a non-empty selector",
    );
}

// ---------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------

/// The honest answer on the first turn of every session, and the reason the call is a `result` and
/// not a bare list: "nothing has run yet" and "this run keeps no library" are different facts, and
/// one list could only tell the model one of them.
#[test]
fn an_empty_history_is_an_empty_list() {
    let outcome = run_with_library(
        "import * as gg from \"gg\";\nconsole.log(JSON.stringify(gg.programs.history()));",
        &[],
    );
    assert_eq!(logged_json(&outcome), json!([]));
}

/// The **other** way to miss, with the same remedy and therefore the same answer: an id this session
/// really was issued, whose program the retention has since dropped. The refusal names the ids that
/// are held, which is what makes it recoverable on the same turn.
#[test]
fn a_dropped_programs_id_is_not_found() {
    let log = CallLog::default();
    let outcome = run_over_library(
        &catching("gg.programs.get(\"aaaa\")"),
        FakeOperationApi::new(&log)
            .keeping(2)
            .with_program("aaaa", 1, "console.log(1);")
            .with_program("bbbb", 2, "console.log(2);")
            .with_program("cccc", 3, "console.log(3);"),
    );
    assert_caught(
        &outcome,
        "not-found",
        "get",
        "no program is kept under the id `aaaa`",
    );
    let said = logged_json(&outcome)["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        said.contains("`bbbb` (turn 2)") && said.contains("`cccc` (turn 3)"),
        "the ids still held are named: {said}"
    );
    assert!(
        !said.contains("(turn 1)"),
        "and the dropped one is not among them: {said}"
    );
}

/// **The capability is read before the argument.** An agent that keeps no library has one problem
/// rather than two, so it is told that rather than told its id was blank.
#[test]
fn the_library_capability_is_checked_before_the_id() {
    let (outcome, log) = run(&catching("gg.programs.get(\"\")"));
    assert_caught(
        &outcome,
        "unavailable",
        "get",
        "`gg.programs.get` is not available.",
    );
    assert!(log.names().is_empty());
}

/// A blank source is refused rather than handed to a compiler that would answer with a syntax error
/// about nothing.
#[test]
fn a_blank_rerun_source_is_refused() {
    let outcome = run_with_library(&catching("gg.programs.rerun(\"   \")"), &[]);
    assert_caught(&outcome, "invalid-argument", "rerun", "must not be blank");
    assert!(outcome.rerun.is_none(), "nothing is compiled");
}

#[test]
fn a_second_hand_over_from_one_program_is_refused() {
    let outcome = run_with_library(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.programs.rerun(\"console.log('the first');\");\n",
            "try { gg.programs.rerun(\"console.log('the second');\"); }\n",
            "catch (e) { const f = e as gg.core.ApiError;\n",
            "  console.log(JSON.stringify({ code: f.code, operation: f.operation })); }\n",
        ),
        &[],
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "code": "refused", "operation": "rerun" })
    );
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("console.log('the first');"),
        "the first source is the one the outcome carries"
    );
}

/// **The line between the two kinds of refusal.** The roster answers "what did the model reach for
/// that this run does not offer it", which a comparison of two configurations counts. A blank source
/// is neither: the call was offered and was made, and the throw is the whole report.
#[test]
fn a_rerun_refused_over_its_argument_is_not_on_the_refusal_roster() {
    let outcome = run_with_library(&catching("gg.programs.rerun(\"   \")"), &[]);
    assert_caught(&outcome, "invalid-argument", "rerun", "must not be blank");
    assert!(
        outcome.refusals.is_empty(),
        "unlike a gate refusal, this one is not a withheld reach: {:?}",
        outcome.refusals
    );
}

#[test]
fn a_rerun_is_unavailable_without_the_library() {
    let (outcome, _) = run(&catching("gg.programs.rerun(\"console.log('again');\")"));
    assert_caught(
        &outcome,
        "unavailable",
        "rerun",
        "`gg.programs.rerun` is not available.",
    );
    assert!(outcome.rerun.is_none());
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "programs.rerun"),
        "{:?}",
        outcome.refusals
    );
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

/// The summary becomes the session's whole answer to whoever asked for the work, so "I am done and
/// have nothing to say about it" is not an ending gg accepts on the model's behalf — and the
/// sentence tells the model the run is still open.
#[test]
fn a_blank_summary_finishes_nothing() {
    let (outcome, _) = run(&catching("gg.session.finish(\"  \")"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "finish",
        "The session is NOT over",
    );
    assert!(outcome.completion.is_none());
}

/// **Last call wins**, and the replacement is counted: with no unwind, calling one twice is an
/// ordinary thing for a program to do, and the later summary is the one written with more of the
/// work behind it.
#[test]
fn a_later_finish_replaces_the_summary() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.session.finish(\"the first attempt\");\n",
        "gg.session.finish(\"the second, with the tests green\");\n",
    ));
    let completion = completion(&outcome);
    assert_eq!(summary_of(completion), "the second, with the tests green");
    assert_eq!(completion.superseded, 1);
}

/// The summary describes checks the program never finished running, so gg keeps it for the feedback
/// and gives the model another turn rather than ending the run on it.
#[test]
fn a_program_that_finishes_and_then_throws_loses_the_ending() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.session.finish(\"the work is done\");\n",
        "throw new Error(\"the checks did not pass\");\n",
    ));
    assert!(outcome.completion.is_none());
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "the work is done".to_string(),
        })
    );
    assert!(
        program_failure(&outcome).contains("the checks did not pass"),
        "{}",
        program_failure(&outcome)
    );
}

/// An ending performs no work, so a spent budget has nothing to protect — and withholding the exit
/// at the moment a run most needs it is the one thing the deadline guard must not do.
#[test]
fn finishing_is_allowed_after_the_budget_is_spent() {
    let outcome =
        run_spent("import * as gg from \"gg\";\ngg.session.finish(\"wrote the manifest\");");
    assert_eq!(summary_of(completion(&outcome)), "wrote the manifest");
}

#[test]
fn a_reviewer_approves_and_the_run_ends() {
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.approve();",
        EndingRole::Review,
    );
    assert_eq!(completion(&outcome).ending, Ending::Approved);
}

/// A verdict is the one declaration nothing downstream re-examines, so an agent that may not give
/// one is stopped here — and the reach is counted, because "the model reached for something this
/// agent was not granted" is what a comparison of two configurations rests on.
#[test]
fn a_withheld_ending_lands_on_the_refusal_roster() {
    let outcome = run_as(&catching("gg.session.approve()"), EndingRole::Standard);
    assert_caught(
        &outcome,
        "unavailable",
        "approve",
        "Use `gg.session.finish` instead.",
    );
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "session.approve"),
        "{:?}",
        outcome.refusals
    );
    assert!(outcome.completion.is_none());
}

/// A rejection is dispatched verbatim to the agent that has to fix the work, so an empty list would
/// send it back to re-read criteria it already believed it had met.
#[test]
fn a_rejection_with_no_changes_is_refused() {
    let outcome = run_as(
        &catching("gg.session.requestChanges([])"),
        EndingRole::Review,
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "request_changes",
        "requires at least one change",
    );
    assert!(outcome.completion.is_none());
}

/// The separate cause: a list with entries in it, **all of them blank**. They are dropped first, and
/// what is refused is the empty result — so the two are one message arrived at two ways rather than
/// one check.
#[test]
fn a_rejection_whose_every_entry_is_blank_is_refused() {
    let outcome = run_as(
        &catching("gg.session.requestChanges([\"\", \"  \"])"),
        EndingRole::Review,
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "request_changes",
        "requires at least one change",
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_rejection_lists_its_changes_verbatim() {
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.requestChanges([\"`step()` is off by one\", \"widen the test\"]);",
        EndingRole::Review,
    );
    assert_eq!(
        completion(&outcome).ending,
        Ending::ChangesRequested {
            items: vec![
                "`step()` is off by one".to_string(),
                "widen the test".to_string(),
            ],
        }
    );
}

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

/// **The capture keeps the tail**, and what went is counted rather than silently dropped: the
/// natural shape is to log per item in a loop and then log the conclusion, so a head-biased capture
/// would discard exactly the line the program wrote to be read.
#[test]
fn logging_past_the_line_cap_keeps_the_last_lines_and_counts_the_rest() {
    let (outcome, _) = run(&format!(
        "for (let index = 0; index < {}; index += 1) {{ console.log(`line ${{index}}`); }}\n",
        MAX_LOG_LINES + 5
    ));
    let kept = logs(&outcome);
    assert_eq!(kept.len(), MAX_LOG_LINES);
    assert_eq!(kept[0], "line 5", "the oldest five were evicted");
    assert_eq!(
        kept[MAX_LOG_LINES - 1],
        format!("line {}", MAX_LOG_LINES + 4)
    );
    assert_eq!(outcome.logs_suppressed, 5);
}

/// One `console.log(hugeString)` cannot spend the whole budget by itself — and the cut lands on a
/// character boundary, so a multi-byte value is never split through the middle of a character.
#[test]
fn a_line_over_the_byte_cap_is_cut_on_a_character_boundary() {
    let (outcome, _) = run(&format!(
        "console.log(\"\\u65e5\".repeat({MAX_LOG_LINE_BYTES}));\n"
    ));
    let kept = &logs(&outcome)[0];
    assert!(
        kept.ends_with('…') && kept.len() <= MAX_LOG_LINE_BYTES + '…'.len_utf8(),
        "the cut is marked and inside the cap: {} bytes",
        kept.len()
    );
    assert!(
        kept.chars()
            .all(|character| character == '日' || character == '…'),
        "every character survived whole: {kept}"
    );
}

/// **What "named" means on this arm.** A broken module belongs to whoever authored the skill or
/// wrote the memory, so one the program never imports is never evaluated and carries nothing. One
/// the program *does* import is part of the program: an ES module is evaluated as part of the
/// importing program's own evaluation, which is the exception the API surface states — so the
/// `feedback` channel's module list stays empty here and what the model reads is its own located
/// failure, under the specifier it wrote.
#[test]
fn a_broken_module_is_named_in_the_turns_feedback() {
    let untouched = run_with_modules(
        "console.log(\"ran\");\n",
        &[("broken", "export const n = (undefined as any).x;\n")],
    );
    assert_eq!(logs(&untouched), ["ran"]);
    assert!(
        untouched.module_errors.is_empty(),
        "a module the program never imported was never evaluated: {:?}",
        untouched.module_errors
    );

    let imported = run_with_modules(
        "import * as broken from \"lib:broken\";\nconsole.log(String(broken.n));\n",
        &[("broken", "export const n = (undefined as any).x;\n")],
    );
    let said = program_failure(&imported);
    assert!(
        said.contains("TypeError") && said.contains("lib:broken:1:"),
        "the binding key and the message reach the model at the module's own line: {said}"
    );
    assert!(
        imported.module_errors.is_empty(),
        "and on this arm they reach it as the program's own failure: {:?}",
        imported.module_errors
    );
}
