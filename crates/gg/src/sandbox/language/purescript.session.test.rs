//! **The session-side SDK, driven from PureScript programs** — `Gg.Context`, `Gg.Delegation`,
//! `Gg.Programs`, `Gg.Docs`, `Gg.Views` and `Gg.Session`, plus the `feedback` channel underneath
//! them.
//!
//! The crossing table in [the substrate file](super::substrate) pins the arguments these calls carry;
//! what it does not do is read a returned value back or drive a failure. Each case here is one small
//! PureScript program, the kind a model writes, and one `#[test]` named as the sentence it proves.
//!
//! # The two shapes
//!
//! A **success** asserts what the call left behind: the value the program logged, the arguments the
//! membrane composed ([`CallLog::args`]), and the view, the ending or the hand-over the
//! [outcome](SandboxOutcome) carries.
//!
//! A **refusal** is caught with `Gg.Core.attempt` and logged as its code, its operation and its
//! message — [`caught`] writes those statements — so the assertion reads what the model reads. A
//! refusal made by the guest before anything crossed additionally asserts the call log is empty.
//!
//! # Nothing here reaches a model or a provider
//!
//! Every answer is synthesized by [`FakeOperationApi`]: a tool-backed failure by a responder that
//! answers that one tool with that class, and a view or documentation refusal by the double's own
//! guards or by [`refusing_views`](FakeOperationApi::refusing_views).

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use test_cabinet_core::gg::{CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE};

use super::substrate::{
    caught, evaluate_js, logging_program_of, logs, prepare, purescript, run_as, trapped,
};
use crate::context::{SEARCH_RESULTS_VIEW, ViewKind};
use crate::docs::DocKind;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, all_operations_without,
    canned_outcome, granted_operations,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::membrane::capture::MAX_LOG_LINES;
use crate::sandbox::operations::{OperationId, capability_operations};
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{
    CodeModule, PreparedProgram, ProgramScope, SandboxLimits, run_prepared_program,
};
use crate::tools::{
    ApiData, ArchiveSearchData, MAX_ARCHIVE_RANGES, ReclaimData, SubagentResultData, ToolFailure,
    ToolOutcome,
};

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

/// One program made of `statements`, with what a program that catches, loops and counts imports:
/// [`logging_program_of`]'s lines plus `Data.Array` and `Data.Foldable` under their own names.
fn program(statements: &[&str]) -> String {
    logging_program_of(statements).replace(
        "import Effect (Effect)\n",
        "import Effect (Effect)\nimport Data.Array as Data.Array\n\
         import Data.Foldable as Data.Foldable\n",
    )
}

/// Run `statements` as one program with every operation granted, in the standard role, with the
/// program library kept, and `responder` answering every tool.
fn responding(
    statements: &[&str],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(
        &program(statements),
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        true,
        responder,
    )
}

/// [`responding`] against [`canned_outcome`].
fn canned(statements: &[&str]) -> (SandboxOutcome, CallLog) {
    responding(statements, canned_outcome)
}

/// [`responding`] with `tool` answered by the failure gg would have written, and every other tool
/// answered from the canned table.
fn failing(
    statements: &[&str],
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    responding(statements, move |name, args| {
        if name == tool {
            ToolOutcome::failed(failure, message)
        } else {
            canned_outcome(name, args)
        }
    })
}

/// [`responding`] with `tool` answered by `outcome` — a success the canned table does not offer.
fn answering(
    statements: &[&str],
    tool: &'static str,
    outcome: ToolOutcome,
) -> (SandboxOutcome, CallLog) {
    responding(statements, move |name, args| {
        if name == tool {
            outcome.clone()
        } else {
            canned_outcome(name, args)
        }
    })
}

/// A responder answering `tool` first with success and on every later call with a `refused` failure
/// carrying `message` — the second of two successions in one turn.
fn second_refused(
    tool: &'static str,
    message: &'static str,
) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    let calls = Arc::new(Mutex::new(0_u32));
    move |name, args| {
        if name != tool {
            return canned_outcome(name, args);
        }
        let mut seen = calls.lock().expect("the counter is never poisoned");
        *seen += 1;
        if *seen == 1 {
            canned_outcome(name, args)
        } else {
            ToolOutcome::failed(ToolFailure::Refused, message)
        }
    }
}

/// Compile `statements` and run them against the double the case built, with `capabilities` and
/// `operations` in scope and `ending`'s group bound.
fn over_scoped(
    statements: &[&str],
    capabilities: &[String],
    operations: &[OperationId],
    ending: RunEnding,
    api: FakeOperationApi,
) -> SandboxOutcome {
    let (outcome, _api) = run_prepared_program(
        purescript(),
        PreparedProgram {
            source: prepare(&program(statements)),
            component: None,
        },
        ProgramScope {
            capabilities,
            operations,
            modules: &[],
            ending,
        },
        SandboxLimits::AMPLE,
        None,
        api,
    );
    outcome
}

