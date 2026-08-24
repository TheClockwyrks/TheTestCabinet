//! Tests for the shared plumbing every host function goes through: what is dispatched, what is
//! refused, and what a failed outcome becomes.
//!
//! The caps on what a program leaves behind are the [capture](super::capture) module's, and are
//! tested next to them.
//!
//! **No wasm here.** [`MembraneState`] is built directly, the generated `Host` methods are called
//! as ordinary Rust, and the whole thirty-two-function surface is covered at microseconds per test
//! — which is what makes it affordable to assert every one of them. The end-to-end behaviour that
//! genuinely needs the component (scope binding, denied globals, traps) lives in `sandbox.test.rs`,
//! where it is consolidated into a handful of processes because each pays a full component compile.

use std::time::{Duration, Instant};

use serde_json::json;

use super::test_cabinet::gg::files::Host as FilesHost;
use super::test_cabinet::gg::skills::Host as SkillsHost;
use super::test_cabinet::gg::views::Host as ViewsHost;
use super::*;
use crate::sandbox::fake::{CallLog, all_operations, canned_outcome, membrane, membrane_with};

/// **The one call in the sandbox whose failure is swallowed actually succeeds.**
///
/// [`wasi_context`] preopens `/` so a program can reach the workspace through its own language's
/// file APIs, and deliberately ignores a failure rather than refusing to run the program over a
/// capability most guests never touch. That is the right call and it has a cost: a `WasiCtx` exposes
/// nothing about itself once built, and no guest gg ships today imports `wasi:filesystem`, so a
/// preopen that stopped working would be invisible from *both* sides until a language months from
/// now blamed its own toolchain for an empty root.
///
/// This is what can honestly be asserted about it: the exact call production makes, with the exact
/// arguments, works in this environment. It does not prove a program can read a file — no guest here
/// can — and it says nothing about the inherited network, which is not inspectable either.
#[test]
fn the_container_root_is_preopenable_for_every_program() {
    let mut builder = WasiCtxBuilder::new();
    assert!(
        preopen_root(&mut builder).is_ok(),
        "`/` could not be preopened, so every program's filesystem would be silently empty"
    );
}

/// A call this agent was not granted is refused by the membrane itself and never reaches the loop.
///
/// Every arm's SDK is static, so a program can write the call and the membrane is the whole of the
/// enforcement — which is why this is the gate rather than a backstop behind one.
#[test]
fn a_call_outside_the_allowlist_is_unavailable_without_reaching_the_invoker() {
    let log = CallLog::default();
    let mut state = membrane_with(
        &log,
        &[crate::sandbox::operations::SHELL_SHELL],
        None,
        canned_outcome,
    );

    let error = state
        .list_dir(Some("src".to_string()))
        .expect_err("a withheld tool is refused");

    assert_eq!(error.code, ErrorCode::Unavailable);
    assert_eq!(error.operation, "list_dir");
    assert!(
        log.calls().is_empty(),
        "the call reached the invoker anyway"
    );
}

/// **Closing a view is withheld exactly like any other ungranted call.**
///
/// It is bought by `agent-managed-context`, and it is asserted by name because it used to be
/// bound to every program: a regression that put it back would be invisible to every other test
/// here, which grants a maximal agent. The gate is the membrane's, so the fake api is never
/// reached.
#[test]
fn closing_views_is_unavailable_without_agent_managed_context() {
    let log = CallLog::default();
    let mut state = membrane_with(
        &log,
        &[crate::sandbox::operations::VIEWS_OPEN_TEXT],
        None,
        canned_outcome,
    );
    state
        .open_text_view("notes".to_string(), "kept".to_string())
        .expect("opening a text view is bound to every program");

    let error = ViewsHost::close_view(&mut state, "notes".to_string())
        .expect_err("closing a view is bought by agent-managed-context");
    assert_eq!(error.code, ErrorCode::Unavailable);
    assert_eq!(error.operation, "close");

    let parts = state.into_parts();
    assert_eq!(
        parts
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>(),
        ["views.close"],
        "it is filed as a refusal under gg's own operation id"
    );
    assert_eq!(
        parts.views_opened.len(),
        1,
        "the view stayed open: a refused close closes nothing"
    );
}

