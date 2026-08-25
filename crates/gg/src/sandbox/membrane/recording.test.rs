//! Tests for the API-call bracket: that a model-facing call is recorded under the name the **model
//! wrote**, that no host function is missing one, and that the record is independent of the tool
//! record beside it.
//!
//! The centrepiece is [`every_host_function_records_its_own_api_call`], which calls all
//! forty-eight of them and compares the identities recorded against
//! [`OPERATIONS`](crate::sandbox::OPERATIONS). It is deliberately exhaustive rather
//! than a sample: a host function that forgot its bracket produces a *silent zero* on the console —
//! a page saying the model ignored a call it in fact used — which is the one failure this whole
//! mechanism exists to prevent and the one a sample would miss.
//!
//! The token in [`recording`](super::recording) already makes the common form of that omission a
//! compile error. What it cannot catch is a host function that opened a bracket naming the *wrong*
//! call, or the one function (`programs.rerun`) that touches neither the api nor a tool and could
//! therefore have skipped the bracket and still compiled. This closes both.

use std::collections::BTreeSet;

use super::super::test_cabinet::gg::board::{
    EpicAssignment, EpicInput, Host as BoardHost, IssueInput, IssuePatch, IssueStatus,
};
use super::super::test_cabinet::gg::context::{Host as ContextHost, TurnRange};
use super::super::test_cabinet::gg::delegation::{
    Host as DelegationHost, SpawnRequest, SubagentBrief,
};
use super::super::test_cabinet::gg::docs::Host as DocsHost;
use super::super::test_cabinet::gg::files::Host as FilesHost;
use super::super::test_cabinet::gg::memories::{Host as MemoriesHost, MemoryEdit, MemoryInput};
use super::super::test_cabinet::gg::programs::Host as ProgramsHost;
use super::super::test_cabinet::gg::session::Host as SessionHost;
use super::super::test_cabinet::gg::shell::Host as ShellHost;
use super::super::test_cabinet::gg::skills::Host as SkillsHost;
use super::super::test_cabinet::gg::tasks::{Host as TasksHost, TaskInput, TaskPatch};
use super::super::test_cabinet::gg::types::TextEdit;
use super::super::test_cabinet::gg::views::Host as ViewsHost;
use super::*;
use test_cabinet_core::gg::GgCallFailure;

use crate::sandbox::fake::{ApiLog, CallLog, FakeOperationApi, membrane_from};
use crate::sandbox::{FILES_READ_FILE, OPERATIONS};

/// A membrane over a fake api, with both of its records to hand: what ran, and what was written.
fn recording_membrane(log: &CallLog) -> (MembraneState<FakeOperationApi>, ApiLog) {
    let api = FakeOperationApi::new(log).with_program("k3p9", 1, "harness.finish('done');");
    let recorded = api.api_log();
    (membrane_from(api), recorded)
}