/// [`over_scoped`] with every capability and operation granted and the standard role bound.
fn over(statements: &[&str], api: FakeOperationApi) -> SandboxOutcome {
    over_scoped(
        statements,
        &all_capabilities(),
        &granted_operations(&all_operations(), true),
        RunEnding::Role(EndingRole::Standard),
        api,
    )
}

/// [`over`] against a double whose view and documentation calls are all refused with `failure` and
/// `message`, handing back the call log beside the outcome.
fn refused_views(
    statements: &[&str],
    failure: ToolFailure,
    message: &str,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome).refusing_views(failure, message);
    (over(statements, api), log)
}

/// Run `statements` in `role`'s ending group, every operation granted.
fn as_role(statements: &[&str], role: EndingRole) -> (SandboxOutcome, CallLog) {
    run_as(
        &program(statements),
        &all_operations(),
        &[],
        RunEnding::Role(role),
        true,
        canned_outcome,
    )
}

/// The one line a [`caught`] program logged for a caught failure: its code, its operation and gg's
/// message, whole.
fn assert_caught(outcome: &SandboxOutcome, code: &str, operation: &str, message: &str) {
    assert_eq!(
        logs(outcome),
        [format!("{code} {operation} {message}")],
        "the program caught a `{code}` from `{operation}` carrying gg's own words"
    );
}

/// [`assert_caught`] for a failure whose message is not the test's to state whole: the code and the
/// operation exactly, and the message containing `fragment`.
fn assert_caught_naming(outcome: &SandboxOutcome, code: &str, operation: &str, fragment: &str) {
    let lines = logs(outcome);
    assert_eq!(lines.len(), 1, "one caught failure: {lines:?}");
    let prefix = format!("{code} {operation} ");
    assert!(
        lines[0].starts_with(&prefix),
        "the program caught a `{code}` from `{operation}`: {:?}",
        lines[0]
    );
    assert!(
        lines[0][prefix.len()..].contains(fragment),
        "and the message names `{fragment}`: {:?}",
        lines[0]
    );
}

/// The views the program opened, as `(kind, selector)`.
fn opened(outcome: &SandboxOutcome) -> Vec<(ViewKind, &str)> {
    outcome
        .views_opened
        .iter()
        .map(|view| (view.kind, view.selector.as_str()))
        .collect()
}

/// The ending the program declared, insisting it declared one.
fn ending_of(outcome: &SandboxOutcome) -> &Ending {
    &outcome
        .completion
        .as_ref()
        .unwrap_or_else(|| panic!("the program declared no ending: {:?}", outcome.logs))
        .ending
}

/// `source` written as a PureScript string literal.
fn purs_string(source: &str) -> String {
    format!(
        "\"{}\"",
        source
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}

/// Logs a `Gg.Context.ReclaimReport` bound as `report`.
const LOG_REPORT: &str = "Console.log (show report.items <> \" \" <> show report.reclaimedTokens \
     <> \" \" <> show report.paths <> \" \" <> report.detail)";

// ---------------------------------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------------------------------

#[test]
fn an_eviction_hands_back_what_it_reclaimed() {
    let (outcome, log) = canned(&[
        "report <- Gg.Context.evictFileView { path: \"src/a.purs\" }",
        LOG_REPORT,
    ]);
    assert_eq!(logs(&outcome), ["2 300 [\"src/a.ts\"] dropped 2 items"]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.purs" }))
    );
}

#[test]
fn an_eviction_with_no_path_drops_every_file_view() {
    let (outcome, log) = canned(&[
        "report <- Gg.Context.evictFileView {}",
        "Console.log (show report.items)",
    ]);
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_eviction_path_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Context.evictFileView { path: \"\" }")],
        "evict_file_view",
        ToolFailure::InvalidArgument,
        "`path` must not be empty; leave it out to drop every file view",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "evict_file_view",
        "`path` must not be empty; leave it out to drop every file view",
    );
}

#[test]
fn an_archive_hands_back_what_it_reclaimed_with_no_paths() {
    let (outcome, log) = answering(
        &[
            "report <- Gg.Context.archiveThread [ { from: 4, to: 19 } ]",
            LOG_REPORT,
            "Console.log (show (Data.Array.null report.paths))",
        ],
        "archive_thread",
        ToolOutcome::ok("archived", "archived").with_data(ApiData::Reclaim(ReclaimData {
            items: 16,
            reclaimed_tokens: 4_200,
            paths: Vec::new(),
            detail: "archived turns 4 through 19".to_string(),
        })),
    );
    assert_eq!(
        logs(&outcome),
        ["16 4200 [] archived turns 4 through 19", "true"]
    );
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19]] }))
    );
}

#[test]
fn an_empty_list_of_spans_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Context.archiveThread []")],
        "archive_thread",
        ToolFailure::InvalidArgument,
        "`ranges` must name at least one span",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "archive_thread",
        "`ranges` must name at least one span",
    );
}