/// A refusal is counted apart from the serviced calls, because it produced no telemetry and no
/// session-record entry — the invariant that keeps `CodeExecution`'s `tool_calls` equal to the number of
/// `ToolCall`/`ToolResult` pairs the turn streamed.
#[test]
fn a_refusal_is_recorded_apart_from_the_serviced_calls() {
    let log = CallLog::default();
    let mut state = membrane_with(
        &log,
        &[crate::sandbox::operations::FILES_READ_FILE],
        None,
        canned_outcome,
    );

    state
        .read_file("a.ts".to_string(), None, None)
        .expect("the offered tool succeeds");
    state
        .list_dir(None)
        .expect_err("the withheld tool is refused");

    let parts = state.into_parts();
    assert_eq!(parts.calls.len(), 1, "one call was serviced");
    assert_eq!(parts.refusals.len(), 1, "one call was refused");
    // Filed under gg's whole [operation id](crate::sandbox::OperationId) rather than under the tool
    // the call would have dispatched. The read-file capability buys three operations, so a roster
    // keyed on tools could not say which of them the model reached for — and the ending refusals
    // beside it answer to no tool at all.
    assert_eq!(parts.refusals[0].name, "files.list_dir");
    assert!(parts.refusals[0].message.contains("listDir"));
}

/// Calls are recorded in the order the program made them — the roster the model reads next turn.
#[test]
fn every_call_is_recorded_in_order() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.list_dir(None).expect("list");
    state
        .read_file("a.ts".to_string(), None, None)
        .expect("read");
    state
        .write_file("b.ts".to_string(), "hi".to_string())
        .expect("write");

    let parts = state.into_parts();
    let names: Vec<&str> = parts.calls.iter().map(|call| call.name.as_str()).collect();
    // The roster names what the MODEL wrote, in gg's own operation vocabulary; the log below
    // names the internal calls those were serviced by, which is a different question with a
    // different answer whenever several operations share one implementation.
    assert_eq!(
        names,
        ["files.list_dir", "files.read_file", "files.write_file"]
    );
    assert_eq!(log.names(), ["list_dir", "read_file", "write_file"]);
    assert!(parts.calls.iter().all(|call| call.ok));
    assert!(parts.calls.iter().all(|call| call.error.is_none()));
}

/// A failed call keeps its message on the record even though the program was thrown into — a
/// program that *caught* the throw and carried on would otherwise leave no trace of what failed.
#[test]
fn a_failed_call_is_recorded_with_its_message() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_operations(), None, |_, _| {
        ToolOutcome::failed(ToolFailure::NotFound, "no such file `missing.ts`")
    });

    let error = state
        .read_file("missing.ts".to_string(), None, None)
        .expect_err("a missing file throws");
    assert_eq!(error.code, ErrorCode::NotFound);
    assert_eq!(error.message, "no such file `missing.ts`");

    let parts = state.into_parts();
    assert_eq!(parts.calls.len(), 1);
    assert!(!parts.calls[0].ok);
    assert_eq!(
        parts.calls[0].error.as_deref(),
        Some("no such file `missing.ts`")
    );
}

/// A tool that succeeds but reports no structured data is a defect in the tool, and is reported as
/// one — naming the tool — rather than being turned into a fabricated value a program would branch
/// on and be wrong about.
///
/// And the roster says so too. The record is written when the call is dispatched, before anything
/// has looked at the sidecar, so without the amendment the model would read "the call succeeded"
/// next to a program that was thrown into — the one outcome worse than either message alone.
#[test]
fn a_tool_that_returns_no_structured_data_is_an_error_not_a_guess() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_operations(), None, |_, _| {
        ToolOutcome::ok("three entries", "listed")
    });

    let error = state
        .list_dir(None)
        .expect_err("a missing sidecar is an error");
    assert_eq!(error.code, ErrorCode::IoError);
    assert_eq!(error.operation, "list_dir");
    assert!(error.message.contains("gg defect"), "{}", error.message);

    let parts = state.into_parts();
    assert_eq!(parts.calls.len(), 1);
    assert!(
        !parts.calls[0].ok,
        "the roster must not say a call succeeded that the program was thrown into"
    );
    assert_eq!(
        parts.calls[0].error.as_deref(),
        Some(error.message.as_str())
    );
}

