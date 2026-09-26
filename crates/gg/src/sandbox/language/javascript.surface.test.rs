//! **The session-side SDK, driven from JavaScript programs** — `context`, `delegation`, `programs`,
//! `docs`, `views` and `session`, plus the `feedback` channel underneath them.
//!
//! # Why this file exists beside the workspace one
//!
//! These six modules are the half of gg's responses-as-code surface that **no workspace tool
//! answers**. Half of it reaches no gg tool at all — a `views.close` is not a tool call, a
//! `session.approve` is not a tool call, a `programs.get` is a read of the loop's own library — and
//! the half that does reach one reaches a tool the *loop* services rather than one a workspace does.
//! So what an arm gets right or wrong about them is invisible from the crossing table and invisible
//! from the host-side membrane tests, and the only way to see it is to write the program a model
//! would write and read back what came out.
//!
//! One short `#[test]` per case, named as the sentence it proves, for the reason
//! [the substrate file](super::substrate) gives for *not* doing that with the five observation
//! programs it holds: these are facts about individual calls rather than about the arm, and a
//! hundred of them folded into one function would hide every one of them behind whichever assertion
//! tripped first.
//!
//! # The two shapes, stated once
//!
//! A **successful** call asserts what the call left behind: the arguments the membrane composed
//! ([`CallLog::args`]), the value the program logged ([`logged_json`]), and the view, the ending or
//! the hand-over the [outcome](SandboxOutcome) carries.
//!
//! A **refusal** is caught in the program and logged as `{ code, operation, message }` off the
//! `ApiError` the SDK exports — [`catching`] writes that program and [`assert_caught`] reads it. A
//! refusal raised host-side carries gg's own key for the operation (`evict_file_view`,
//! `open_text`); one raised by the SDK before anything crossed carries the **SDK function's** name
//! (`archiveThread`, `spawnSubagent`, `openDocsView`), because nothing crossed for gg to have an
//! operation for — and those cases assert the call log is empty.
//!
//! # Nothing here reaches a model, a provider or a disk
//!
//! Every answer is synthesized: a tool-backed failure by a responder that answers that one call
//! with that class, an api-raised one by the [double](FakeOperationApi)'s own guards, and
//! `archive_thread`'s by handing the composed arguments to gg's
//! [own guard](crate::tools::ArchiveThreadTool::archive) — so the sentence under test is
//! production's rather than one this file wrote.

use serde_json::{Value, json};

use test_cabinet_core::gg::{
    CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_READ_FILE,
};

use super::substrate::{logs, run, run_api, run_scoped, run_with, thrown};
use crate::context::{SEARCH_RESULTS_VIEW, ViewKind};
use crate::docs::DocKind;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_operations, all_operations_without, canned_outcome,
};
use crate::sandbox::membrane::CodeModule;
use crate::sandbox::membrane::capture::{MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::operations::{DELEGATION_TRANSITION_STATE, OperationId};
use crate::sandbox::{RunEnding, SandboxOutcome};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveSearchData, FileTextData, MAX_ARCHIVE_RANGES,
    SubagentResultData, ToolFailure, ToolOutcome,
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// Run `program` with every call granted and `responder` answering each one — the seam a
/// tool-backed failure is injected through.
fn responding(
    program: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let outcome = run_api(
        program,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        FakeOperationApi::with(&log, responder),
    );
    (outcome, log)
}

/// [`responding`] with the one injected answer spelled as the **failure gg would have written**:
/// each `@throws` line on the SDK names a class and a cause, and the honest way to drive one from a
/// program is to have that tool answer with that class and let the membrane raise it.
fn failing(
    program: &str,
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    responding(program, move |name, args| {
        if name == tool {
            ToolOutcome::failed(failure, message)
        } else {
            canned_outcome(name, args)
        }
    })
}

/// [`failing`]'s arm for a call that **succeeded** carrying something the canned table does not
/// offer — an empty hit list, a second child, a file too wide for a view.
fn answering(program: &str, tool: &'static str, outcome: ToolOutcome) -> (SandboxOutcome, CallLog) {
    responding(program, move |name, args| {
        if name == tool {
            outcome.clone()
        } else {
            canned_outcome(name, args)
        }
    })
}

/// Run `program` against the [double](FakeOperationApi) the case built — a seeded library, a seeded
/// catalogue, a seeded hit — with every call granted.
fn over(program: &str, api: FakeOperationApi) -> SandboxOutcome {
    run_api(
        program,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        api,
    )
}

/// Run `program` in `role`'s [ending group](EndingRole), which is the axis the three session calls
/// are bound on: a reviewer's program is a different **run**, not a different call.
fn as_role(program: &str, role: EndingRole) -> SandboxOutcome {
    let log = CallLog::default();
    run_api(
        program,
        &all_operations(),
        RunEnding::Role(role),
        FakeOperationApi::new(&log),
    )
}

/// [`all_operations`] less the one `withheld` names — the only way to withhold an operation no
/// capability buys, which is what an agent standing in no state machine has.
fn all_operations_but(withheld: OperationId) -> Vec<OperationId> {
    all_operations()
        .into_iter()
        .filter(|id| *id != withheld)
        .collect()
}

/// A responder handing `archive_thread`'s composed arguments to **gg's own guard** and answering
/// everything else from the canned table, so the sentence a span refusal carries is production's.
///
/// A *successful* archive is deliberately not driven through it: the guard only validates, and the
/// [`ApiData::Reclaim`] a program reads back is attached by the loop afterwards.
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

/// The program a model writes to make one call and report the failure it caught: the `code` it
/// branches on, the `operation` that failed and the sentence gg wrote.
///
/// A call that does **not** throw logs a line saying so, which fails [`assert_caught`] loudly
/// rather than passing in silence.
fn catching(call: &str) -> String {
    format!(
        r#"import * as gg from "gg";
try {{
  {call};
  console.log(JSON.stringify({{ threw: false }}));
}} catch (error) {{
  console.log(JSON.stringify({{ code: error.code, operation: error.operation,
    message: error.message }}));
}}
"#
    )
}

/// Assert what a [`catching`] program read off the `ApiError`: the class, the call it names, and
/// that gg's own words survived the crossing.
fn assert_caught(outcome: &SandboxOutcome, code: &str, operation: &str, fragment: &str) {
    let caught = logged_json(outcome);
    assert_eq!(
        caught["code"],
        json!(code),
        "the program should have caught a `{code}` failure: {caught}"
    );
    assert_eq!(
        caught["operation"],
        json!(operation),
        "and the failure names the call that failed: {caught}"
    );
    assert!(
        caught["message"]
            .as_str()
            .is_some_and(|message| message.contains(fragment)),
        "gg's own words must reach the program, {fragment:?} among them: {caught}"
    );
}

/// The one line a program logged, parsed as JSON — the shape a program hands a value back in, now
/// that a returned one goes nowhere.
fn logged_json(outcome: &SandboxOutcome) -> Value {
    let lines = logs(outcome);
    assert_eq!(
        lines.len(),
        1,
        "expected exactly one logged line: {lines:?}"
    );
    serde_json::from_str(&lines[0]).unwrap_or_else(|error| {
        panic!(
            "the program's one log line is not JSON ({error}): {}",
            lines[0]
        )
    })
}

/// The selectors a run opened views under, with the kind each was filed as.
fn opened(outcome: &SandboxOutcome) -> Vec<(ViewKind, &str)> {
    outcome
        .views_opened
        .iter()
        .map(|view| (view.kind, view.selector.as_str()))
        .collect()
}

/// The ending a program declared, insisting it declared one.
fn ending_of(outcome: &SandboxOutcome) -> &Ending {
    outcome
        .completion
        .as_ref()
        .map(|completion| &completion.ending)
        .unwrap_or_else(|| panic!("the program declared no ending: {:?}", outcome.result))
}

/// Assert `operation` is on the run's [refusal roster](SandboxOutcome::refusals) — the list a
/// comparison of two configurations counts "what did the model reach for that this run withholds"
/// off.
fn assert_on_the_roster(outcome: &SandboxOutcome, operation: &str) {
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == operation),
        "a withheld reach is recorded under gg's own id for it: {:?}",
        outcome.refusals
    );
}