#[test]
fn more_than_thirty_two_spans_is_an_argument_error() {
    let call = format!(
        "Gg.Context.archiveThread (map (\\turn -> {{ from: turn, to: turn }}) (Data.Array.range 1 {}))",
        MAX_ARCHIVE_RANGES + 1
    );
    let (outcome, log) = failing(
        &[&caught(&call)],
        "archive_thread",
        ToolFailure::InvalidArgument,
        "`ranges` holds 33 spans; at most 32 can be archived in one call",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "archive_thread",
        "`ranges` holds 33 spans; at most 32 can be archived in one call",
    );
    assert!(
        logs(&outcome)[0].contains(&MAX_ARCHIVE_RANGES.to_string()),
        "the message names the bound"
    );
    assert_eq!(
        log.args("archive_thread").expect("the call crossed")["ranges"]
            .as_array()
            .map(Vec::len),
        Some(MAX_ARCHIVE_RANGES + 1)
    );
}

#[test]
fn a_span_that_ends_before_it_starts_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Context.archiveThread [ { from: 19, to: 4 } ]")],
        "archive_thread",
        ToolFailure::InvalidArgument,
        "span 19..4 ends before it starts",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "archive_thread",
        "span 19..4 ends before it starts",
    );
}

#[test]
fn a_negative_turn_number_is_refused_before_the_call() {
    let (outcome, log) = canned(&[&caught("Gg.Context.archiveThread [ { from: -1, to: 4 } ]")]);
    assert_caught_naming(
        &outcome,
        "InvalidArgument",
        "archive_thread",
        "ranges[].from",
    );
    assert!(log.calls().is_empty(), "nothing crossed: {:?}", log.calls());
}

#[test]
fn an_archive_search_reads_its_hits_and_their_roles() {
    let (outcome, log) = canned(&[
        "found <- Gg.Context.searchArchive \"the parser\"",
        "Console.log (show found.archiveEmpty)",
        "case found.hits of\n    \
         [ hit ] -> Console.log (show hit.seq <> \" \" <> show hit.role <> \" \" <> hit.text)\n    \
         _ -> Console.log \"not one hit\"",
    ]);
    assert_eq!(
        logs(&outcome),
        ["false", "3 AssistantMessage the earlier answer"]
    );
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

#[test]
fn an_empty_archive_is_told_apart_from_a_search_that_matched_nothing() {
    let (outcome, _log) = answering(
        &[
            "found <- Gg.Context.searchArchive \"the parser\"",
            "Console.log (show found.archiveEmpty <> \" \" <> show (Data.Array.length found.hits))",
        ],
        "search_archive",
        ToolOutcome::ok("nothing archived", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            },
        )),
    );
    assert_eq!(logs(&outcome), ["true 0"]);
}

#[test]
fn an_empty_archive_query_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Context.searchArchive \"\"")],
        "search_archive",
        ToolFailure::InvalidArgument,
        "`query` must not be empty",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "search_archive",
        "`query` must not be empty",
    );
}

#[test]
fn a_compaction_is_registered_and_the_program_runs_on() {
    let (outcome, log) = canned(&[
        "Gg.Context.compact \"scaffolded the page\" { files: [ \"src/Main.purs\" ] }",
        "found <- Gg.Context.searchArchive \"after\"",
        "Console.log (show found.archiveEmpty)",
    ]);
    assert_eq!(logs(&outcome), ["false"]);
    assert_eq!(log.names(), ["compact", "search_archive"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": [ "src/Main.purs" ] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Context.compact \"   \" {}")],
        "compact",
        ToolFailure::InvalidArgument,
        "`summary` must not be blank",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "compact",
        "`summary` must not be blank",
    );
}

// ---------------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------------

#[test]
fn a_spawned_child_hands_back_its_handle() {
    let (outcome, log) = canned(&[
        "child <- Gg.Delegation.spawnSubagent \"subagent\" (Gg.Delegation.Prompt \"write the lexer\")",
        "Console.log (child.id <> \" \" <> child.slot <> \" \" <> child.modelId)",
    ]);
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }))
    );
}

#[test]
fn a_child_briefed_from_an_issue_crosses_as_an_issue() {
    let (outcome, log) = canned(&[
        "child <- Gg.Delegation.spawnSubagent \"subagent\" (Gg.Delegation.Issue \"EPIC-1\")",
        "Console.log child.id",
    ]);
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "EPIC-1" }))
    );
}

#[test]
fn an_agent_this_session_may_not_spawn_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught(
            "Gg.Delegation.spawnSubagent \"Architect\" (Gg.Delegation.Prompt \"plan it\")",
        )],
        "spawn_subagent",
        ToolFailure::InvalidArgument,
        "this session may not spawn `Architect`; it may spawn `subagent`",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "spawn_subagent",
        "this session may not spawn `Architect`; it may spawn `subagent`",
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded() {
    let (outcome, _log) = failing(
        &[&caught(
            "Gg.Delegation.spawnSubagent \"subagent\" (Gg.Delegation.Prompt \"go deeper\")",
        )],
        "spawn_subagent",
        ToolFailure::LimitExceeded,
        "the delegation depth cap of 3 is reached",
    );
    assert_caught(
        &outcome,
        "LimitExceeded",
        "spawn_subagent",
        "the delegation depth cap of 3 is reached",
    );
}