/// The diagnostic names the payload a confused tool produced instead, which is the difference
/// between a two-minute and a two-hour debugging session.
#[test]
fn a_wrongly_typed_sidecar_names_what_it_produced() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_operations(), None, |_, _| {
        ToolOutcome::ok("wrote it", "wrote").with_data(ApiData::BytesWritten(12))
    });

    let error = state
        .list_dir(None)
        .expect_err("the wrong sidecar is an error");
    assert!(error.message.contains("bytesWritten"), "{}", error.message);
}

/// A failure raised outside a tool implementation carries no classification, and is reported as
/// `other` rather than as a plausible-looking guess.
#[test]
fn an_unclassified_failure_maps_to_other() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_operations(), None, |_, _| {
        ToolOutcome::error("the bridge to the loop closed")
    });

    let error = state
        .list_dir(None)
        .expect_err("an unclassified failure throws");
    assert_eq!(error.code, ErrorCode::Other);
    assert_eq!(error.message, "the bridge to the loop closed");
}

/// A program whose run has already spent its wall-clock budget is refused at its next tool call.
///
/// This is the only mechanism available: a host function cannot trap, so the program cannot be
/// stopped mid-flight — it is told its budget is gone, its effects so far stand, and it stops
/// cleanly on its own.
#[test]
fn a_program_past_the_run_deadline_is_refused_at_its_next_tool_call() {
    let log = CallLog::default();
    let expired = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .expect("a one-second-old instant exists");
    let mut state = membrane_with(&log, &all_operations(), Some(expired), canned_outcome);

    let error = state
        .read_skill("testing".to_string())
        .expect_err("a spent budget refuses the call");

    assert_eq!(error.code, ErrorCode::LimitExceeded);
    assert!(
        error.message.contains("wall-clock budget"),
        "{}",
        error.message
    );
    assert!(
        log.calls().is_empty(),
        "the call must not reach the loop after the deadline"
    );
    let parts = state.into_parts();
    assert_eq!(parts.refusals.len(), 1);
    assert!(parts.calls.is_empty());
}

/// A run with budget left is not refused — the guard bounds a spent budget, not every deadline.
#[test]
fn a_program_within_the_run_deadline_is_serviced() {
    let log = CallLog::default();
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut state = membrane_with(&log, &all_operations(), Some(deadline), canned_outcome);

    state
        .read_skill("testing".to_string())
        .expect("a live budget services the call");
    assert_eq!(log.names(), ["read_skill"]);
}

/// Every classified failure has its own membrane code — the vocabulary a program branches on.
#[test]
fn every_tool_failure_class_maps_to_its_own_code() {
    let cases = [
        (ToolFailure::InvalidArgument, ErrorCode::InvalidArgument),
        (ToolFailure::NotFound, ErrorCode::NotFound),
        (ToolFailure::Conflict, ErrorCode::Conflict),
        (ToolFailure::Refused, ErrorCode::Refused),
        (ToolFailure::Unavailable, ErrorCode::Unavailable),
        (ToolFailure::LimitExceeded, ErrorCode::LimitExceeded),
        (ToolFailure::IoError, ErrorCode::IoError),
    ];
    for (failure, expected) in cases {
        assert_eq!(error_code(Some(failure)), expected, "{failure:?}");
    }
    assert_eq!(error_code(None), ErrorCode::Other);
}

/// The membrane sends gg's tools the argument keys their own schemas declare — asserted here for
/// the shape that is easiest to get wrong, an optional field the schema spells differently from the
/// WIT.
#[test]
fn arguments_use_the_tools_own_schema_keys() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .read_file("src/a.ts".to_string(), Some(10), Some(20))
        .expect("read");

    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "src/a.ts", "offset": 10, "limit": 20 }))
    );
}