/// Call every model-facing function on the membrane once, in catalogue order. Errors are ignored:
/// this is about *which* calls were recorded, not what any of them returned.
fn call_everything(state: &mut MembraneState<FakeOperationApi>) {
    let _ = state.shell("echo hi".to_string(), None);
    let _ = state.read_file("src/main.rs".to_string(), None, None);
    let _ = state.write_file("out.txt".to_string(), "body".to_string());
    let _ = state.edit_file("out.txt".to_string(), "a".to_string(), "b".to_string());
    let _ = state.list_dir(None);
    let _ = FilesHost::search(state, "needle".to_string(), None, None);
    let _ = state.read_skill("testing".to_string());

    let memory = MemoryInput {
        name: "layout".to_string(),
        description: "where things live".to_string(),
        body: "src/ holds the engine".to_string(),
        code: None,
        on_use: None,
    };
    let _ = state.write_memory(memory.clone());
    let _ = state.update_memory(memory.clone());
    let _ = state.create_memory(memory);
    let _ = state.read_memory("layout".to_string());
    let _ = state.edit_memory(MemoryEdit {
        name: "layout".to_string(),
        search: "a".to_string(),
        replace: "b".to_string(),
    });
    let _ = state.search_memories(vec!["engine".to_string()]);
    let _ = state.delete_memory("layout".to_string());

    let _ = state.add_task(TaskInput {
        id: "t1".to_string(),
        title: "write the parser".to_string(),
        description: None,
        blocked_by: Vec::new(),
    });
    let _ = state.update_task(
        "t1".to_string(),
        TaskPatch {
            title: None,
            description: TextEdit::Keep,
            status: None,
        },
    );
    let _ = state.set_blocked_by("t1".to_string(), Vec::new());
    let _ = state.complete_task("t1".to_string());
    let _ = state.remove_task("t1".to_string());

    let _ = state.create_epic(EpicInput {
        prefix: "prs".to_string(),
        title: "the parser".to_string(),
        description: "everything about parsing".to_string(),
    });
    let _ = state.create_issue(IssueInput {
        title: "the lexer".to_string(),
        description: None,
        in_scope: "tokens".to_string(),
        out_of_scope: "the AST".to_string(),
        completion_criteria: "every token has a test".to_string(),
        blocked_by: Vec::new(),
        epic_id: None,
        agent: "implementer".to_string(),
        reviewers: Vec::new(),
    });
    let _ = state.update_issue(
        "i1".to_string(),
        IssuePatch {
            title: None,
            description: TextEdit::Keep,
            in_scope: None,
            out_of_scope: None,
            completion_criteria: None,
            status: Some(IssueStatus::InProgress),
            epic: EpicAssignment::Keep,
        },
    );
    let _ = state.set_issue_blocked_by("i1".to_string(), Vec::new());
    let _ = state.remove_epic("EPIC".to_string());
    let _ = state.remove_issue("i1".to_string());
    let _ = state.wait_for_issue("i1".to_string());

    let _ = state.evict_file_view(None);
    let _ = state.archive_thread(vec![TurnRange { start: 1, end: 2 }]);
    let _ = state.search_archive("lexer".to_string());
    let _ = state.compact("a summary".to_string(), Vec::new());

    let _ = state.spawn_subagent(SpawnRequest {
        agent: "subagent".to_string(),
        task: SubagentBrief::Prompt("write the lexer".to_string()),
    });
    let _ = state.wait_for_subagents(None);
    let _ = state.send_message("a1".to_string(), "carry on".to_string());
    let _ = state.transition_state("review".to_string(), None);
    let _ = state.exec("critic".to_string(), None);
    let _ = state.fork("try the other branch".to_string());

    let _ = DocsHost::search(
        state,
        Some("read".to_string()),
        Vec::new(),
        None,
        None,
        None,
        None,
    );
    let _ = state.close_doc_view("readFile".to_string());
    let _ = state.close_doc_views();

    let _ = state.open_file_view("src/main.rs".to_string(), None, None, None);
    let _ = state.open_text_view("findings".to_string(), "all green".to_string());
    let _ = state.open_docs_view("readFile".to_string());
    let _ = state.close_view("findings".to_string());

    let _ = state.history();
    let _ = state.get("k3p9".to_string());
    let _ = state.rerun("harness.finish('again');".to_string());

    // All three ending calls, on one standard-role membrane: two of them are refused, and that is
    // the point being made here — a call the membrane withholds is still a call the model made, so
    // it opens and closes the same bracket a serviced one does. The identity set below is therefore
    // the whole model-facing surface whatever role this membrane holds.
    let _ = state.finish("done".to_string());
    let _ = state.approve();
    let _ = state.request_changes(vec!["fix the lexer".to_string()]);
}

/// **Every host function on the membrane records its own API call, and no two share one.**
///
/// The set recorded has to be exactly the model-facing surface — the
/// [operations table](OPERATIONS), and nothing beside it. A missing identity is a function whose
/// calls vanish; an extra one is a call recorded under a name the agent's own reported surface never
/// mentions, which joins to nothing and reads as a phantom.
///
/// It is an equality rather than a containment because there is nothing model-facing outside that
/// table, and it is asserted over the **operation id** because that is now the whole identity a call
/// is recorded under. There used to be a second assertion here over an `(object, key)` pair recorded
/// beside it; the pair is deleted, and with it the possibility of the two disagreeing.
#[test]
fn every_host_function_records_its_own_api_call() {
    let log = CallLog::default();
    let (mut state, recorded) = recording_membrane(&log);

    call_everything(&mut state);

    let got: BTreeSet<String> = recorded.operations().into_iter().collect();
    let want: BTreeSet<String> = OPERATIONS
        .iter()
        .map(|operation| operation.id.to_string())
        .collect();

    assert_eq!(
        got, want,
        "the membrane's API records and gg's model-facing surface must be the same set"
    );
    assert_eq!(
        recorded.calls().len(),
        want.len(),
        "each function was called once and recorded once: {:?}",
        recorded.operations()
    );
    // Both halves of the bracket, because the two answer different questions — *what did this
    // agent do* is asked of the calls and *what failed* is asked of the results, and a result that
    // had to be paired back to its call to be attributed would have to be paired across every child
    // event a delegation emitted inside it.
    assert!(
        recorded.calls().iter().all(|call| call.ok.is_some()),
        "every bracket closed: {:?}",
        recorded.calls()
    );
}