#[test]
fn a_wait_hands_back_each_childs_ending_and_summary() {
    let (outcome, log) = canned(&[
        "results <- Gg.Delegation.waitForSubagents { ids: [ \"agent-1\" ] }",
        "Data.Foldable.for_ results \\result -> Console.log (result.id <> \" \" <> show result.status <> \" \" <> result.summary)",
    ]);
    assert_eq!(
        logs(&outcome),
        ["agent-1 (Just AgentCompleted) did the work"]
    );
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": [ "agent-1" ] }))
    );
}

#[test]
fn a_wait_with_no_ids_collects_every_child() {
    let (outcome, log) = canned(&[
        "results <- Gg.Delegation.waitForSubagents {}",
        "Console.log (show (Data.Array.length results))",
    ]);
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn a_child_with_no_ending_yet_reads_as_nothing() {
    let (outcome, _log) = answering(
        &[
            "results <- Gg.Delegation.waitForSubagents {}",
            "Data.Foldable.for_ results \\result -> Console.log (result.id <> \" \" <> show result.status)",
        ],
        "wait_for_subagents",
        ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
            SubagentResultData {
                id: "agent-1".to_string(),
                status: None,
                summary: String::new(),
            },
        ])),
    );
    assert_eq!(logs(&outcome), ["agent-1 Nothing"]);
}

#[test]
fn waiting_on_an_id_that_is_not_there_is_not_found() {
    let (outcome, _log) = failing(
        &[&caught(
            "Gg.Delegation.waitForSubagents { ids: [ \"agent-9\" ] }",
        )],
        "wait_for_subagents",
        ToolFailure::NotFound,
        "no subagent `agent-9`; this session's children are `agent-1`",
    );
    assert_caught(
        &outcome,
        "NotFound",
        "wait_for_subagents",
        "no subagent `agent-9`; this session's children are `agent-1`",
    );
}

#[test]
fn a_message_reaches_a_running_child_and_the_program_runs_on() {
    let (outcome, log) = canned(&[
        "Gg.Delegation.sendMessage \"agent-1\" \"prefer the simpler parser\"",
        "results <- Gg.Delegation.waitForSubagents { ids: [ \"agent-1\" ] }",
        "Console.log (show (Data.Array.length results))",
    ]);
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(log.names(), ["send_message", "wait_for_subagents"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn messaging_an_agent_that_is_not_there_is_not_found() {
    let (outcome, _log) = failing(
        &[&caught(
            "Gg.Delegation.sendMessage \"agent-9\" \"are you there\"",
        )],
        "send_message",
        ToolFailure::NotFound,
        "no agent `agent-9` is running",
    );
    assert_caught(
        &outcome,
        "NotFound",
        "send_message",
        "no agent `agent-9` is running",
    );
}

#[test]
fn messaging_a_child_that_has_returned_is_a_conflict() {
    let (outcome, _log) = failing(
        &[&caught(
            "Gg.Delegation.sendMessage \"agent-1\" \"one more thing\"",
        )],
        "send_message",
        ToolFailure::Conflict,
        "`agent-1` has already returned",
    );
    assert_caught(
        &outcome,
        "Conflict",
        "send_message",
        "`agent-1` has already returned",
    );
}

#[test]
fn a_transition_is_registered_and_the_program_runs_on() {
    let (outcome, log) = canned(&[
        "Gg.Delegation.transitionState \"verify\" { note: \"the build is green\" }",
        "found <- Gg.Context.searchArchive \"after\"",
        "Console.log (show found.archiveEmpty)",
    ]);
    assert_eq!(logs(&outcome), ["false"]);
    assert_eq!(log.names(), ["transition_state", "search_archive"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": "the build is green" }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Delegation.transitionState \"ship\" {}")],
        "transition_state",
        ToolFailure::InvalidArgument,
        "`ship` is not a state this agent may move to; it may move to `verify`",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "transition_state",
        "`ship` is not a state this agent may move to; it may move to `verify`",
    );
}

#[test]
fn a_second_transition_in_one_turn_is_refused() {
    let (outcome, log) = responding(
        &[
            "Gg.Delegation.transitionState \"verify\" {}",
            &caught("Gg.Delegation.transitionState \"review\" {}"),
        ],
        second_refused(
            "transition_state",
            "this turn already declared a transition",
        ),
    );
    assert_caught(
        &outcome,
        "Refused",
        "transition_state",
        "this turn already declared a transition",
    );
    assert_eq!(log.names(), ["transition_state", "transition_state"]);
}

#[test]
fn a_succession_is_registered_and_the_program_runs_on() {
    let (outcome, log) = canned(&[
        "Gg.Delegation.exec \"Builder\" { prompt: \"pick it up from here\" }",
        "found <- Gg.Context.searchArchive \"after\"",
        "Console.log (show found.archiveEmpty)",
    ]);
    assert_eq!(logs(&outcome), ["false"]);
    assert_eq!(log.names(), ["exec", "search_archive"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_an_argument_error() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Delegation.exec \"Architect\" {}")],
        "exec",
        ToolFailure::InvalidArgument,
        "this session may not become `Architect`; it may become `Builder`",
    );
    assert_caught(
        &outcome,
        "InvalidArgument",
        "exec",
        "this session may not become `Architect`; it may become `Builder`",
    );
}

#[test]
fn a_second_succession_in_one_turn_is_refused() {
    let (outcome, log) = responding(
        &[
            "Gg.Delegation.exec \"Builder\" {}",
            &caught("Gg.Delegation.exec \"Reviewer\" {}"),
        ],
        second_refused("exec", "this turn already declared a succession"),
    );
    assert_caught(
        &outcome,
        "Refused",
        "exec",
        "this turn already declared a succession",
    );
    assert_eq!(log.names(), ["exec", "exec"]);
}

#[test]
fn a_fork_hands_back_the_copys_handle() {
    let (outcome, log) = canned(&[
        "copy <- Gg.Delegation.fork \"try the other fix\"",
        "Console.log copy.id",
    ]);
    assert_eq!(logs(&outcome), ["agent-2"]);
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Delegation.fork \"try the other fix\"")],
        "fork",
        ToolFailure::LimitExceeded,
        "the delegation depth cap of 3 is reached",
    );
    assert_caught(
        &outcome,
        "LimitExceeded",
        "fork",
        "the delegation depth cap of 3 is reached",
    );
}