// ---------------------------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------------------------

/// The path crosses under its own key, and the report the loop attached comes back as a value the
/// program reads field by field.
#[test]
fn evicting_one_path_reports_what_it_freed() {
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
fn an_empty_path_is_refused_on_the_argument() {
    let (outcome, _) = failing(
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

/// The model-facing span is `{ from, to }` and the membrane's record is `{ start, end }`, because
/// `from` is a WIT keyword — so the one thing worth asserting is that the **order survived** the
/// rename: a lowering that swapped the ends would compose the same pair backwards.
#[test]
fn archiving_a_span_lowers_from_and_to_onto_start_and_end() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const freed = gg.context.archiveThread([{ from: 4, to: 19 }, { from: 22, to: 25 }]);\n",
        "console.log(JSON.stringify({ items: freed.items, tokens: freed.reclaimedTokens }));\n",
    ));
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19], [22, 25]] })),
        "each span arrived as its two ends, first one first"
    );
    assert_eq!(logged_json(&outcome), json!({ "items": 2, "tokens": 300 }));
}

/// An empty list is a real program a model writes — a filter that matched nothing — and gg refuses
/// it rather than archiving nothing and reporting success.
#[test]
fn an_empty_span_list_is_refused() {
    let (outcome, log) = responding(&catching("gg.context.archiveThread([])"), archiving);
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
    let (outcome, log) = responding(
        &catching(&format!("gg.context.archiveThread([{}])", spans.join(", "))),
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
    let (outcome, log) = responding(
        &catching("gg.context.archiveThread([{ from: 19, to: 4 }])"),
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

/// **The SDK's own guard.** A span with one end is a shape the membrane could not carry, so it is
/// refused where the program wrote it — under the SDK function's name, because nothing crossed for
/// gg to have an operation for.
#[test]
fn a_span_missing_a_bound_is_refused_before_the_host_sees_it() {
    let (outcome, log) = run(&catching("gg.context.archiveThread([{ from: 4 }])"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "archiveThread",
        "every entry of `ranges` needs both `from` and `to`",
    );
    assert!(
        log.names().is_empty(),
        "a half-written span never reached gg: {:?}",
        log.names()
    );
}

#[test]
fn an_archive_search_reads_back_its_hits() {
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
fn a_search_that_matches_nothing_is_an_empty_hit_list() {
    let (outcome, _) = answering(
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
fn an_empty_archive_is_distinguished_from_no_match() {
    let (outcome, _) = answering(
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
fn an_empty_query_is_refused() {
    let (outcome, _) = failing(
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

/// A compaction is **registered**, not performed: the loop rewrites the window once the program has
/// ended, so the call returns and the lines after it still run.
#[test]
fn a_compaction_is_registered_and_the_program_runs_on() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.context.compact(\"the parser is done; the lexer is not\", [\"src/lexer.ts\"]);\n",
        "console.log(\"ran on\");\n",
    ));
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({
            "summary": "the parser is done; the lexer is not",
            "files": ["src/lexer.ts"],
        }))
    );
}

#[test]
fn a_blank_summary_is_refused() {
    let (outcome, _) = failing(
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

// ---------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------

/// The other arm of the brief — the prompt arm is driven in
/// [the substrate file](super::substrate) — and an issue id crosses under its **own** key with the
/// prompt absent, rather than the two being optional strings a program could fill in together.
#[test]
fn a_subagent_spawned_from_an_issue_sends_no_prompt() {
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

/// **Refused by the SDK, before the crossing** — so the failure names the SDK function rather than
/// an operation. The native JSON schema declares both fields optional and rejects "neither" only at
/// dispatch, which is the wasted call this guard exists to save.
#[test]
fn a_brief_that_is_neither_a_prompt_nor_an_issue_is_refused() {
    let (outcome, log) = run(&catching(
        "gg.delegation.spawnSubagent({ agent: \"subagent\" })",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "spawnSubagent",
        "expected exactly one of `prompt` or `issueId`",
    );
    assert!(log.names().is_empty(), "nothing crossed: {:?}", log.names());
}

/// A brief carrying **both** is a shape this arm has no type checker to refuse, so the SDK refuses it
/// before the crossing — a brief is never both, and lowering either half would guess at what the
/// program meant.
#[test]
fn a_brief_that_is_both_a_prompt_and_an_issue_is_refused() {
    let (outcome, log) = run(&catching(concat!(
        "gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \"write the lexer\",\n",
        "  issueId: \"EPIC-1\" })",
    )));
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
    let (outcome, _) = failing(
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
fn the_delegation_depth_cap_is_limit_exceeded() {
    let (outcome, _) = failing(
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
fn waiting_on_named_children_collects_them_in_dispatch_order() {
    let (outcome, log) = answering(
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

/// A child stopped by a gg defect produced no ending at all, and reports **none** — `undefined`
/// rather than a word the program would branch on and be wrong about.
#[test]
fn a_child_with_no_ending_reports_no_status() {
    let (outcome, _) = answering(
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

/// **Every ending, in one program.** WIT identifiers carry no underscore, so the membrane says
/// `timed-out` where everything else gg reports says `timed_out` — and a literal that does not match
/// is not an error, it is a branch that quietly never runs. The only way to see a word this arm
/// failed to translate is to drive one child per ending at once.
#[test]
fn every_agent_ending_reaches_the_program_as_its_own_value() {
    let endings = [
        (AgentStatusData::Completed, "completed"),
        (AgentStatusData::Exhausted, "exhausted"),
        (AgentStatusData::TimedOut, "timed-out"),
        (AgentStatusData::ModelError, "model-error"),
        (AgentStatusData::AuthError, "auth-error"),
        (AgentStatusData::LimitExceeded, "limit-exceeded"),
    ];
    let (outcome, _) = answering(
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

#[test]
fn an_unknown_child_id_is_not_found() {
    let (outcome, _) = failing(
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
    let (outcome, _) = failing(
        &catching("gg.delegation.sendMessage(\"agent-9\", \"prefer the simpler parser\")"),
        "send_message",
        ToolFailure::NotFound,
        "`send_message`: no agent `agent-9`",
    );
    assert_caught(&outcome, "not-found", "send_message", "no agent `agent-9`");
}

#[test]
fn a_message_to_a_child_that_returned_is_a_conflict() {
    let (outcome, _) = failing(
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
fn a_transition_is_registered_and_the_program_runs_on() {
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
    let (outcome, _) = failing(
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

/// **The surface's one positional binding.** A transition is bought by where an instance stands
/// rather than by a capability, so an agent standing in no machine — or in a terminal state — has
/// nowhere to go, and the only way to withhold the call is to take it out of the allowlist.
#[test]
fn a_transition_with_nowhere_to_go_is_unavailable() {
    let (outcome, log) = run_with(
        &catching("gg.delegation.transitionState(\"review\")"),
        &all_operations_but(DELEGATION_TRANSITION_STATE),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "transition_state",
        "`gg.delegation.transitionState` is not available.",
    );
    assert_on_the_roster(&outcome, "delegation.transition_state");
    assert!(
        log.names().is_empty(),
        "and nothing reached gg's dispatch: {:?}",
        log.names()
    );
}

/// An `exec` is the same registered succession a transition is, declared by the model instead of by
/// a machine — so it returns and the program runs to its end, which is the deferred-succession
/// contract the API surface states.
#[test]
fn an_exec_returns_and_the_program_runs_to_its_end() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.delegation.exec(\"reviewer\", \"review the parser\");\n",
        "console.log(\"ran on\");\n",
    ));
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "reviewer", "prompt": "review the parser" }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_refused() {
    let (outcome, _) = failing(
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
/// its machine on cannot then hand the session to another agent: they share one slot, and the first
/// declaration is the one gg kept.
#[test]
fn a_second_succession_in_one_turn_is_refused() {
    let mut declared = false;
    let (outcome, log) = responding(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.delegation.transitionState(\"review\");\n",
            "try { gg.delegation.exec(\"reviewer\"); }\n",
            "catch (error) {\n",
            "  console.log(JSON.stringify({ code: error.code, operation: error.operation })); }\n",
        ),
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

/// A fork's handle is real **at once** — the id is minted at the call so the program can name the
/// copy — even though the copy itself starts only when the turn's results are recorded.
#[test]
fn a_forked_copy_reports_its_id_immediately() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const copy = gg.delegation.fork(\"try the other fix\");\n",
        "console.log(JSON.stringify({ id: copy.id, slot: copy.slot, model: copy.modelId }));\n",
    ));
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "id": "agent-2", "slot": "primary", "model": "test/model" })
    );
}

#[test]
fn forking_past_the_depth_cap_is_limit_exceeded() {
    let (outcome, _) = failing(
        &catching("gg.delegation.fork(\"try the other fix\")"),
        "fork",
        ToolFailure::LimitExceeded,
        "`fork`: this run's delegation depth cap of 2 is already reached",
    );
    assert_caught(&outcome, "limit-exceeded", "fork", "delegation depth cap");
}

// ---------------------------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------------------------

/// A summary carries the program's **shape** and never its source: `get` is how a program reaches
/// for one, which is what keeps a history of forty programs from being forty programs of context.
#[test]
fn the_history_lists_the_programs_the_library_holds() {
    let log = CallLog::default();
    let outcome = over(
        concat!(
            "import * as gg from \"gg\";\n",
            "const held = gg.programs.history()[0];\n",
            "console.log(JSON.stringify({ id: held.id, turn: held.turn, lines: held.lines,\n",
            "  chars: held.chars, ok: held.ok }));\n",
        ),
        FakeOperationApi::new(&log).with_program("k3p9", 3, "const x = 1;\nconsole.log(x);"),
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "id": "k3p9", "turn": 3, "lines": 2, "chars": 28, "ok": true })
    );
}

/// The honest answer on the first turn of every session, and the reason the call is a result rather
/// than a bare list: "nothing has run yet" and "this run keeps no library" are different facts.
#[test]
fn an_empty_history_is_an_empty_list() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.programs.history()));\n",
    ));
    assert_eq!(logged_json(&outcome), json!([]));
}

#[test]
fn a_history_without_a_library_is_unavailable() {
    let (outcome, log) = run_with(
        &catching("gg.programs.history()"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "history",
        "`gg.programs.history` is not available.",
    );
    assert_on_the_roster(&outcome, "programs.history");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_program_source_is_read_back_by_its_id() {
    let log = CallLog::default();
    let outcome = over(
        "import * as gg from \"gg\";\nconsole.log(gg.programs.get(\"bbbb\"));\n",
        FakeOperationApi::new(&log)
            .with_program("aaaa", 1, "console.log('first');")
            .with_program("bbbb", 2, "console.log('second');"),
    );
    assert_eq!(
        logs(&outcome),
        ["console.log('second');"],
        "the source comes back verbatim, under the id that ran it"
    );
}

/// The miss **names what is held**, which is what makes it recoverable on the same turn rather than
/// a turn spent guessing which of four ids was meant.
#[test]
fn an_id_the_library_never_issued_is_not_found_naming_what_is_held() {
    let log = CallLog::default();
    let outcome = over(
        &catching("gg.programs.get(\"zzzz\")"),
        FakeOperationApi::new(&log).with_program("aaaa", 1, "console.log('first');"),
    );
    assert_caught(
        &outcome,
        "not-found",
        "get",
        "no program is kept under the id `zzzz`",
    );
    let said = logged_json(&outcome)["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        said.contains("`aaaa` (turn 1)"),
        "the ids still held are named: {said}"
    );
}

/// The **other** way to miss, with the same remedy and therefore the same answer: an id this
/// session really was issued, whose program the retention has since dropped.
#[test]
fn an_id_whose_program_was_dropped_is_not_found() {
    let log = CallLog::default();
    let outcome = over(
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
        "the ids that survived the retention are named: {said}"
    );
    assert!(
        !said.contains("(turn 1)"),
        "and the dropped one is not among them: {said}"
    );
}

/// **The capability is read before the argument.** An agent that keeps no library has one problem
/// rather than two, so it is told that rather than told its id was blank.
#[test]
fn a_get_without_a_library_is_unavailable() {
    let (outcome, log) = run_with(
        &catching("gg.programs.get(\"\")"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "get",
        "`gg.programs.get` is not available.",
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
}

/// A hand-over is registered like an ending is: the host owns the flag, so there is no unwind to
/// reason about and the program runs to its end.
#[test]
fn a_hand_over_is_registered_and_the_program_runs_on() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.programs.rerun(\"console.log('the replacement');\");\n",
        "console.log(\"still running\");\n",
    ));
    assert_eq!(logs(&outcome), ["still running"]);
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("console.log('the replacement');"),
        "the source survives out of the store for the loop to run"
    );
}

#[test]
fn a_blank_source_is_refused_rather_than_handed_to_a_compiler() {
    let (outcome, _) = run(&catching("gg.programs.rerun(\"   \")"));
    assert_caught(&outcome, "invalid-argument", "rerun", "must not be blank");
    assert!(outcome.rerun.is_none(), "nothing is compiled");
    assert!(
        outcome.refusals.is_empty(),
        "and unlike a gate refusal this one is not a withheld reach: {:?}",
        outcome.refusals
    );
}

/// **The first hand-over stands.** A silently replaced one would be a change the model cannot see,
/// so the second is refused and the first is the source the outcome carries.
#[test]
fn the_first_hand_over_stands_and_a_second_is_refused() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.programs.rerun(\"console.log('the first');\");\n",
        "try { gg.programs.rerun(\"console.log('the second');\"); }\n",
        "catch (error) {\n",
        "  console.log(JSON.stringify({ code: error.code, operation: error.operation })); }\n",
    ));
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

/// A failed program cancels the hand-over along with everything else it decided, and the model is
/// told the replacement was not run rather than left to infer it from a turn that looks ordinary.
#[test]
fn a_hand_over_is_revoked_when_the_program_then_fails() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.programs.rerun(\"console.log('never');\");\n",
        "throw new Error(\"the checks did not pass\");\n",
    ));
    assert!(outcome.rerun.is_none());
    assert!(outcome.revoked_rerun, "the model is told it was cancelled");
    assert!(
        thrown(&outcome, "the program threw after handing over")
            .message
            .contains("the checks did not pass"),
        "{:?}",
        outcome.result
    );
}

#[test]
fn a_rerun_without_a_library_is_unavailable() {
    let (outcome, _) = run_with(
        &catching("gg.programs.rerun(\"console.log('again');\")"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "rerun",
        "`gg.programs.rerun` is not available.",
    );
    assert!(outcome.rerun.is_none());
    assert_on_the_roster(&outcome, "programs.rerun");
}

// ---------------------------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------------------------

/// **The call the whole discovery loop begins at.** The system prompt names no function, so a run
/// that could withhold this could withhold an agent's knowledge of its own capabilities — which is
/// why it is bound whatever a run enables, and why this program is granted nothing at all.
#[test]
fn a_search_answers_an_agent_granted_nothing() {
    let log = CallLog::default();
    let outcome = run_api(
        concat!(
            "import * as gg from \"gg\";\n",
            "const page = gg.docs.search({ query: \"view\" });\n",
            "console.log(JSON.stringify({ total: page.total, offset: page.offset,\n",
            "  hits: page.hits.length }));\n",
        ),
        &[],
        RunEnding::Role(EndingRole::Standard),
        FakeOperationApi::new(&log),
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "total": 0, "offset": 0, "hits": 0 }),
        "an empty page is an answer; the refusal is the other thing"
    );
}

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

/// gg **names the three** rather than only refusing, which is what makes the mistake recoverable on
/// the same turn.
#[test]
fn an_unrecognised_kind_is_refused() {
    let (outcome, _) = run(&catching(
        "gg.docs.search({ query: \"view\", kind: \"funciton\" })",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "use `module`, `function` or `type`",
    );
}

#[test]
fn a_limit_of_zero_is_refused() {
    let (outcome, _) = run(&catching("gg.docs.search({ query: \"view\", limit: 0 })"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "a page of zero hits would answer nothing",
    );
}

/// The first program on this arm to call `docs.close` at all: a documentation view is taken back
/// out of the window by the key it was opened under, and the call reports what it removed.
#[test]
fn closing_a_docs_view_reports_what_it_closed() {
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
fn a_key_that_names_no_open_view_closes_nothing() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.docs.close(\"nothing\")));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(0));
    assert!(outcome.views_closed.is_empty());
}

/// **Opening documentation is unconditional and closing it is bought.** An open only ever appends to
/// the prompt, so a provider's cached prefix survives it; a close removes an item from the middle
/// and costs the run every cached token after it. Whether that trade pays is a measurement, so it is
/// a toggle.
#[test]
fn a_close_without_the_capability_is_unavailable() {
    let (outcome, log) = run_with(
        &catching("gg.docs.close(\"openText\")"),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "close",
        "`gg.docs.close` is not available.",
    );
    assert_on_the_roster(&outcome, "docs.close");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn closing_every_docs_view_reports_what_it_closed() {
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
fn closing_every_docs_view_with_none_open_is_zero() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.docs.closeAll()));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(0));
    assert!(outcome.views_closed.is_empty());
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

/// One call, two results: the window of text is a value the **program** reads, and the same window
/// is placed in the agent's own context as a view.
#[test]
fn a_file_view_hands_the_program_the_read_and_opens_the_view() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "const read = gg.views.openFile(\"notes.md\");\n",
        "console.log(JSON.stringify({ kind: read.kind, first: read.firstLine,\n",
        "  last: read.lastLine, total: read.totalLines,\n",
        "  head: read.contents.split(\"\\n\")[0] }));\n",
    ));
    assert_eq!(
        logged_json(&outcome),
        json!({ "kind": "text", "first": 1, "last": 2, "total": 2,
                "head": "contents of notes.md" })
    );
    assert_eq!(opened(&outcome), [(ViewKind::File, "notes.md")]);
    assert_eq!(
        log.names(),
        ["read_file"],
        "the view is serviced by a read, recorded under the tool that ran"
    );
}

/// **Nothing is opened when the read fails** — and the refusal is recorded, because a view that
/// never reached the window is the one thing this feature must not let happen quietly.
#[test]
fn a_read_that_fails_opens_no_view() {
    let (outcome, _) = failing(
        &catching("gg.views.openFile(\"missing.md\")"),
        "read_file",
        ToolFailure::NotFound,
        "`read_file`: no such file `missing.md`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "open_file",
        "no such file `missing.md`",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "a failed read opens nothing: {:?}",
        outcome.views_opened
    );
    assert!(
        outcome
            .view_refusals
            .iter()
            .any(|refusal| refusal.contains("missing.md")),
        "and the model is told the material never arrived: {:?}",
        outcome.view_refusals
    );
}

/// Nothing is truncated silently, so the refusal names **the size and the bound** — a program told
/// only "too large" cannot know how much less to ask for.
#[test]
fn a_window_over_the_cap_is_limit_exceeded_naming_the_size_and_the_bound() {
    let oversized = "x".repeat(70_000);
    let (outcome, _) = answering(
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
        "{:?}",
        outcome.views_opened
    );
}

/// Unlike a zero `offset`, which plainly means the first line, a zero line cut names **nothing** —
/// so it is refused by name rather than normalised into "leave the lines whole".
#[test]
fn a_line_cut_of_zero_is_refused() {
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
fn a_line_cut_over_the_ceiling_is_refused() {
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

/// A file view **is** a read, so it is bought by the read gate: a run that cannot read a file
/// cannot show one either, and the two are one capability rather than a gate with a way around it.
#[test]
fn a_run_without_read_file_cannot_open_a_file_view() {
    let (outcome, log) = run_with(
        &catching("gg.views.openFile(\"src/a.ts\")"),
        &all_operations_without(CAPABILITY_READ_FILE),
    );
    assert_caught(
        &outcome,
        "unavailable",
        "open_file",
        "`gg.views.openFile` is not available.",
    );
    assert_on_the_roster(&outcome, "views.open_file");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

/// Re-opening a path **replaces** what it showed, and says so: a program that re-reads a file in a
/// loop must be able to read its own accounting rather than believing it opened a second view.
#[test]
fn re_opening_the_same_path_supersedes_the_view_it_replaces() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.views.openFile(\"src/a.ts\");\n",
        "gg.views.openFile(\"src/a.ts\");\n",
        "console.log(JSON.stringify(gg.views.close(\"src/a.ts\")));\n",
    ));
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.superseded)
            .collect::<Vec<_>>(),
        [false, true]
    );
    assert_eq!(
        logged_json(&outcome),
        json!(1),
        "two opens of one path are one view"
    );
}

#[test]
fn a_text_view_over_the_body_ceiling_is_limit_exceeded() {
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

/// The label has a ceiling of its own, far smaller than the body's, and the two are told apart by
/// what the sentence says rather than by the class.
#[test]
fn a_text_view_over_the_label_ceiling_is_limit_exceeded() {
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

/// An empty body is allowed and an empty label is not: the label is what the view is filed under and
/// what re-opening it replaces, so a blank one names nothing.
#[test]
fn an_empty_label_is_refused() {
    let (outcome, _) = run(&catching("gg.views.openText(\"\", \"eight files\")"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "open_text",
        "a view needs a non-empty label",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// **The discovery loop, closed.** A search reports a `key`, and that key is exactly what a
/// documentation view opens — so a program can go from "what do I hold" to "show me this one"
/// without the model having been told a name first.
#[test]
fn a_docs_view_opens_from_the_name_the_search_reported() {
    let log = CallLog::default();
    let outcome = over(
        concat!(
            "import * as gg from \"gg\";\n",
            "const hit = gg.docs.search({ query: \"text view\" }).hits[0];\n",
            "gg.views.openDocsView(hit.key);\n",
            "console.log(JSON.stringify({ key: hit.key, kind: hit.kind, module: hit.module,\n",
            "  name: hit.name }));\n",
        ),
        FakeOperationApi::new(&log).finding(
            "gg.views.openText",
            DocKind::Function,
            "gg.views",
            "openText",
            "Show a value the program computed.",
        ),
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "key": "gg.views.openText", "kind": "function", "module": "gg.views",
                "name": "openText" })
    );
    assert_eq!(
        opened(&outcome),
        [
            (ViewKind::Search, SEARCH_RESULTS_VIEW),
            (ViewKind::Docs, "gg.views.openText"),
        ],
        "the search filed its page under gg's own selector, and the key opened its own page"
    );
}

/// The other spelling the SDK accepts: the **function itself**, which is what a program that
/// already holds the binding writes rather than restating its name as a string.
#[test]
fn a_docs_view_opens_from_the_function_itself() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "gg.views.openDocsView(gg.views.openText);\n",
    ));
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        opened(&outcome),
        [(ViewKind::Docs, "openText")],
        "the function resolved to the name gg knows it by"
    );
    assert!(
        log.names().is_empty(),
        "a documentation lookup is not a tool call: {:?}",
        log.names()
    );
}

/// A value that is neither a function nor a string is refused **here**, before the lookup, and
/// reported as the type it was — so a model is not sent looking for a name it never wrote.
#[test]
fn a_docs_lookup_of_a_non_function_is_refused_on_the_argument() {
    let (outcome, log) = run(&catching("gg.views.openDocsView(42)"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "openDocsView",
        "expected a function or function name, got number",
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn an_unknown_documentation_name_is_not_found() {
    let log = CallLog::default();
    let outcome = over(
        &catching("gg.views.openDocsView(\"gg.views.noSuchThing\")"),
        FakeOperationApi::new(&log).docs_index(&["openText", "fork"], &["openText"]),
    );
    assert_caught(
        &outcome,
        "not-found",
        "open_docs_view",
        "no documentation for `gg.views.noSuchThing`; this session binds `openText`",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// A real catalogue name **outside this agent's scope** is the same class and a different cause, and
/// the message is about the binding rather than the spelling: a model told "no such name" would
/// spend a turn correcting a name that was already right. It stays `not-found`, because telling it
/// the call exists would be telling it about a call it may not make.
#[test]
fn a_name_this_agent_does_not_bind_is_not_found() {
    let log = CallLog::default();
    let outcome = over(
        &catching("gg.views.openDocsView(\"fork\")"),
        FakeOperationApi::new(&log).docs_index(&["openText", "fork"], &["openText"]),
    );
    assert_caught(
        &outcome,
        "not-found",
        "open_docs_view",
        "this session does not bind it; it binds `openText`",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn closing_a_selector_nothing_is_open_under_is_zero() {
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\n",
        "console.log(JSON.stringify(gg.views.close(\"src/never-opened.ts\")));\n",
    ));
    assert_eq!(logged_json(&outcome), json!(0));
    assert!(outcome.views_closed.is_empty());
}

#[test]
fn an_empty_selector_is_refused() {
    let (outcome, _) = run(&catching("gg.views.close(\"\")"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "close",
        "needs a non-empty selector",
    );
}

// ---------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------

/// An ending is **declared**, not performed: whatever follows the call still runs, which is what
/// lets a program end its session and then log what it found.
#[test]
fn a_finish_is_declared_and_the_program_runs_on() {
    let outcome = as_role(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.session.finish(\"wrote the parser and the tests are green\");\n",
            "console.log(\"ran on\");\n",
        ),
        EndingRole::Standard,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        ending_of(&outcome),
        &Ending::Finished {
            summary: "wrote the parser and the tests are green".to_string()
        }
    );
}

/// The summary becomes the session's whole answer to whoever asked for the work, so "I am done and
/// have nothing to say about it" is not an ending gg accepts on the model's behalf — and the
/// sentence tells the model the run is still open.
#[test]
fn a_blank_summary_finishes_nothing() {
    let outcome = as_role(&catching("gg.session.finish(\"  \")"), EndingRole::Standard);
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
    let outcome = as_role(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.session.finish(\"the first attempt\");\n",
            "gg.session.finish(\"the second, with the tests green\");\n",
        ),
        EndingRole::Standard,
    );
    assert_eq!(
        ending_of(&outcome),
        &Ending::Finished {
            summary: "the second, with the tests green".to_string()
        }
    );
    assert_eq!(
        outcome
            .completion
            .as_ref()
            .map(|completion| completion.superseded),
        Some(1)
    );
}

/// The summary describes checks the program never finished running, so gg keeps it for the feedback
/// and gives the session another turn rather than ending the run on it.
#[test]
fn a_completion_is_revoked_when_the_program_then_fails() {
    let outcome = as_role(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.session.finish(\"the work is done\");\n",
            "throw new Error(\"the checks did not pass\");\n",
        ),
        EndingRole::Standard,
    );
    assert!(outcome.completion.is_none());
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "the work is done".to_string(),
        })
    );
    assert!(
        thrown(&outcome, "the program threw after finishing")
            .message
            .contains("the checks did not pass"),
        "{:?}",
        outcome.result
    );
}

/// An ending belongs to the role the program was **dispatched** in, and a reviewer has two of its
/// own — so the refusal names them rather than only saying no.
#[test]
fn a_finish_outside_the_standard_role_is_unavailable() {
    let outcome = as_role(&catching("gg.session.finish(\"done\")"), EndingRole::Review);
    assert_caught(
        &outcome,
        "unavailable",
        "finish",
        "Use `gg.session.approve` or `gg.session.requestChanges` instead.",
    );
    assert_on_the_roster(&outcome, "session.finish");
    assert!(outcome.completion.is_none());
}

#[test]
fn an_approval_ends_a_review() {
    let outcome = as_role(
        "import * as gg from \"gg\";\ngg.session.approve();\n",
        EndingRole::Review,
    );
    assert_eq!(ending_of(&outcome), &Ending::Approved);
}

/// A verdict is the one declaration nothing downstream re-examines, so an agent that may not give
/// one is stopped here — and the reach is counted.
#[test]
fn an_approval_outside_the_review_role_is_unavailable() {
    let outcome = as_role(&catching("gg.session.approve()"), EndingRole::Standard);
    assert_caught(
        &outcome,
        "unavailable",
        "approve",
        "Use `gg.session.finish` instead.",
    );
    assert_on_the_roster(&outcome, "session.approve");
    assert!(outcome.completion.is_none());
}

#[test]
fn requesting_changes_carries_every_item_through() {
    let outcome = as_role(
        concat!(
            "import * as gg from \"gg\";\n",
            "gg.session.requestChanges([\"`step()` is off by one\", \"widen the test\"]);\n",
        ),
        EndingRole::Review,
    );
    assert_eq!(
        ending_of(&outcome),
        &Ending::ChangesRequested {
            items: vec![
                "`step()` is off by one".to_string(),
                "widen the test".to_string(),
            ],
        }
    );
}

/// A rejection is dispatched verbatim to the agent that has to fix the work, so an empty list would
/// send it back to re-read criteria it already believed it had met.
#[test]
fn a_rejection_with_no_changes_is_refused() {
    let outcome = as_role(
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

/// The separate cause: a list with entries in it, **all of them blank**. They are dropped first and
/// what is refused is the empty result, so the two are one message arrived at two ways rather than
/// two checks.
#[test]
fn a_rejection_whose_entries_are_all_blank_is_refused() {
    let outcome = as_role(
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
fn requesting_changes_outside_the_review_role_is_unavailable() {
    let outcome = as_role(
        &catching("gg.session.requestChanges([\"widen the test\"])"),
        EndingRole::Standard,
    );
    assert_caught(
        &outcome,
        "unavailable",
        "request_changes",
        "Use `gg.session.finish` instead.",
    );
    assert_on_the_roster(&outcome, "session.request_changes");
    assert!(outcome.completion.is_none());
}

// ---------------------------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------------------------

/// `console.log` is a program's only channel for showing gg a value, so nothing may be added to a
/// line, taken off one, or re-ordered between them.
#[test]
fn a_logged_line_reaches_gg_in_the_order_the_program_wrote_it() {
    let (outcome, _) = run(concat!(
        "console.log(\"first\");\n",
        "console.log(\"second\");\n",
        "console.log(\"third\");\n",
    ));
    assert_eq!(logs(&outcome), ["first", "second", "third"]);
}

/// One `console.log(hugeString)` cannot spend the whole budget by itself — and the cut lands on a
/// character boundary, so a multi-byte value is never split through the middle of a character.
#[test]
fn a_line_over_the_line_cap_is_truncated() {
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

/// **The capture keeps the tail**, and what went is counted rather than silently dropped: the
/// natural shape is to log per item in a loop and then log the conclusion, so a head-biased capture
/// would discard exactly the line the program wrote to be read.
#[test]
fn lines_past_the_log_cap_are_evicted_and_counted() {
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

/// **A program that ends with a value hands gg nothing.** A program on this arm is a module, and a
/// module has no function body to return from — so the statement is the engine's own refusal at the
/// model's own file rather than a value gg had to decide what to do with, and the flag that would
/// tell the model its value was discarded stays clear because there was never a value.
#[test]
fn a_top_level_return_is_the_engines_own_syntax_error() {
    let (outcome, _) = run("console.log(\"before\");\nreturn 42;\n");
    let said = thrown(
        &outcome,
        "the language refuses a `return` outside a function",
    )
    .message
    .clone();
    assert!(
        said.to_lowercase().contains("return"),
        "the refusal names the statement: {said}"
    );
    assert!(!outcome.returned_value, "nothing was handed over: {said}");
}

/// **Work a program defers runs inside its own turn.** The guest drains its job queue before the
/// turn ends, so a continuation's gg call is an ordinary recorded call and there is no deferred note
/// to tell the model about.
#[test]
fn work_a_program_defers_runs_inside_its_own_turn() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "Promise.resolve().then(() => files.writeFile(\"late.txt\", \"after the program\"));\n",
        "console.log(\"first\");\n",
    ));
    assert_eq!(logs(&outcome), ["first"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "the deferred call ran inside the turn, and is on the turn's own roster"
    );
    assert_eq!(outcome.deferred_note, None);
}

/// **A module that throws while loading is reported, and the program stops where it imported it.**
/// A module belongs to whoever authored the skill or wrote the memory rather than to the model, so
/// its failure is reported rather than left as an empty binding the program has to guess about.
///
/// *How* it is reported is the exception the
/// [API surface](https://docs.testcabinet.ai/gg/responses-as-code/api-surface/#module-failures)
/// states for an arm whose language evaluates an imported module as part of the importing program's
/// own evaluation: an ES module is exactly that, so the module's located failure reaches the model
/// as the **program's own**, under the specifier the program wrote and at the module's own line,
/// and the `feedback` channel's module list stays empty. There is no shape on this arm in which the
/// program carries on past the import — a dynamic `import()` whose rejection the program handles is
/// still reported to the isolate as an unhandled one — so what the model is owed instead is a
/// failure it can act on, which is a located one naming the code that was not its own.
#[test]
fn a_module_that_throws_while_loading_is_reported_as_the_programs_own_failure() {
    let (outcome, _) = run_scoped(
        "import \"lib:broken\";\nconsole.log(\"never\");\n",
        &all_operations(),
        &[CodeModule {
            name: "broken".to_string(),
            source: "throw new Error(\"bad skill\");\nexport function gone() { return 1; }\n"
                .to_string(),
        }],
    );
    let said = thrown(&outcome, "an imported module's throw is the program's")
        .message
        .clone();
    assert!(
        said.contains("bad skill") && said.contains("lib:broken:1:"),
        "the module that failed is named at its own line: {said}"
    );
    assert!(
        outcome.logs.is_empty(),
        "nothing after the import ran: {:?}",
        outcome.logs
    );
    assert!(
        outcome.module_errors.is_empty(),
        "on this arm a module's failure is the importing program's, never a separate report: {:?}",
        outcome.module_errors
    );
}

/// **The second is never reached**, which is the same exception read from the other end: a program
/// has exactly one failure, so two broken skills are one sentence and the module the turn never
/// evaluated is not something the model is told about as if it had been tried.
#[test]
fn a_second_broken_module_is_not_reported_beside_the_first() {
    let (outcome, _) = run_scoped(
        "import \"lib:broken\";\nimport \"lib:worse\";\nconsole.log(\"never\");\n",
        &all_operations(),
        &[
            CodeModule {
                name: "broken".to_string(),
                source: "throw new Error(\"bad skill\");\n".to_string(),
            },
            CodeModule {
                name: "worse".to_string(),
                source: "throw new Error(\"worse skill\");\n".to_string(),
            },
        ],
    );
    let said = thrown(&outcome, "the first module evaluated took the turn")
        .message
        .clone();
    assert!(
        said.contains("bad skill") && !said.contains("worse skill"),
        "the failure is the first module's, and only its: {said}"
    );
    assert!(
        outcome.module_errors.is_empty(),
        "and neither was reported through the module channel: {:?}",
        outcome.module_errors
    );
}