/// **A documentation call records the operation gg has for it**, like every other model-facing call.
///
/// It used to record none, and the absence was honest at the time: the three documentation calls
/// were in no row of the table, so there was no id to resolve and a synthesized one would have been
/// a string that joined to nothing else in the run. What that cost was invisible from here and
/// total from a model's side — a call with no operation is a call no gate, no coverage check and no
/// arm's catalogue is required to know about, which is why the
/// [prompt](crate::prompts) could tell a model to search while no SDK published a search.
///
/// Asserted rather than left to the exhaustive pair above because the identity is the whole point of
/// enrolling them: `docs.search` on the wire is now the same kind of name as `files.read_file`, and
/// a consumer keys one population rather than two.
#[test]
fn a_documentation_call_records_the_operation_gg_files_it_under() {
    let log = CallLog::default();
    let (mut state, recorded) = recording_membrane(&log);

    let _ = DocsHost::search(
        &mut state,
        Some("read".to_string()),
        Vec::new(),
        None,
        None,
        None,
        None,
    );

    assert_eq!(recorded.operations(), vec!["docs.search"]);
    assert_eq!(
        recorded.operations(),
        vec!["docs.search".to_string()],
        "the call is recorded under gg's own identity for it: {:?}",
        recorded.calls()
    );
}

/// **A call the model wrote is counted even when nothing dispatched.**
///
/// The carve-outs are the complaint that motivated all of this: no gg tool backs one, so the old
/// tool-keyed join had nothing to count it with and the console said so out loud — "nothing behind
/// it is recorded as a tool call, so it has no count". They are calls. They are counted.
#[test]
fn a_call_no_tool_backs_is_still_recorded() {
    let log = CallLog::default();
    let (mut state, recorded) = recording_membrane(&log);

    state
        .close_view("nothing".to_string())
        .expect("granted, so it answers");
    state
        .open_text_view("findings".to_string(), "all green".to_string())
        .expect("the text view opens");
    state.finish("done".to_string()).expect("finished");

    assert_eq!(
        recorded.operations(),
        vec!["views.close", "views.open_text", "session.finish"]
    );
    assert!(
        log.calls().is_empty(),
        "none of the three dispatched a tool: {:?}",
        log.names()
    );
    assert_eq!(
        state.into_parts().api_calls,
        3,
        "the turn's own count includes the calls no tool backs"
    );
}

/// **`view.openFile` is recorded as `view.openFile`, and as a `read_file` on the tool stream.**
///
/// The two records are the two layers, and the reason this one matters is that the model never
/// wrote `read_file`: reporting the call under it told a reader the agent used a function it had
/// not, and left `view.openFile` looking untouched.
#[test]
fn opening_a_file_view_is_recorded_as_the_view_call_and_not_as_a_read() {
    let log = CallLog::default();
    let (mut state, recorded) = recording_membrane(&log);

    state
        .open_file_view("src/main.rs".to_string(), None, None, None)
        .expect("the view opens");

    assert_eq!(recorded.operations(), vec!["views.open_file"]);
    assert!(
        !recorded
            .operations()
            .contains(&"files.read_file".to_string()),
        "the read it runs is not a call the model made"
    );
    assert_eq!(
        log.names(),
        vec!["read_file"],
        "the tool layer still records what actually ran"
    );
}