// ---------------------------------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------------------------------

/// A program the library is seeded with, and a hand-over's whole module.
const EARLIER: &str = "module Main where\n\nimport Prelude\n\nmain = pure unit\n";

#[test]
fn a_history_lists_every_program_already_run() {
    let later = "module Main where\nimport Prelude\nmain = pure unit\n";
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome)
        .with_program("k3p9", 2, EARLIER)
        .with_program("m7q1", 5, later);
    let outcome = over(
        &[
            "history <- Gg.Programs.history",
            "Data.Foldable.for_ history \\program -> Console.log (program.id <> \" \" <> show program.turn <> \" \" <> show program.chars <> \" \" <> show program.ok)",
        ],
        api,
    );
    assert_eq!(
        logs(&outcome),
        [
            format!("k3p9 2 {} true", EARLIER.chars().count()),
            format!("m7q1 5 {} true", later.chars().count()),
        ]
    );
}

#[test]
fn a_program_id_the_library_never_issued_is_not_found() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome).with_program("k3p9", 2, EARLIER);
    let outcome = over(&[&caught("Gg.Programs.get \"zzzz\"")], api);
    assert_caught_naming(&outcome, "NotFound", "get", "k3p9");
}

#[test]
fn a_handover_carries_the_source_the_model_wrote() {
    let (outcome, _log) = canned(&[&format!("Gg.Programs.rerun {}", purs_string(EARLIER))]);
    assert!(logs(&outcome).is_empty());
    assert_eq!(outcome.rerun.as_deref(), Some(EARLIER));
}

#[test]
fn a_blank_handover_source_is_an_argument_error() {
    let (outcome, _log) = canned(&[&caught("Gg.Programs.rerun \"   \"")]);
    assert_caught(
        &outcome,
        "InvalidArgument",
        "rerun",
        "`source` must not be blank",
    );
    assert_eq!(outcome.rerun, None);
}

#[test]
fn a_second_handover_from_one_program_is_refused() {
    let (outcome, _log) = canned(&[
        &format!("Gg.Programs.rerun {}", purs_string(EARLIER)),
        &caught("Gg.Programs.rerun \"module Main where\\nmain = pure unit\\n\""),
    ]);
    assert_caught(
        &outcome,
        "Refused",
        "rerun",
        "this program already handed one over",
    );
    assert_eq!(outcome.rerun.as_deref(), Some(EARLIER));
}

// ---------------------------------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------------------------------

#[test]
fn a_search_hands_back_its_page_and_leaves_a_view() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome).finding(
        "Gg.Files.readFile",
        DocKind::Function,
        "Gg.Files",
        "readFile",
        "Read a workspace file.",
    );
    let outcome = over(
        &[
            "page <- Gg.Docs.search { query: \"read\" }",
            "Console.log (show page.total <> \" \" <> show page.offset)",
            "Data.Foldable.for_ page.hits \\hit -> Console.log (hit.key <> \" \" <> show hit.kind <> \" \" <> hit.module <> \" \" <> hit.name <> \" \" <> hit.summary)",
        ],
        api,
    );
    assert_eq!(
        logs(&outcome),
        [
            "1 0",
            "Gg.Files.readFile FunctionEntry Gg.Files readFile Read a workspace file.",
        ]
    );
    assert_eq!(opened(&outcome), [(ViewKind::Search, SEARCH_RESULTS_VIEW)]);
}

#[test]
fn a_search_naming_neither_a_query_nor_a_filter_is_an_argument_error() {
    let message = "`Gg.Docs.search` needs a query, a module, a type or a kind";
    let (outcome, _log) = refused_views(
        &[&caught("Gg.Docs.search {}")],
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "InvalidArgument", "search", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error() {
    let message = "`limit` must be at least 1; leave it out for the default page of 20";
    let (outcome, _log) = refused_views(
        &[&caught("Gg.Docs.search { query: \"read\", limit: 0 }")],
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "InvalidArgument", "search", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn closing_a_documentation_view_reports_how_many_went() {
    let log = CallLog::default();
    let outcome = over(
        &[
            "Gg.Views.openDocsView \"readFile\"",
            "closed <- Gg.Docs.close \"readFile\"",
            "Console.log (show closed)",
        ],
        FakeOperationApi::with(&log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["1"]);
}

#[test]
fn closing_documentation_views_without_the_capability_is_unavailable() {
    let (outcome, _log) = run_as(
        &program(&[&caught("Gg.Docs.close \"Gg.Files.readFile\"")]),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_caught_naming(
        &outcome,
        "Unavailable",
        "close",
        "`Gg.Docs.close` is not available",
    );
}

#[test]
fn closing_every_documentation_view_reports_how_many_went() {
    let log = CallLog::default();
    let outcome = over(
        &[
            "Gg.Views.openDocsView \"readFile\"",
            "Gg.Views.openDocsView \"writeFile\"",
            "closed <- Gg.Docs.closeAll",
            "Console.log (show closed)",
        ],
        FakeOperationApi::with(&log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["2"]);
}

// ---------------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------------

#[test]
fn a_file_view_hands_back_the_text_variant_and_opens_a_view() {
    let (outcome, log) = canned(&[
        "read <- Gg.Views.openFile \"notes.md\" {}",
        "case read of\n    \
         Gg.Files.TextFile file -> Console.log (show file.contents <> \" \" <> show file.firstLine \
         <> \" \" <> show file.lastLine <> \" \" <> show file.totalLines <> \" \" <> show file.byteTruncated)\n    \
         Gg.Files.ImageFile _ -> Console.log \"an image\"",
    ]);
    assert_eq!(
        logs(&outcome),
        ["\"contents of notes.md\\nline two\\n\" 1 2 2 false"]
    );
    assert_eq!(opened(&outcome), [(ViewKind::File, "notes.md")]);
    assert_eq!(log.names(), ["read_file"]);
}

#[test]
fn a_file_view_of_an_image_hands_back_the_image_variant() {
    let (outcome, _log) = canned(&[
        "read <- Gg.Views.openFile \"logo.png\" {}",
        "case read of\n    \
         Gg.Files.TextFile _ -> Console.log \"text\"\n    \
         Gg.Files.ImageFile picture -> Console.log (picture.label <> \" \" <> show picture.bytes)",
    ]);
    assert_eq!(logs(&outcome), ["PNG 1234"]);
    assert_eq!(opened(&outcome), [(ViewKind::File, "logo.png")]);
}

#[test]
fn a_file_view_of_a_path_that_is_not_there_is_not_found() {
    let (outcome, _log) = failing(
        &[&caught("Gg.Views.openFile \"gone.md\" {}")],
        "read_file",
        ToolFailure::NotFound,
        "no such file: gone.md",
    );
    assert_caught(&outcome, "NotFound", "open_file", "no such file: gone.md");
    assert!(opened(&outcome).is_empty(), "no view is opened");
}

#[test]
fn a_file_view_over_the_byte_cap_is_limit_exceeded() {
    let message = "view body exceeds max size (98304 bytes; max 65536); open fewer lines with \
                   `offset`/`limit`";
    let (outcome, log) = refused_views(
        &[&caught("Gg.Views.openFile \"big.log\" {}")],
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "LimitExceeded", "open_file", message);
    assert!(opened(&outcome).is_empty(), "no view is opened");
    assert!(
        log.calls().is_empty(),
        "nothing was read: {:?}",
        log.calls()
    );
}

#[test]
fn a_max_line_chars_of_zero_is_an_argument_error() {
    let message = "`maxLineChars` must be at least 1";
    let (outcome, _log) = refused_views(
        &[&caught(
            "Gg.Views.openFile \"notes.md\" { maxLineChars: 0 }",
        )],
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "InvalidArgument", "open_file", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_max_line_chars_outside_the_range_is_refused_before_the_call() {
    let (outcome, log) = canned(&[&caught(
        "Gg.Views.openFile \"notes.md\" { maxLineChars: -1 }",
    )]);
    assert_caught_naming(&outcome, "InvalidArgument", "open_file", "`maxLineChars`");
    assert!(log.calls().is_empty(), "nothing crossed: {:?}", log.calls());
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_text_view_opens_under_the_label_it_was_given() {
    let (outcome, _log) = canned(&["Gg.Views.openText \"summary\" \"eight files, two failing\""]);
    assert!(logs(&outcome).is_empty());
    assert_eq!(opened(&outcome), [(ViewKind::Text, "summary")]);
}

#[test]
fn an_empty_text_view_label_is_an_argument_error() {
    let (outcome, _log) = canned(&[&caught("Gg.Views.openText \"\" \"body\"")]);
    assert_caught(
        &outcome,
        "InvalidArgument",
        "open_text",
        "a view needs a non-empty label",
    );
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_text_view_body_over_the_cap_is_limit_exceeded() {
    let message = "view body exceeds max size (98304 bytes; max 65536)";
    let (outcome, _log) = refused_views(
        &[&caught(
            "Gg.Views.openText \"summary\" \"eight files, two failing\"",
        )],
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "LimitExceeded", "open_text", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_text_view_label_over_the_cap_is_limit_exceeded() {
    let message = "label exceeds max length (300 bytes; max 256)";
    let (outcome, _log) = refused_views(
        &[&caught(
            "Gg.Views.openText \"summary\" \"eight files, two failing\"",
        )],
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "LimitExceeded", "open_text", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn a_documentation_view_opens_under_the_name_it_was_asked_for() {
    let (outcome, _log) = canned(&["Gg.Views.openDocsView \"readFile\""]);
    assert!(logs(&outcome).is_empty());
    assert_eq!(opened(&outcome), [(ViewKind::Docs, "readFile")]);
}

#[test]
fn a_documentation_name_gg_does_not_hold_is_not_found() {
    let message = "no documentation for `readFiel`; `Gg.Docs.search` lists what this session binds";
    let (outcome, _log) = refused_views(
        &[&caught("Gg.Views.openDocsView \"readFiel\"")],
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "NotFound", "open_docs_view", message);
    assert!(opened(&outcome).is_empty());
}

#[test]
fn closing_a_view_reports_how_many_went() {
    let (outcome, _log) = canned(&[
        "Gg.Views.openText \"summary\" \"eight files, two failing\"",
        "closed <- Gg.Views.close \"summary\"",
        "missing <- Gg.Views.close \"never opened\"",
        "Console.log (show closed <> \" \" <> show missing)",
    ]);
    assert_eq!(logs(&outcome), ["1 0"]);
    assert_eq!(outcome.views_closed, ["summary"]);
}

#[test]
fn an_empty_view_selector_is_an_argument_error() {
    let (outcome, _log) = canned(&[&caught("Gg.Views.close \"\"")]);
    assert_caught(
        &outcome,
        "InvalidArgument",
        "close",
        "`view.close` needs a non-empty selector",
    );
}

#[test]
fn closing_a_view_without_agent_managed_context_is_unavailable() {
    let log = CallLog::default();
    let capabilities: Vec<String> = all_capabilities()
        .into_iter()
        .filter(|capability| capability != CAPABILITY_AGENT_MANAGED_CONTEXT)
        .collect();
    let withheld = capability_operations([CAPABILITY_AGENT_MANAGED_CONTEXT]);
    let operations: Vec<OperationId> = all_operations()
        .into_iter()
        .filter(|id| !withheld.contains(id))
        .collect();
    let outcome = over_scoped(
        &[&caught("Gg.Views.close \"summary\"")],
        &capabilities,
        &operations,
        RunEnding::None,
        FakeOperationApi::with(&log, canned_outcome),
    );
    assert_caught_naming(
        &outcome,
        "Unavailable",
        "close",
        "`Gg.Views.close` is not available",
    );
}

// ---------------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------------

#[test]
fn a_finished_session_carries_the_summary_the_model_wrote() {
    let (outcome, _log) = as_role(
        &["Gg.Session.finish \"wrote the lexer and its tests\""],
        EndingRole::Standard,
    );
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        ending_of(&outcome),
        &Ending::Finished {
            summary: "wrote the lexer and its tests".to_string()
        }
    );
}

#[test]
fn finishing_under_a_review_role_is_unavailable() {
    let (outcome, _log) = as_role(&[&caught("Gg.Session.finish \"done\"")], EndingRole::Review);
    assert_caught_naming(
        &outcome,
        "Unavailable",
        "finish",
        "`Gg.Session.finish` is not available",
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn an_approval_ends_the_session_with_no_items() {
    let (outcome, _log) = as_role(&["Gg.Session.approve"], EndingRole::Review);
    assert!(logs(&outcome).is_empty());
    assert_eq!(ending_of(&outcome), &Ending::Approved);
}

#[test]
fn approving_under_a_standard_role_is_unavailable() {
    let (outcome, _log) = as_role(&[&caught("Gg.Session.approve")], EndingRole::Standard);
    assert_caught_naming(
        &outcome,
        "Unavailable",
        "approve",
        "`Gg.Session.approve` is not available",
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_change_request_carries_every_item() {
    let (outcome, _log) = as_role(
        &["Gg.Session.requestChanges [ \"widen the test\", \"name the file\" ]"],
        EndingRole::Review,
    );
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        ending_of(&outcome),
        &Ending::ChangesRequested {
            items: vec!["widen the test".to_string(), "name the file".to_string()]
        }
    );
}

#[test]
fn an_empty_change_request_is_an_argument_error() {
    let (outcome, _log) = as_role(
        &[&caught("Gg.Session.requestChanges []")],
        EndingRole::Review,
    );
    assert_caught_naming(
        &outcome,
        "InvalidArgument",
        "request_changes",
        "`Gg.Session.requestChanges` requires at least one change",
    );
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

#[test]
fn requesting_changes_under_a_standard_role_is_unavailable() {
    let (outcome, _log) = as_role(
        &[&caught("Gg.Session.requestChanges [ \"widen the test\" ]")],
        EndingRole::Standard,
    );
    assert_caught_naming(
        &outcome,
        "Unavailable",
        "request_changes",
        "`Gg.Session.requestChanges` is not available",
    );
    assert!(outcome.completion.is_none());
}

// ---------------------------------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------------------------------

/// The capture keeps the **tail** past its line cap and counts what it let go — the end of a
/// program's output is the part written to be read.
#[test]
fn a_program_that_logs_past_the_line_cap_keeps_the_later_lines() {
    let written = MAX_LOG_LINES + 10;
    let (outcome, _log) = canned(&[&format!(
        "Data.Foldable.for_ (Data.Array.range 1 {written}) \\line -> Console.log (\"line \" <> show line)"
    )]);
    let kept = logs(&outcome);
    assert_eq!(kept.len(), MAX_LOG_LINES);
    assert_eq!(kept[0], "line 11", "the first ten were let go");
    assert_eq!(kept[MAX_LOG_LINES - 1], format!("line {written}"));
    assert_eq!(outcome.logs_suppressed, 10);
}

/// `feedback.note-return`: the entry gg synthesizes discards `main`'s value, so nothing is handed
/// back and the model is told nothing extra.
#[test]
fn a_main_that_returns_a_value_has_it_discarded_without_a_note() {
    let source = "module Main where\n\
                  \n\
                  import Prelude\n\
                  \n\
                  import Data.Either (Either(..))\n\
                  import Effect (Effect)\n\
                  import Effect.Class.Console as Console\n\
                  \n\
                  main :: Effect (Either String Int)\n\
                  main = do\n\
                  \x20 Console.log \"before\"\n\
                  \x20 pure (Left \"not done yet\")\n";
    let (outcome, _log) = run_as(source, &[], &[], RunEnding::None, false, canned_outcome);
    assert_eq!(logs(&outcome), ["before"]);
    assert!(!outcome.returned_value, "no value was handed over");
    assert_eq!(outcome.deferred_note, None);
}

/// `feedback.report-deferred`: a microtask queued by the program's own bundle runs inside the turn,
/// so its gg call reaches dispatch and there is no deferred note.
#[test]
fn work_this_guest_defers_runs_inside_the_turn() {
    let bundle = prepare(&program(&["Console.log \"first\""]));
    let program = format!(
        "{bundle}\nimport * as deferredGg from \"gg\";\n\
         Promise.resolve().then(() => deferredGg.files.writeFile(\"late.txt\", \"after the program\"));\n"
    );
    let (outcome, log) = evaluate_js(&program, &all_operations(), &[], canned_outcome);
    assert_eq!(logs(&outcome), ["first"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "the deferred call reached dispatch inside the turn"
    );
    assert_eq!(outcome.deferred_note, None);
}

/// `feedback.report-module-error`: a code module on this arm is compiled into the program's own
/// project, so a module value that raises when forced is the program's own failure, located in the
/// module's file, and the module channel stays empty.
#[test]
fn a_module_that_fails_when_it_is_forced_is_the_programs_own_failure() {
    let modules = [CodeModule {
        name: "Helpers".to_string(),
        source: "module Helpers (label) where\n\
                 \n\
                 import Prelude\n\
                 \n\
                 import Effect.Exception.Unsafe (unsafeThrow)\n\
                 \n\
                 label :: Unit -> String\n\
                 label _ = unsafeThrow \"the helper has no label\"\n"
            .to_string(),
    }];
    let source = program(&["Console.log (Helpers.label unit)"]).replace(
        "import Effect (Effect)\n",
        "import Effect (Effect)\nimport Lib.Helpers as Helpers\n",
    );
    let (outcome, _log) = run_as(
        &source,
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    let reported = trapped(&outcome);
    assert!(
        reported.contains("the helper has no label") && reported.contains("Lib.Helpers.purs"),
        "the failure is the program's own, located in the module's file: {reported}"
    );
    assert!(
        outcome.module_errors.is_empty(),
        "and nothing is reported through the module channel: {:?}",
        outcome.module_errors
    );
}