/// **A call the membrane refused is an API call that failed**, where the tool layer records nothing
/// at all.
///
/// The model made the call — that is the fact the API layer is keeping — and the reason it went
/// nowhere is a fact about this run's capability set rather than about the model's writing. The two
/// layers therefore disagree here on purpose, and `CodeExecution`'s two counts disagree with them.
#[test]
fn a_refused_call_is_recorded_as_a_failed_api_call() {
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    let recorded = api.api_log();
    let mut state = MembraneState::new(
        api,
        crate::sandbox::fake::typescript(),
        crate::sandbox::ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: crate::sandbox::RunEnding::Role(crate::ending::EndingRole::Standard),
        },
        crate::sandbox::SandboxLimits::AMPLE,
        None,
    );

    state
        .list_dir(None)
        .expect_err("a withheld tool is refused");

    assert_eq!(recorded.operations(), vec!["files.list_dir"]);
    assert_eq!(recorded.calls()[0].ok, Some(false));
    // ...and it says *why*. A refusal never dispatches, so this record is the only place the class
    // exists at all: without it, the one call class that says "this run withheld what the model
    // reached for" would be unrecorded anywhere.
    assert_eq!(
        recorded.calls()[0].failure,
        Some(GgCallFailure::Unavailable)
    );
    assert!(
        log.calls().is_empty(),
        "nothing reached the invoker, so the tool layer has nothing to record"
    );
    let parts = state.into_parts();
    assert_eq!(parts.api_calls, 1);
    assert!(parts.calls.is_empty());
    assert_eq!(parts.refusals.len(), 1);
}

/// **A call that dispatched a tool successfully but could not use what came back is a failed API
/// call**, even though its `ToolResult` already streamed a success.
///
/// The bracket closes after the typed conversion, which is the whole reason it wraps the host
/// function rather than sitting inside `dispatch`. The API layer reports what the *program* saw.
#[test]
fn a_call_whose_result_could_not_be_converted_fails_the_api_record() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, |_, _| {
        crate::tools::ToolOutcome::ok("no sidecar", "listed")
    });
    let recorded = api.api_log();
    let mut state = membrane_from(api);

    state
        .list_dir(None)
        .expect_err("a tool that answered with no sidecar throws");

    assert_eq!(recorded.operations(), vec!["files.list_dir"]);
    assert_eq!(
        recorded.calls()[0].ok,
        Some(false),
        "the API record takes the verdict the program saw"
    );
    assert_eq!(
        recorded.calls()[0].failure,
        Some(GgCallFailure::IoError),
        "and the class it was thrown with, which the `ToolResult` beside it cannot carry — that \
         one streamed a success"
    );
}

/// **Every failed API call says why**, in the class the program itself branches on — and a
/// successful one says nothing, so a class is present on exactly the calls that failed.
///
/// This is the seam the complaint was about: the bracket knew the `ApiError` it was closing over
/// and recorded only that there *was* one, so an API call that failed forty times over a missing
/// file was indistinguishable from one that failed forty times over a refused capability.
#[test]
fn a_failed_api_call_records_the_class_it_threw_with() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, |tool, _| match tool {
        "read_file" => crate::tools::ToolOutcome::failed(
            crate::tools::ToolFailure::NotFound,
            "no such file: missing.rs",
        ),
        _ => crate::tools::ToolOutcome::failed(
            crate::tools::ToolFailure::InvalidArgument,
            "the path climbs out of the workspace",
        ),
    });
    let recorded = api.api_log();
    let mut state = membrane_from(api);

    let _ = state.read_file("missing.rs".to_string(), None, None);
    let _ = state.write_file("../escape.txt".to_string(), "body".to_string());
    let _ = state.close_view("nothing".to_string());

    let calls = recorded.calls();
    assert_eq!(
        calls
            .iter()
            .map(|call| (call.operation.as_str(), call.failure))
            .collect::<Vec<_>>(),
        vec![
            ("files.read_file", Some(GgCallFailure::NotFound)),
            ("files.write_file", Some(GgCallFailure::InvalidArgument)),
            // A granted call with nothing to fail at records no class, because nothing threw.
            ("views.close", None),
        ]
    );
}

/// A failure raised outside a tool implementation is recorded as `other` rather than as nothing.
///
/// "This call failed and nobody said why" and "this call did not fail" are different facts, and a
/// shared absence would make them the same one.
#[test]
fn an_unclassified_failure_is_recorded_as_the_unclassified_class() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, |_, _| {
        crate::tools::ToolOutcome::error("the bridge degraded")
    });
    let recorded = api.api_log();
    let mut state = membrane_from(api);

    let _ = state.read_file("src/main.rs".to_string(), None, None);

    assert_eq!(recorded.calls()[0].failure, Some(GgCallFailure::Other));
}

// ---------------------------------------------------------------------------
// The discovery half of the bracket
// ---------------------------------------------------------------------------

/// **A call the model never opened a documentation view of is recorded — and still runs.**
///
/// Both halves matter equally. The record is the whole point of the mechanism; that the call is
/// serviced anyway is what keeps it a measurement rather than a gate, and a refusal here would
/// change what a run *is*. See [`crate::discovery`].
#[test]
fn a_call_the_model_never_looked_up_is_recorded_and_still_runs() {
    let log = CallLog::default();
    let mut state = membrane_from(FakeOperationApi::new(&log).documenting(&[]));

    state
        .read_file("src/main.rs".to_string(), None, None)
        .expect("the call is measured, never refused");

    assert_eq!(state.undocumented.calls, 1);
    assert_eq!(
        state.undocumented.operations.get("files.read_file"),
        Some(&1),
        "the finding names the operation, so an operator knows which call was guessed at"
    );
    assert_eq!(
        log.names(),
        vec!["read_file"],
        "the read really happened: nothing about this changes what the program got back"
    );
}

/// **A call the model opened a documentation view of on an earlier turn is not recorded.**
#[test]
fn a_call_documented_before_the_turn_is_not_recorded() {
    let log = CallLog::default();
    let mut state = membrane_from(FakeOperationApi::new(&log).documenting(&[FILES_READ_FILE]));

    let _ = state.read_file("src/main.rs".to_string(), None, None);
    let _ = state.write_file("out.txt".to_string(), "body".to_string());

    assert_eq!(
        state.undocumented.operations.keys().collect::<Vec<_>>(),
        vec!["files.write_file"],
        "the documented call clears and the undocumented one beside it does not"
    );
    assert_eq!(state.undocumented.calls, 1);
}

/// **The same call made four times is four findings**, because the question is asked per call.
///
/// A model that fought the same unread signature forty times and one that guessed once are very
/// different findings, and a set of operations rather than a count per operation could not tell them
/// apart.
#[test]
fn every_undocumented_call_is_counted_not_every_operation() {
    let log = CallLog::default();
    let mut state = membrane_from(FakeOperationApi::new(&log).documenting(&[]));

    for _ in 0..4 {
        let _ = state.read_file("src/main.rs".to_string(), None, None);
    }

    assert_eq!(state.undocumented.calls, 4);
    assert_eq!(
        state.undocumented.operations.get("files.read_file"),
        Some(&4)
    );
}

/// **An ending call is never even asked about.** The prompt spells `finish` at the model itself, so
/// a call to it is an instruction followed rather than a signature guessed — see
/// [`spelled_by_gg`](crate::discovery::spelled_by_gg).
///
/// The double here reports *everything* undocumented, so this is the exemption doing the work and
/// nothing else.
#[test]
fn the_ending_calls_gg_spells_in_its_prompt_are_never_recorded() {
    let log = CallLog::default();
    let mut state = membrane_from(FakeOperationApi::new(&log).documenting(&[]));

    let _ = state.finish("done".to_string());

    assert!(
        state.undocumented.is_empty(),
        "gg named this call in its own prompt: {:?}",
        state.undocumented
    );
}

/// **An api with no documentation surface at all records nothing** — the answer
/// [`NotApplicable`](crate::discovery::CallDiscovery::NotApplicable) exists for, and the shape
/// [`BootstrapApi`](crate::bootstrap) answers with: gg wrote that program, so there is no model
/// whose reading is in question.
#[test]
fn an_api_that_documents_nothing_records_nothing() {
    let log = CallLog::default();
    let mut state = membrane_from(FakeOperationApi::new(&log));

    call_everything(&mut state);

    assert!(
        state.undocumented.is_empty(),
        "nothing here could have been looked up, so nothing here was skipped: {:?}",
        state.undocumented
    );
}

/// **A refused call is a refusal and never an undocumented call.**
///
/// The two are different facts with different rosters — *the model reached for something it was not
/// given* against *the model called something it never looked up* — and the gate is asked first, so
/// a withheld operation never reaches the discovery question at all. It could not be answered
/// anyway: an operation this agent was not granted has no page in its surface.
#[test]
fn a_call_the_gate_refused_is_never_an_undocumented_call() {
    let log = CallLog::default();
    let mut state = crate::sandbox::fake::membrane_from_scope(
        FakeOperationApi::new(&log).documenting(&[]),
        false,
    );

    state
        .history()
        .expect_err("an agent with no program library is refused");

    assert!(
        state.undocumented.is_empty(),
        "the refusal roster already carries this call: {:?}",
        state.undocumented
    );
}
